import { Worker } from "node:worker_threads";
import path from "node:path";
import type { WorkerInput, WorkerOutput } from "@/lib/types";

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
    worker.once("message", (msg: WorkerOutput & { error?: string }) => {
      settled = true;
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg);
    });
    worker.once("error", (err) => {
      settled = true;
      reject(err);
    });
    worker.once("exit", (code) => {
      if (!settled && code !== 0) reject(new Error(`Worker exited with code ${code}`));
    });
  });
}
