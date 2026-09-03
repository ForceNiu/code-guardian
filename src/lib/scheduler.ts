import path from "node:path";
import type { Task } from "@prisma/client";
import { prisma } from "./prisma";
import { runAnalysis } from "@/worker/run-analysis";
import { persistSymbolTable, readSymbolCache } from "./persist";
import { enrichUncertain } from "./ai/enrich";
import { getEventBus } from "./events";

const MAX_CONCURRENT = 3; // 同一时间最多 3 个 Worker 任务
const POLL_INTERVAL_MS = 5000; // 每 5 秒轮询一次

let running = 0;
let started = false;
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * 启动任务调度器（在 instrumentation.ts 的 register() 里调用一次）。
 * 设计：数据库状态机 + 定时轮询，没有引入 Redis / 消息队列，运维简单可靠。
 */
export function startScheduler() {
  if (started) return;
  started = true;
  console.log(
    `[scheduler] 启动：每 ${POLL_INTERVAL_MS / 1000}s 轮询，并发上限 ${MAX_CONCURRENT}`,
  );
  void tick(); // 启动时立即跑一轮
  timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  started = false;
}

async function tick() {
  if (running >= MAX_CONCURRENT) return;
  const slots = MAX_CONCURRENT - running;

  let pending: Task[];
  try {
    pending = await prisma.task.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      take: slots,
    });
  } catch (err) {
    // 数据库尚未就绪时静默跳过，下一轮再试
    console.error("[scheduler] 轮询失败:", err instanceof Error ? err.message : err);
    return;
  }

  for (const task of pending) {
    // 原子认领：仅当仍为 pending 时置为 parsing，避免重复处理（双保险，配合唯一索引）
    const claimed = await prisma.task.updateMany({
      where: { id: task.id, status: "pending" },
      data: { status: "parsing" },
    });
    if (claimed.count === 0) continue;

    // M4 SSE：认领成功 → 状态 pending→parsing，广播给订阅的报告页
    getEventBus().publish(task.id, { status: "parsing" });

    running++;
    void processTask(task).finally(() => {
      running--;
    });
  }
}

async function processTask(task: Task) {
  const repo = await prisma.repository.findUnique({ where: { id: task.repoId } });
  if (!repo) {
    await prisma.task.update({
      where: { id: task.id },
      data: { status: "failed", errorMessage: "关联仓库不存在" },
    });
    getEventBus().publish(task.id, { status: "failed", errorMessage: "关联仓库不存在" });
    return;
  }

  const workdir = path.join(process.cwd(), ".cache", "repos", task.repoId);
  try {
    await prisma.task.update({ where: { id: task.id }, data: { status: "analyzing" } });
    getEventBus().publish(task.id, { status: "analyzing" });

    // 增量缓存：先读上次分析结果，未变更文件跳过重解析
    const cache = await readSymbolCache(task.repoId);

    const output = await runAnalysis({
      repoId: task.repoId,
      gitUrl: repo.gitUrl,
      baseRef: task.baseRef,
      headRef: task.headRef,
      workdir,
      cache,
    });

    // M3b：规则引擎判为 uncertain 的变更送 AI 语义引擎二次判定（无 key / 失败自动降级）
    await enrichUncertain(output.result);

    await prisma.task.update({ where: { id: task.id }, data: { status: "reporting" } });
    getEventBus().publish(task.id, { status: "reporting" });

    await persistSymbolTable(task.repoId, output.symbolTable);

    await prisma.task.update({
      where: { id: task.id },
      data: { status: "done", result: output.result as object },
    });
    getEventBus().publish(task.id, { status: "done" });
    console.log(
      `[scheduler] 任务 ${task.id} 完成：${output.result.summary.changedSymbolCount} 个符号变更，` +
        `${output.result.summary.high} 高危 / ${output.result.summary.medium} 中危 / ${output.result.summary.low} 低危`,
    );
  } catch (err) {
    const message = err instanceof Error ? `${err.message}\n${err.stack?.slice(0, 500) ?? ""}` : String(err);
    await prisma.task.update({
      where: { id: task.id },
      data: { status: "failed", errorMessage: message },
    });
    getEventBus().publish(task.id, { status: "failed", errorMessage: message });
    console.error(`[scheduler] 任务 ${task.id} 失败:`, err);
  }
}
