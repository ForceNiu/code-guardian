// C4 · `src/worker/run-analysis.ts` —— 两层超时里的「Worker 侧软超时 + terminate()」
//
// 为什么要测这一条（这是全项目最反直觉的一处设计）：
//   scheduler 的任务级超时（5 分钟）**杀不掉 worker 线程** —— 它只能改数据库里的任务状态，
//   线程会继续跑、继续占 CPU。所以 Worker 这一层必须自己再设一个**更短**的超时（4 分钟），
//   到点 `terminate()` 把线程真正回收，否则超时后槽位永远拿不回来。
//   两层缺一不可：少了上层 → 任务永远卡着；少了本层 → 线程泄漏。
//
// 本文件沿用 `tests/security-index.test.ts` 立下的范式（见 docs/AUDIT-BACKLOG.md §二.1）：
//   ① `mock.module` 替换模块级依赖（这里是 node:worker_threads）
//   ② 行为放可变 holder，由各用例改写
//   ③ 第一条用例自检：证明 mock 真的生效
//   ④ 动态 import 不带 `.ts` 后缀、放进 `before()` 钩子

import { test, before, mock } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import type { WorkerInput } from "../src/lib/types";

// ---------------------------------------------------------------------------
// FakeWorker：只实现 run-analysis 用到的那一小片接口
// ---------------------------------------------------------------------------

type Handler = (...args: unknown[]) => void;

class FakeWorker {
  static instances: FakeWorker[] = [];

  readonly workerPath: string;
  readonly options: { workerData?: unknown } | undefined;
  readonly handlers = new Map<string, Handler>();
  terminateCalls = 0;
  terminated = false;

  constructor(workerPath: string, options?: { workerData?: unknown }) {
    this.workerPath = workerPath;
    this.options = options;
    FakeWorker.instances.push(this);
  }

  once(event: string, handler: Handler): this {
    this.handlers.set(event, handler);
    return this;
  }

  /** 由用例手动触发某类事件（模拟 Worker 的三种收场方式） */
  emit(event: string, ...args: unknown[]): void {
    this.handlers.get(event)?.(...args);
  }

  terminate(): Promise<number> {
    this.terminateCalls += 1;
    this.terminated = true;
    return Promise.resolve(0);
  }
}

const lastWorker = (): FakeWorker => {
  const w = FakeWorker.instances[FakeWorker.instances.length - 1];
  if (!w) throw new Error("FakeWorker 从未被构造 —— mock 没生效");
  return w;
};

before(() => {
  FakeWorker.instances = [];
  mock.module("node:worker_threads", { namedExports: { Worker: FakeWorker } });
});

// ⚠️ 动态 import 不带 `.ts` 后缀（TS5097）；且必须在 mock 注册之后。
let runAnalysis: (input: WorkerInput) => Promise<unknown>;

before(async () => {
  ({ runAnalysis } = await import("../src/worker/run-analysis"));
});

// ---------------------------------------------------------------------------

const INPUT: WorkerInput = {
  repoId: "repo-1",
  gitUrl: "https://example.invalid/org/repo.git",
  baseRef: "main~1",
  headRef: "main",
  workdir: "/tmp/c4-fixture",
};

test("自检：mock 确实替换了 node:worker_threads（不生效则本文件全部结论无效）", async () => {
  FakeWorker.instances = [];
  const promise = runAnalysis(INPUT);

  // 若 mock 未生效：这里会真的去起一个 Worker 线程（路径存在但会跑真实分析），
  // `lastWorker()` 直接抛「从未被构造」→ 用例必红。
  const worker = lastWorker();
  assert.equal(worker.workerPath, path.join(process.cwd(), "src", "worker", "analyze.worker.cjs"));
  assert.deepEqual(worker.options?.workerData, INPUT);

  worker.emit("message", { result: {}, symbolTable: [] });
  await promise;
});

test("正常回传：message 到达即 resolve，并把 payload 原样交给调用方", async () => {
  FakeWorker.instances = [];
  const payload = { result: { summary: { high: 1 } }, symbolTable: [{ filePath: "a.ts" }] };

  const promise = runAnalysis(INPUT);
  lastWorker().emit("message", payload);

  assert.deepEqual(await promise, payload);
  assert.equal(lastWorker().terminateCalls, 0, "正常收尾不应 terminate");
});

test("Worker 回传 error 字段：以该文案 reject（而不是 resolve 一个带 error 的对象）", async () => {
  FakeWorker.instances = [];
  const promise = runAnalysis(INPUT);
  lastWorker().emit("message", { error: "git checkout 失败" });

  await assert.rejects(promise, /git checkout 失败/);
});

test("error 事件：把原始错误直接抛出", async () => {
  FakeWorker.instances = [];
  const promise = runAnalysis(INPUT);
  lastWorker().emit("error", new Error("线程内未捕获异常"));

  await assert.rejects(promise, /线程内未捕获异常/);
});

test("非零退出：reject 并带上退出码（否则会变成一个永远不 settle 的 Promise）", async () => {
  FakeWorker.instances = [];
  const promise = runAnalysis(INPUT);
  lastWorker().emit("exit", 3);

  await assert.rejects(promise, /exited with code 3/);
});

test("超时：到点调用 terminate() 回收线程，并以超时文案 reject", async () => {
  FakeWorker.instances = [];
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const promise = runAnalysis(INPUT);
    const worker = lastWorker();

    mock.timers.tick(240_000); // 4 分钟软超时（不 tick 的话它会一直挂着）

    await assert.rejects(promise, /分析超时/);
    assert.equal(worker.terminateCalls, 1, "超时后必须 terminate 线程——否则线程泄漏、槽位收不回");
  } finally {
    mock.timers.reset();
  }
});

test("超时不重复结算：超时后再收到 message，不得覆盖已拒绝的结果", async () => {
  FakeWorker.instances = [];
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const promise = runAnalysis(INPUT);
    const worker = lastWorker();

    mock.timers.tick(240_000);
    await assert.rejects(promise, /分析超时/);

    const resolvedLate = worker.handlers.get("message");
    assert.ok(resolvedLate, "message 处理器应在超时后依然挂在那里");
    // 迟到的 message 不允许抛错，也不允许改变已结算的 Promise
    worker.emit("message", { result: {}, symbolTable: [] });
    await assert.rejects(promise, /分析超时/);
  } finally {
    mock.timers.reset();
  }
});

test("exit 0 但从未回传结果：必须 reject，不能让调用方永远等下去", async () => {
  // 🔴 这条是**新查出的缺口**（2026-09-16，写 C4 时发现）：
  //    原实现在 exit 分支里 `if (code !== 0) reject(...)` —— code 为 0 时既不 resolve 也不 reject，
  //    于是 runAnalysis 返回的 Promise **永不 settle**。
  //    后果比"报错"更坏：scheduler 的 `void processTask(...).finally(() => running--)` 永远不执行
  //    → **并发槽位永久泄漏**，累积 3 次（MAX_CONCURRENT）后调度器彻底不再处理任何任务。
  //    单测此前完全为空，所以这个洞一直没人看见 —— 正属「输出看起来正常」那一类。
  FakeWorker.instances = [];
  const promise = runAnalysis(INPUT);
  lastWorker().emit("exit", 0);

  await assert.rejects(promise, /未回传结果|exit 0/);
});
