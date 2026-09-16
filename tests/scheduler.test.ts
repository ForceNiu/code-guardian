// C1 · `src/lib/scheduler.ts` 编排层单测（node:test + 模块 mock）
// 范式见 tests/security-index.test.ts 与技能 detection-regression-discipline ⑥
//
// 被 mock 的 7 个模块，全部是 scheduler.ts 顶层真实 import 的（先 grep 过再写）：
//   ./prisma · @/lib/run-analysis · ./persist · ./ai/enrich · ./security · ./status/gitlab-status · ./events
//
// 两个模块级状态要注意（都是 `let`，跨用例共享）：
//   started —— 所以每个用例开头必须先 stopScheduler()，否则第二次 start 直接 return
//   running —— 任务认领时 ++，processTask 的 finally 里 --；
//              用例里如果让 runAnalysis 挂住不返回，running 就下不来，会把后面的用例全卡在并发上限。
//              → 需要挂起时用 analysisHolder 的 manual 模式，用完务必 releaseAll()。
// tick() 不导出，只能靠「stop → start」触发新一轮（startScheduler 启动时会立刻跑一轮）。
// ⚠️ 运行依赖 `--experimental-test-module-mocks`（已写进 package.json 的 test 脚本）

import { test, before, mock } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// 被测模块
// ---------------------------------------------------------------------------

let startScheduler: () => void;
let stopScheduler: () => void;

const abs = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// ---------------------------------------------------------------------------
// 假依赖的类型
// ---------------------------------------------------------------------------

type TaskRow = {
  id: string;
  repoId: string;
  mrId: string;
  commitSha: string;
  baseRef: string;
  headRef: string;
  status: string;
};

type UpdateCall = { id: string; data: Record<string, unknown> };
type UpdateManyCall = { where: Record<string, unknown>; data: Record<string, unknown> };
type FindManyCall = { where: { status: string }; take?: number };
type PublishCall = { taskId: string; payload: Record<string, unknown> };
type WorkerOutputLike = { result: Record<string, unknown>; symbolTable: unknown[] };

// ---------------------------------------------------------------------------
// 可变 holder
// ---------------------------------------------------------------------------

const taskHolder = {
  rows: [] as TaskRow[],
  /** 原子认领的结果：0 = 已被别的进程抢走 */
  claimCount: 1,
  /** 卡死中间态回收的条数 */
  reclaimCount: 0,
  claims: [] as UpdateManyCall[],
  reclaims: [] as UpdateManyCall[],
  findManyCalls: [] as FindManyCall[],
  updates: [] as UpdateCall[],
};

const repoHolder = {
  rows: [] as { id: string; gitUrl: string }[],
};

const analysisHolder = {
  /** immediate = 立刻返回；manual = 挂住等 release；throw = 抛错 */
  mode: "immediate" as "immediate" | "manual" | "throw",
  pending: [] as { resolve: (v: WorkerOutputLike) => void }[],
};

const enrichHolder = {
  uncertain: 0,
  security: 0,
  /** manual = 挂在 AI 增强这一步，用来把超时点挪到第一道守卫之后 */
  mode: "immediate" as "immediate" | "manual",
  pending: [] as { resolve: () => void }[],
};
const persistHolder = { persisted: 0, cacheRead: 0 };
const gitlabHolder = { calls: [] as { status: string }[] };

const eventHolder = {
  published: [] as PublishCall[],
};

// ---------------------------------------------------------------------------
// 假实现
// ---------------------------------------------------------------------------

function defaultOutput(): WorkerOutputLike {
  return {
    result: { summary: { changedSymbolCount: 1, high: 0, medium: 1, low: 0 } },
    symbolTable: [],
  };
}

function fakeRunAnalysis(): Promise<WorkerOutputLike> {
  if (analysisHolder.mode === "throw") return Promise.reject(new Error("analysis boom"));
  if (analysisHolder.mode === "manual") {
    return new Promise((resolve) => {
      analysisHolder.pending.push({ resolve });
    });
  }
  return Promise.resolve(defaultOutput());
}

/** 放行所有被挂住的异步步，让 processTask 走完、把 running 放下来 */
function releaseAll() {
  for (const p of analysisHolder.pending.splice(0)) p.resolve(defaultOutput());
  for (const p of enrichHolder.pending.splice(0)) p.resolve();
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

before(async () => {
  mock.module(abs("../src/lib/prisma.ts"), {
    namedExports: {
      prisma: {
        task: {
          updateMany: async (arg: UpdateManyCall) => {
            if (arg.data.status === "pending") {
              taskHolder.reclaims.push(arg);
              return { count: taskHolder.reclaimCount };
            }
            taskHolder.claims.push(arg);
            return { count: taskHolder.claimCount };
          },
          findMany: async (arg: FindManyCall) => {
            taskHolder.findManyCalls.push(arg);
            const rows = taskHolder.rows.filter((r) => r.status === arg.where.status);
            return typeof arg.take === "number" ? rows.slice(0, arg.take) : rows;
          },
          findUnique: async (arg: { where: { id: string } }) =>
            taskHolder.rows.find((r) => r.id === arg.where.id) ?? null,
          update: async (arg: { where: { id: string }; data: Record<string, unknown> }) => {
            taskHolder.updates.push({ id: arg.where.id, data: arg.data });
            const row = taskHolder.rows.find((r) => r.id === arg.where.id);
            if (row && typeof arg.data.status === "string") row.status = arg.data.status;
            return row;
          },
        },
        repository: {
          findUnique: async (arg: { where: { id: string } }) =>
            repoHolder.rows.find((r) => r.id === arg.where.id) ?? null,
        },
      },
    },
  });

  mock.module(abs("../src/lib/run-analysis.ts"), {
    namedExports: { runAnalysis: fakeRunAnalysis },
  });
  mock.module(abs("../src/lib/persist.ts"), {
    namedExports: {
      persistSymbolTable: async () => {
        persistHolder.persisted++;
      },
      readSymbolCache: async () => {
        persistHolder.cacheRead++;
        return { hashByFile: {}, exportsByFile: {}, importsByFile: {}, reexportsByFile: {} };
      },
    },
  });
  mock.module(abs("../src/lib/ai/enrich.ts"), {
    namedExports: {
      enrichUncertain: async () => {
        enrichHolder.uncertain++;
        if (enrichHolder.mode === "manual") {
          return new Promise<void>((resolve) => {
            enrichHolder.pending.push({ resolve });
          });
        }
      },
    },
  });
  mock.module(abs("../src/lib/security/index.ts"), {
    namedExports: {
      enrichSecurity: async () => {
        enrichHolder.security++;
      },
    },
  });
  mock.module(abs("../src/lib/status/gitlab-status.ts"), {
    namedExports: {
      reportGitLabStatus: async (task: { status: string }) => {
        gitlabHolder.calls.push({ status: task.status });
      },
    },
  });
  mock.module(abs("../src/lib/events.ts"), {
    namedExports: {
      getEventBus: () => ({
        publish: (taskId: string, payload: Record<string, unknown>) => {
          eventHolder.published.push({ taskId, payload });
        },
      }),
    },
  });

  const mod = await import("../src/lib/scheduler");
  startScheduler = mod.startScheduler;
  stopScheduler = mod.stopScheduler;
});

// ---------------------------------------------------------------------------
// 夹具与工具
// ---------------------------------------------------------------------------

function makeTask(id: string, status = "pending"): TaskRow {
  return {
    id,
    repoId: "repo-1",
    mrId: "1",
    commitSha: "sha",
    baseRef: "main",
    headRef: "feature",
    status,
  };
}

function resetAll() {
  stopScheduler();
  taskHolder.rows = [];
  taskHolder.claimCount = 1;
  taskHolder.reclaimCount = 0;
  taskHolder.claims = [];
  taskHolder.reclaims = [];
  taskHolder.findManyCalls = [];
  taskHolder.updates = [];
  repoHolder.rows = [{ id: "repo-1", gitUrl: "https://example.com/repo.git" }];
  analysisHolder.mode = "immediate";
  analysisHolder.pending = [];
  enrichHolder.uncertain = 0;
  enrichHolder.security = 0;
  enrichHolder.mode = "immediate";
  enrichHolder.pending = [];
  persistHolder.persisted = 0;
  persistHolder.cacheRead = 0;
  gitlabHolder.calls = [];
  eventHolder.published = [];
}

/** 触发一轮 tick 并等它跑完（tick 是 void 调用的，只能靠让事件循环几轮来等） */
async function runOneTick(rounds = 12) {
  startScheduler();
  for (let i = 0; i < rounds; i++) await flush();
}

function statuses(): string[] {
  return taskHolder.updates
    .map((u) => u.data.status)
    .filter((s): s is string => typeof s === "string");
}

// ---------------------------------------------------------------------------
// 启停
// ---------------------------------------------------------------------------

test("自检：startScheduler 跑了一轮 —— 哨兵任务 id 出现在广播记录里", async () => {
  resetAll();
  taskHolder.rows = [makeTask("TASK-SENTINEL")];

  await runOneTick();

  assert.ok(
    eventHolder.published.some((p) => p.taskId === "TASK-SENTINEL"),
    `哨兵任务应被广播，实际：${JSON.stringify(eventHolder.published)}`,
  );
});

test("重复 startScheduler 不会重复启动（第二轮不生效）", async () => {
  resetAll();
  taskHolder.rows = [makeTask("t1")];

  startScheduler();
  startScheduler(); // started 已为 true，应直接 return
  for (let i = 0; i < 12; i++) await flush();

  assert.equal(taskHolder.findManyCalls.length, 1, "只应发生一轮轮询");
});

// ---------------------------------------------------------------------------
// tick 的调度语义
// ---------------------------------------------------------------------------

test("回收卡在中间态的任务：把 parsing/analyzing/reporting 重置回 pending", async () => {
  resetAll();
  taskHolder.reclaimCount = 2;

  await runOneTick();

  assert.equal(taskHolder.reclaims.length, 1, "每轮应做一次回收");
  const where = taskHolder.reclaims[0].where as { status: { in: string[] } };
  assert.deepEqual(where.status.in, ["parsing", "analyzing", "reporting"]);
  assert.deepEqual(taskHolder.reclaims[0].data, { status: "pending" });
});

test("原子认领失败（已被抢走）→ 不广播 parsing，也不进后续处理", async () => {
  resetAll();
  taskHolder.claimCount = 0;
  taskHolder.rows = [makeTask("t1")];

  await runOneTick();

  assert.equal(taskHolder.claims.length, 1, "应尝试认领");
  assert.deepEqual(eventHolder.published, [], "认领失败不该有任何广播");
  assert.deepEqual(statuses(), [], "认领失败不该改任务状态");
});

test("并发上限：槽位占满后，下一轮直接返回、不再取任务", async () => {
  resetAll();
  analysisHolder.mode = "manual"; // 让 3 个任务都挂在 runAnalysis 上，把 running 占满
  taskHolder.rows = [makeTask("a"), makeTask("b"), makeTask("c")];

  await runOneTick();
  assert.equal(taskHolder.findManyCalls.length, 1, "第一轮应取任务");

  // 再触发一轮（先停再启）；此时 running === MAX_CONCURRENT，tick 应在取任务前就 return
  stopScheduler();
  await runOneTick(4);

  assert.equal(taskHolder.findManyCalls.length, 1, "槽位已满，第二轮不该再查 pending");
  releaseAll();
  for (let i = 0; i < 6; i++) await flush();
});

test("取 pending 时按剩余槽位 take，且只取 pending", async () => {
  resetAll();
  taskHolder.rows = [makeTask("a"), makeTask("b"), makeTask("c", "done")];

  await runOneTick();

  assert.equal(taskHolder.findManyCalls.length, 1);
  assert.deepEqual(taskHolder.findManyCalls[0].where, { status: "pending" });
  assert.equal(taskHolder.findManyCalls[0].take, 3, "空闲槽位 = MAX_CONCURRENT = 3");
});

// ---------------------------------------------------------------------------
// processTask
// ---------------------------------------------------------------------------

test("仓库不存在 → 置 failed 并广播，不再往后走", async () => {
  resetAll();
  repoHolder.rows = [];
  taskHolder.rows = [makeTask("t1")];

  await runOneTick();

  assert.deepEqual(statuses(), ["failed"]);
  const failed = taskHolder.updates[0];
  assert.equal(failed.data.errorMessage, "关联仓库不存在");
  assert.ok(eventHolder.published.some((p) => p.payload.status === "failed"));
});

test("成功路径：analyzing → reporting → done，每步都广播", async () => {
  resetAll();
  taskHolder.rows = [makeTask("t1")];

  await runOneTick();

  assert.deepEqual(statuses(), ["analyzing", "reporting", "done"]);
  assert.deepEqual(
    eventHolder.published.map((p) => p.payload.status),
    ["parsing", "analyzing", "reporting", "done"],
  );
});

test("成功路径会依次调用：读缓存 → 分析 → AI 增强 → 安全门禁 → 持久化 → GitLab 回写", async () => {
  resetAll();
  taskHolder.rows = [makeTask("t1")];

  await runOneTick();

  assert.equal(persistHolder.cacheRead, 1);
  assert.equal(enrichHolder.uncertain, 1);
  assert.equal(enrichHolder.security, 1);
  assert.equal(persistHolder.persisted, 1);
  assert.deepEqual(gitlabHolder.calls, [{ status: "done" }]);
});

test("runAnalysis 抛错 → 置 failed 并广播，且 GitLab 回写 failed", async () => {
  resetAll();
  analysisHolder.mode = "throw";
  taskHolder.rows = [makeTask("t1")];

  await runOneTick();

  assert.deepEqual(statuses(), ["analyzing", "failed"]);
  assert.match(String(taskHolder.updates[1].data.errorMessage), /analysis boom/);
  assert.deepEqual(gitlabHolder.calls, [{ status: "failed" }]);
});

// ---------------------------------------------------------------------------
// 超时：这一块对应 N3 那类「永不 settle / 状态被覆盖」的事故面
// 用假定时器推进到 TASK_TIMEOUT_MS（300s），避免真等 5 分钟
// ---------------------------------------------------------------------------

/** 启动一轮，并用假定时器把时间推到超时点 */
async function runOneTickThenTimeout() {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  try {
    startScheduler();
    for (let i = 0; i < 12; i++) await flush();
    mock.timers.tick(300_000);
    for (let i = 0; i < 12; i++) await flush();
  } finally {
    mock.timers.reset();
  }
}

// 源码在 processTask 里有**两道** `if (ctrl.cancelled) return;`：
//   ① 在 runAnalysis 之后   —— 拦在 reporting 之前
//   ② 在持久化之后、落 done 之前 —— 拦在 done 之前
// 两道都要单独能证伪，所以拆成两条用例，各自把「卡住的位置」放在对应守卫之前。
// （一开始我只写了一条、只断言「不该有 done」，结果删掉任意一道守卫测试都还是绿的 ——
//   因为另一道会兜住。那种断言粒度等于没写到点上。）

test("超时守卫①：分析中被超时 → 连 reporting 都不该落", async () => {
  resetAll();
  analysisHolder.mode = "manual"; // 卡在 runAnalysis，取消发生在守卫①之前
  taskHolder.rows = [makeTask("t1")];

  await runOneTickThenTimeout();

  assert.ok(statuses().includes("failed"), `应出现 failed，实际：${JSON.stringify(statuses())}`);
  assert.match(
    String(taskHolder.updates.find((u) => u.data.status === "failed")?.data.errorMessage),
    /超时/,
  );

  releaseAll();
  for (let i = 0; i < 8; i++) await flush();

  assert.ok(!statuses().includes("reporting"), "守卫①应拦在 reporting 之前");
  assert.ok(!statuses().includes("done"));
});

test("超时守卫②：已走到 reporting 才被超时 → 保留 failed，不落 done", async () => {
  resetAll();
  enrichHolder.mode = "manual"; // runAnalysis 正常返回，卡在后面的 AI 增强 → 守卫①已放行
  taskHolder.rows = [makeTask("t1")];

  await runOneTickThenTimeout();

  assert.ok(statuses().includes("failed"), `应出现 failed，实际：${JSON.stringify(statuses())}`);

  releaseAll();
  for (let i = 0; i < 8; i++) await flush();

  assert.ok(statuses().includes("reporting"), "这一步本应已走到 reporting");
  assert.ok(!statuses().includes("done"), "守卫②应拦住 done 落库，保留 failed");
});

test("超时不覆盖已处于 done 的任务", async () => {
  resetAll();
  analysisHolder.mode = "manual";
  taskHolder.rows = [makeTask("t1")];

  // 先让它正常跑完到 done（手动放行），再推进到超时点
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  try {
    startScheduler();
    for (let i = 0; i < 12; i++) await flush();
    releaseAll();
    for (let i = 0; i < 12; i++) await flush();
    mock.timers.tick(300_000);
    for (let i = 0; i < 12; i++) await flush();
  } finally {
    mock.timers.reset();
  }

  assert.ok(statuses().includes("done"));
  assert.ok(!statuses().includes("failed"), "已 done 的任务不该被超时改成 failed");
});
