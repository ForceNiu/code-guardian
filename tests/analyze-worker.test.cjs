// C5 · `worker/analyze.worker.cjs` 集成测试（真实 git 仓库 + 真实 Worker 线程）
//
// 为什么这一层不用 mock：它正是「路径引号」事故所在层。
// 事故本质：`execFileSync("git", ["show", "base:src/x.ts"])` 的参数里**多了引号**，
// 于是 git 去找一个名字带引号的文件 → 找不到 → 返回 null → 所有文件被误判 added。
// 这种缺陷**靠 mock 永远测不出来**（mock 只会按你写的参数返回你想要的结果），
// 必须真的过一遍 git。所以这里建一个真实的小仓库，真起 Worker 线程跑。
//
// ⚠️ 代价：是集成测试，比纯函数单测慢（每轮要 clone 一次小仓库）。
//    但这层没有更便宜的可信验证方式 —— 这也是台账把它标为「最难」的原因。

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { Worker } = require("node:worker_threads");

const WORKER_PATH = path.join(__dirname, "..", "worker", "analyze.worker.cjs");

let tmpRoot = null;
let repoDir = null;

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

/**
 * 建一个 4 文件的源仓库：
 *   main    = base：keep / changed / todelete / importer
 *   feature = head：changed 改签名、todelete 删掉、新增 new
 */
function buildFixtureRepo(root) {
  fs.mkdirSync(root, { recursive: true });
  git(["init", "-q", "-b", "main"], root);
  git(["config", "user.email", "fixture@example.com"], root);
  git(["config", "user.name", "fixture"], root);

  write(path.join(root, "src/keep.ts"), "export function keep(a: string): void {}\n");
  write(path.join(root, "src/changed.ts"), "export function foo(a: string): void {}\n");
  write(path.join(root, "src/todelete.ts"), "export function gone(): void {}\n");
  write(
    path.join(root, "src/importer.ts"),
    'import { foo } from "./changed";\nexport function use() { return foo("x"); }\n',
  );
  git(["add", "-A"], root);
  git(["commit", "-q", "-m", "base"], root);

  git(["checkout", "-q", "-b", "feature"], root);
  write(path.join(root, "src/changed.ts"), "export function foo(a: string, b: number): void {}\n");
  fs.rmSync(path.join(root, "src/todelete.ts"));
  write(path.join(root, "src/new.ts"), "export function fresh(): void {}\n");
  git(["add", "-A"], root);
  git(["commit", "-q", "-m", "head"], root);

  git(["checkout", "-q", "main"], root);
}

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cg-worker-"));
  repoDir = path.join(tmpRoot, "repo");
  buildFixtureRepo(repoDir);
});

after(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

/** 真起一个 Worker 线程跑一次分析，原样返回它回传的消息（成功是 result，失败是 error） */
function runWorker(overrides) {
  const workdir = fs.mkdtempSync(path.join(tmpRoot, "wd-"));
  const workerData = {
    gitUrl: repoDir,
    baseRef: "main",
    headRef: "feature",
    workdir,
    cache: null,
    ...overrides,
  };
  return new Promise((resolve, reject) => {
    const w = new Worker(WORKER_PATH, { workerData });
    w.on("message", (msg) => {
      resolve(msg);
      w.terminate();
    });
    w.on("error", reject);
    w.on("exit", (code) => reject(new Error(`worker 退出(${code})，且没有回传任何消息`)));
  });
}

function statusOf(msg, file) {
  const hit = msg.result.changedFiles.find((f) => f.path === file);
  return hit ? hit.status : null;
}

function symbolOf(msg, file, symbol) {
  return msg.result.changedSymbols.find((c) => c.file === file && c.symbol === symbol);
}

// ---------------------------------------------------------------------------
// 自检：哨兵文件名只有本次 fixture 才有，能排除「跑的不是我们的仓库」这种情况
// ---------------------------------------------------------------------------

test("自检：worker 跑通，回传的是本次 fixture 的结果", async () => {
  const msg = await runWorker({});

  assert.equal(msg.error, undefined, `不该走 error 分支：${String(msg.error)}`);
  assert.ok(msg.result, "应回传 result");
  assert.ok(
    msg.result.changedFiles.some((f) => f.path === "src/new.ts"),
    "哨兵文件 src/new.ts 应出现在变更里",
  );
});

// ---------------------------------------------------------------------------
// 🔴 事故守护：这一条就是为「路径引号」事故写的回归挡板
// ---------------------------------------------------------------------------

test("事故守护：git 参数不带引号 → 状态判对（modified / added / deleted 各就各位）", async () => {
  const msg = await runWorker({});

  // 当年事故的表象是「**全部**文件被误判 added」：
  // 只要有人给 `git show base:file` 的路径加上引号，git 找不到该文件、返回 null，
  // 于是 oldContent == null → 一切都被当成新增。下面三条同时成立才算没退化。
  assert.equal(statusOf(msg, "src/changed.ts"), "modified");
  assert.equal(statusOf(msg, "src/new.ts"), "added");
  assert.equal(statusOf(msg, "src/todelete.ts"), "deleted");
});

// ---------------------------------------------------------------------------
// 🔴 P0-1 回归锁：专门补上「现有测试结构性抓不到」的那个盲区
//
// 现有用例每次都用 mkdtempSync **新建** workdir，永远走不到「复用缓存」这条路径，
// 所以 250 个测试全绿也照样放过了陈旧检出。本用例固定 workdir 跑两次，
// 中间往源仓库推一个新提交 —— 第二次必须看到它，否则就是检出到了 clone 时的旧位置。
// 自建独立源仓库：本用例会往源仓库推提交，不能污染共享 fixture。
// ---------------------------------------------------------------------------

test("P0-1 回归锁：复用已有 workdir 时检出的是最新提交", async () => {
  const src = fs.mkdtempSync(path.join(tmpRoot, "src-reuse-"));
  git(["init", "-q", "-b", "main"], src);
  git(["config", "user.email", "fixture@example.com"], src);
  git(["config", "user.name", "fixture"], src);
  write(path.join(src, "src/a.ts"), "export function a(): void {}\n");
  git(["add", "-A"], src);
  git(["commit", "-q", "-m", "v1"], src);

  const workdir = fs.mkdtempSync(path.join(tmpRoot, "wd-reuse-"));
  // 第一次：clone。此刻远端最新 = v1。
  const first = await runWorker({ gitUrl: src, workdir, baseRef: "main", headRef: "main" });
  assert.equal(first.error, undefined, `第一次不该走 error 分支：${String(first.error)}`);

  // v2：改 a() 的签名（模拟「远端在此期间有更新」）
  write(path.join(src, "src/a.ts"), "export function a(x: string): void {}\n");
  git(["add", "-A"], src);
  git(["commit", "-q", "-m", "v2"], src);

  // 第二次：**复用同一个 workdir**。fetch 只更新 origin/*、本地 main 不动 ——
  // 修复前 checkout 本地 main 停在 v1 → 工作区是旧代码。
  const second = await runWorker({ gitUrl: src, workdir, baseRef: "main~1", headRef: "main" });
  assert.equal(second.error, undefined, `第二次不该走 error 分支：${String(second.error)}`);

  // 🔴 断言必须打在**符号 diff** 上，不能打在 changedFiles 上：
  //    changedFiles 走 `git diff`（用已解析的 ref），即使工作区停在旧位置也照样列出文件；
  //    真正受害的是「工作区内容 = v1」→ diff v1...v1 什么也检不出 → 报告「本次无变更」。
  assert.ok(
    second.result.changedSymbols.some((c) => c.file === "src/a.ts" && c.symbol === "a"),
    "复用了旧 workdir，a() 的签名变更没被检出 → 检出的是 clone 时的旧代码（P0-1 回归）",
  );
});

// ---------------------------------------------------------------------------
// 变更检测
// ---------------------------------------------------------------------------

test("签名变更被检出（foo 增加形参）", async () => {
  const msg = await runWorker({});

  const hit = symbolOf(msg, "src/changed.ts", "foo");
  assert.ok(hit, "应检出 foo 的变更");
  assert.equal(hit.changeType, "modified");
  assert.notEqual(hit.oldSignature, hit.newSignature);
});

test("删除的导出被检出为 removed", async () => {
  const msg = await runWorker({});

  const hit = symbolOf(msg, "src/todelete.ts", "gone");
  assert.ok(hit, "应检出 gone 的删除");
  assert.equal(hit.changeType, "removed");
});

test("影响链路：importer.ts 被登记为 foo 的引用方", async () => {
  const msg = await runWorker({});

  const hit = msg.result.impactChain.find((c) => c.file === "src/changed.ts" && c.symbol === "foo");
  assert.ok(hit, "应有 foo 的影响链记录");
  assert.ok(
    hit.impactedFiles.includes("src/importer.ts"),
    `引用方应包含 src/importer.ts，实际：${JSON.stringify(hit.impactedFiles)}`,
  );
});

// ---------------------------------------------------------------------------
// M4 Monaco Diff 数据
// ---------------------------------------------------------------------------

test("diff 数据带上了 base/head 两侧全文，且内容不同", async () => {
  const msg = await runWorker({});

  const d = msg.result.diffs.find((x) => x.path === "src/changed.ts");
  assert.ok(d, "应有 changed.ts 的 diff");
  assert.match(d.oldContent, /foo\(a: string\)/);
  assert.match(d.newContent, /foo\(a: string, b: number\)/);
});

// ---------------------------------------------------------------------------
// 增量缓存：拿第一轮产出的 symbolTable 当第二轮的输入
// ---------------------------------------------------------------------------

test("增量缓存：第一轮 0 命中，第二轮未变更文件命中", async () => {
  const first = await runWorker({ cache: null });
  assert.equal(first.result.summary.cacheHits, 0, "没有缓存时不该有命中");

  const cache = { hashByFile: {}, exportsByFile: {}, importsByFile: {}, reexportsByFile: {} };
  for (const e of first.symbolTable) {
    cache.hashByFile[e.filePath] = e.hash;
    cache.exportsByFile[e.filePath] = e.exports;
    cache.importsByFile[e.filePath] = e.imports;
    cache.reexportsByFile[e.filePath] = e.reexports;
  }

  const second = await runWorker({ cache });

  assert.ok(
    second.result.summary.cacheHits > 0,
    `未变更文件应命中缓存，实际 cacheHits=${second.result.summary.cacheHits}`,
  );
  // 命中缓存不该改变结论：变更符号数应当一致
  assert.equal(
    second.result.summary.changedSymbolCount,
    first.result.summary.changedSymbolCount,
  );
});

// ---------------------------------------------------------------------------
// 失败路径：worker 要把异常回传给主线程，而不是崩掉不回消息
// （主线程靠这条把任务标 failed；不回消息 = Promise 永不 settle = N3 那类事故）
// ---------------------------------------------------------------------------

test("headRef 不可达 → 回传 error 并带明确定位信息", async () => {
  const msg = await runWorker({ headRef: "no-such-ref" });

  assert.equal(msg.result, undefined, "失败时不该回传 result");
  assert.ok(msg.error, "应回传 error");
  assert.match(String(msg.error), /git checkout 失败/);
});
