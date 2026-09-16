import path from "node:path";
import type { Task } from "@prisma/client";
import { prisma } from "./prisma";
import { runAnalysis } from "@/lib/run-analysis";
import { persistSymbolTable, readSymbolCache } from "./persist";
import { enrichUncertain } from "./ai/enrich";
import { enrichSecurity } from "./security";
import { reportGitLabStatus } from "./status/gitlab-status";
import { getEventBus } from "./events";

const MAX_CONCURRENT = 3; // 同一时间最多 3 个 Worker 任务
const POLL_INTERVAL_MS = 5000; // 每 5 秒轮询一次
const TASK_TIMEOUT_MS = 300000; // P2：单任务硬超时 5 分钟，防挂起占死并发槽
const STALE_TASK_MS = 600000; // P3：卡在中间态超过 10 分钟视为崩溃，回收重排

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

  // P3：回收崩溃/卡死的中间态任务。进程崩了没机会把任务置 failed，
  // 这里靠 updatedAt 过期（>STALE_TASK_MS）识别，重置回 pending 重新入队。
  try {
    const reclaimed = await prisma.task.updateMany({
      where: {
        status: { in: ["parsing", "analyzing", "reporting"] },
        updatedAt: { lt: new Date(Date.now() - STALE_TASK_MS) },
      },
      data: { status: "pending" },
    });
    if (reclaimed.count > 0) {
      console.log(`[scheduler] 回收 ${reclaimed.count} 个卡住的中间态任务 → pending`);
    }
  } catch (err) {
    console.error("[scheduler] 回收失败:", err instanceof Error ? err.message : err);
  }

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
    // P2：单任务超时守卫。到点把任务置 failed（防占死并发槽），并置 ctrl.cancelled
    // 让 processTask 在长操作返回后放弃落库 done，避免覆盖 failed 状态。
    const ctrl = { cancelled: false };
    const timer = setTimeout(() => void onTaskTimeout(task, ctrl), TASK_TIMEOUT_MS);
    void processTask(task, ctrl).finally(() => {
      clearTimeout(timer);
      running--;
    });
  }
}

/** 单任务超时处理：仅当任务尚未终态时才置 failed（done/failed 不被覆盖） */
async function onTaskTimeout(task: Task, ctrl: { cancelled: boolean }) {
  ctrl.cancelled = true;
  try {
    const cur = await prisma.task.findUnique({
      where: { id: task.id },
      select: { status: true },
    });
    if (cur && cur.status !== "done" && cur.status !== "failed") {
      await prisma.task.update({
        where: { id: task.id },
        data: { status: "failed", errorMessage: `任务超时（>${TASK_TIMEOUT_MS / 1000}s 未结束）` },
      });
      getEventBus().publish(task.id, { status: "failed", errorMessage: "任务超时" });
      console.error(`[scheduler] 任务 ${task.id} 超时，标记 failed`);
    }
  } catch (err) {
    console.error("[scheduler] 超时处理失败:", err instanceof Error ? err.message : err);
  }
}

async function processTask(task: Task, ctrl: { cancelled: boolean }) {
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

    // P2：已被超时中断则放弃后续步骤与落库 done，保留 failed 状态
    if (ctrl.cancelled) return;

    // M3b：规则引擎判为 uncertain 的变更送 AI 语义引擎二次判定（无 key / 失败自动降级）
    await enrichUncertain(output.result);

    // M5：安全门禁（CVE 扫描 + 构建体积检测），失败静默降级、不阻断主分析
    await enrichSecurity(output.result, workdir);

    await prisma.task.update({ where: { id: task.id }, data: { status: "reporting" } });
    getEventBus().publish(task.id, { status: "reporting" });

    await persistSymbolTable(task.repoId, output.symbolTable);

    // P2：双保险——若中途被超时取消，跳过最终 done 落库（保留已标记的 failed）
    if (ctrl.cancelled) return;

    await prisma.task.update({
      where: { id: task.id },
      data: { status: "done", result: output.result as object },
    });
    getEventBus().publish(task.id, { status: "done" });
    console.log(
      `[scheduler] 任务 ${task.id} 完成：${output.result.summary.changedSymbolCount} 个符号变更，` +
        `${output.result.summary.high} 高危 / ${output.result.summary.medium} 中危 / ${output.result.summary.low} 低危`,
    );

    // M5：回写 GitLab commit status（有高危 → failed 门禁拦截；无 → success）。失败静默降级。
    try {
      await reportGitLabStatus({ ...task, status: "done" }, repo, output.result);
    } catch (gitlabErr) {
      console.error(
        "[scheduler] GitLab 状态回写失败:",
        gitlabErr instanceof Error ? gitlabErr.message : gitlabErr,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? `${err.message}\n${err.stack?.slice(0, 500) ?? ""}` : String(err);
    await prisma.task.update({
      where: { id: task.id },
      data: { status: "failed", errorMessage: message },
    });
    getEventBus().publish(task.id, { status: "failed", errorMessage: message });
    console.error(`[scheduler] 任务 ${task.id} 失败:`, err);

    // M5：分析失败也回写 failed 门禁状态。失败静默降级。
    try {
      await reportGitLabStatus({ ...task, status: "failed" }, repo, null);
    } catch {
      /* GitLab 不可用不阻断任务失败态落库 */
    }
  }
}
