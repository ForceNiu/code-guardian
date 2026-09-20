import { Worker } from "node:worker_threads";
import path from "node:path";
import type { WorkerInput, WorkerOutput } from "@/lib/types";

/**
 * Worker 自身软超时（4 分钟）：必须短于 scheduler 的任务级超时（TASK_TIMEOUT_MS=5 分钟）。
 * 为什么要它：scheduler 的 timeout 是「主线程兜底」——能改任务状态，但**杀不掉 Worker 线程**，
 * 线程会继续跑（git 已在 execFileSync 层限时，但极端下仍可能长时间占 CPU）。
 * 这里主动 terminate()，确保超时后线程被真正回收，把槽位让给下一个任务。
 */
const WORKER_TIMEOUT_MS = 240000;

/**
 * 主线程封装：把 CPU 密集的分析丢进 worker_threads。
 * 返回一个 Promise，Worker 通过 postMessage 回传结果。
 */
export function runAnalysis(input: WorkerInput): Promise<WorkerOutput> {
  return new Promise((resolve, reject) => {
    // 🔴 用**运行时字符串**引用，不是 import：引擎（worker/*.cjs）有意放在 src/ 之外，
    //    既不进 Next/Turbopack 的 bundle，也不参与 tsc 的类型检查（它是 .cjs）。
    //    代价：静态工具看不出这个文件在被使用 → 改路径 / 目录名不会有任何编译期报错，
    //    只在运行时挂。同步点共 4 处（口径与 docs/DEVELOPING.md §4 一致，别写成「3 处」）：
    //    本文件的 `const workerPath`、`scripts/scan-repo.cjs` 的 worker 路径、两个测试文件（构造 + 断言）。⚠️ 故意不写行号（会漂）——用 `grep -rn 'analyze\.worker\.cjs'` 穷举。
    const workerPath = path.join(process.cwd(), "worker", "analyze.worker.cjs");
    const worker = new Worker(workerPath, { workerData: input });

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // terminate() 返回 Promise，但无需等待——先拒绝调用方，线程由运行时异步回收
      void worker.terminate();
      reject(new Error(`分析超时（>${WORKER_TIMEOUT_MS / 1000}s），已终止 Worker`));
    }, WORKER_TIMEOUT_MS);

    const done = () => clearTimeout(timer);

    worker.once("message", (msg: WorkerOutput & { error?: string }) => {
      if (settled) return;
      settled = true;
      done();
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg);
    });
    worker.once("error", (err) => {
      if (settled) return;
      settled = true;
      done();
      reject(err);
    });
    worker.once("exit", (code) => {
      if (settled) return;
      settled = true;
      done();
      // 🔴 exit 0 但从未 postMessage = 线程干净退出却没给结果（2026-09-16 写 C4 测试时查出）。
      // 原实现在这种情况下**既不 resolve 也不 reject** → 返回的 Promise 永不 settle →
      // scheduler 的 `void processTask(...).finally(() => running--)` 永不执行 →
      // **并发槽位永久泄漏**，累积到 MAX_CONCURRENT(3) 后调度器彻底不再处理任务。
      // 比"报错"更坏：没有任何日志、没有任何失败态，进程看着完全正常。
      reject(
        code === 0
          ? new Error("分析未返回结果：Worker 未 postMessage 就退出了（exit 0）")
          : new Error(`Worker exited with code ${code}`),
      );
    });
  });
}
