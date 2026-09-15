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
    // 用运行时字符串路径引用，避免被 Next/Turbopack 打包进 bundle
    const workerPath = path.join(process.cwd(), "src", "worker", "analyze.worker.cjs");
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
      if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
    });
  });
}
