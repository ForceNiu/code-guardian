// 无需数据库，直接验证分析引擎：对 fixtures/sample-repo 跑一次 base→head 分析
import { Worker } from "node:worker_threads";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "fixtures", "sample-repo");
const head = execSync("git rev-parse HEAD", { cwd: fixture, encoding: "utf8" }).trim();
const base = execSync("git rev-parse HEAD~1", { cwd: fixture, encoding: "utf8" }).trim();

const worker = new Worker(path.join(root, "src", "worker", "analyze.worker.cjs"), {
  workerData: {
    repoId: "test",
    gitUrl: fixture,
    baseRef: base,
    headRef: head,
    workdir: path.join(root, ".cache", "test-repo"),
  },
});

worker.on("message", (m) => {
  console.log(JSON.stringify(m, null, 2));
});
worker.on("error", (e) => {
  console.error("WORKER ERROR:", e);
  process.exit(1);
});
