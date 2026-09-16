// C3 · `src/lib/enqueue.ts` 入队幂等单测（node:test + 模块 mock）
// 范式见 tests/security-index.test.ts 与技能 detection-regression-discipline ⑥
// 被 mock 的每个导出都必须真实存在（这是上一版踩的坑：mock 了不存在的东西，断言全是假的）：
//   ./prisma       → prisma          （真实导出）
//   ./events       → getEventBus     （真实导出）
//   @prisma/client → Prisma          （只借用它的 PrismaClientKnownRequestError 做 instanceof 判定）
// ⚠️ 运行依赖 `--experimental-test-module-mocks`（已写进 package.json 的 test 脚本）

import { test, before, mock } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import type { EnqueueInput, EnqueueResult } from "../src/lib/enqueue";

let enqueueTask: (input: EnqueueInput) => Promise<EnqueueResult>;

const absPrisma = fileURLToPath(new URL("../src/lib/prisma.ts", import.meta.url));
const absEvents = fileURLToPath(new URL("../src/lib/events.ts", import.meta.url));

// ---------------------------------------------------------------------------
// 假 Prisma 错误：真实的 PrismaClientKnownRequestError 带 code 字段，
// enqueue.ts 用 `err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"` 判定
// ---------------------------------------------------------------------------

class MockPrismaKnownRequestError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "PrismaClientKnownRequestError";
    this.code = code;
  }
}

type RepoRow = { id: string; name: string; gitUrl: string };
type TaskRow = { id: string; repoId: string; mrId: string; commitSha: string };
type CreateTaskData = {
  repoId: string;
  mrId: string;
  commitSha: string;
  baseRef: string;
  headRef: string;
  source: string | null;
  gitlabProjectId: string | null;
};
type CompositeKey = { repoId: string; mrId: string; commitSha: string };
type PublishCall = { taskId: string; payload: { status: string } };

// ---------------------------------------------------------------------------
// 可变 holder：mock 只注册一次，行为由各用例改写
// ---------------------------------------------------------------------------

const repoHolder = {
  findUnique: async (gitUrl: string): Promise<RepoRow | null> =>
    gitUrl === "https://github.com/user/repo.git" ? { id: "repo-1", name: "repo", gitUrl } : null,
  create: async (data: { name: string; gitUrl: string }): Promise<RepoRow> => ({
    id: "repo-1",
    name: data.name,
    gitUrl: data.gitUrl,
  }),
};

const taskHolder = {
  create: async (data: CreateTaskData): Promise<TaskRow> => ({
    id: "TASK-FROM-MOCK",
    repoId: data.repoId,
    mrId: data.mrId,
    commitSha: data.commitSha,
  }),
  findUnique: async (key: CompositeKey | undefined): Promise<TaskRow | null> => {
    if (key && key.repoId === "repo-1" && key.mrId === "12" && key.commitSha === "abc") {
      return { id: "EXISTING-TASK", repoId: key.repoId, mrId: key.mrId, commitSha: key.commitSha };
    }
    return null;
  },
};

const eventBusHolder = {
  published: [] as PublishCall[],
  publish: (taskId: string, payload: { status: string }) => {
    eventBusHolder.published.push({ taskId, payload });
  },
};

/** 记录 repository.create / task.create 实际收到的东西，用来验 deriveName 与缺省字段落库 */
let lastTaskCreateData: CreateTaskData | null = null;
let repoCreateCalls = 0;

before(async () => {
  mock.module("@prisma/client", {
    namedExports: { Prisma: { PrismaClientKnownRequestError: MockPrismaKnownRequestError } },
  });

  mock.module(absPrisma, {
    namedExports: {
      prisma: {
        repository: {
          findUnique: (arg: { where: { gitUrl: string } }) =>
            repoHolder.findUnique(arg.where.gitUrl),
          create: (arg: { data: { name: string; gitUrl: string } }) => {
            repoCreateCalls++;
            return repoHolder.create(arg.data);
          },
        },
        task: {
          create: (arg: { data: CreateTaskData }) => {
            lastTaskCreateData = arg.data;
            return taskHolder.create(arg.data);
          },
          findUnique: (arg: { where: { repoId_mrId_commitSha?: CompositeKey } }) =>
            taskHolder.findUnique(arg.where.repoId_mrId_commitSha),
        },
      },
    },
  });

  mock.module(absEvents, {
    namedExports: { getEventBus: () => eventBusHolder },
  });

  // 动态 import 路径**不带 .ts 后缀**（TS5097）
  ({ enqueueTask } = await import("../src/lib/enqueue"));
});

function resetAll() {
  lastTaskCreateData = null;
  repoCreateCalls = 0;
  eventBusHolder.published = [];
}

function makeInput(overrides: Partial<EnqueueInput> = {}): EnqueueInput {
  return {
    gitUrl: "https://github.com/user/repo.git",
    mrId: "12",
    commitSha: "abc",
    baseRef: "main",
    headRef: "feature",
    source: "manual",
    gitlabProjectId: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 自检：哨兵 taskId 由 mock 产出，真实实现（会去连真库）不可能返回它
// ---------------------------------------------------------------------------

test("自检：created 的 taskId 来自 mock 哨兵", async () => {
  resetAll();

  const result = await enqueueTask(makeInput({ mrId: "new-1", commitSha: "new-sha" }));

  assert.equal(result.status, "created");
  assert.equal(result.taskId, "TASK-FROM-MOCK");
});

// ---------------------------------------------------------------------------
// 仓库的找 / 建
// ---------------------------------------------------------------------------

test("仓库已存在 → 不再建仓，直接复用 repo-1", async () => {
  resetAll();

  await enqueueTask(makeInput({ mrId: "n1", commitSha: "s1" }));

  assert.equal(repoCreateCalls, 0);
  assert.equal(lastTaskCreateData?.repoId, "repo-1");
});

test("仓库不存在 → 建仓，name 由 deriveName 从 gitUrl 推出", async () => {
  resetAll();

  await enqueueTask(makeInput({ gitUrl: "https://github.com/other/widget.git", mrId: "5", commitSha: "def" }));

  assert.equal(repoCreateCalls, 1);
  assert.equal(lastTaskCreateData?.repoId, "repo-1");
});

test("deriveName 边界：尾斜杠 + .git 都剥掉，仍取到最后一段", async () => {
  resetAll();
  let createdName = "";
  const origCreate = repoHolder.create;
  repoHolder.create = async (data: { name: string; gitUrl: string }) => {
    createdName = data.name;
    return origCreate(data);
  };

  try {
    await enqueueTask(makeInput({ gitUrl: "https://github.com/other/widget.git/", mrId: "6", commitSha: "ghi" }));
    assert.equal(createdName, "widget");
  } finally {
    repoHolder.create = origCreate;
  }
});

// ---------------------------------------------------------------------------
// 幂等：P2002 → duplicate
// ---------------------------------------------------------------------------

test("重复入队（P2002）→ duplicate，taskId 来自复合索引查回的既有任务", async () => {
  resetAll();
  const origCreate = taskHolder.create;
  taskHolder.create = async () => {
    throw new MockPrismaKnownRequestError("Unique constraint failed", "P2002");
  };

  try {
    const result = await enqueueTask(makeInput());
    assert.equal(result.status, "duplicate");
    assert.equal(result.taskId, "EXISTING-TASK");
  } finally {
    taskHolder.create = origCreate;
  }
});

test("duplicate 分支不广播 pending（只有真正新建才广播）", async () => {
  resetAll();
  const origCreate = taskHolder.create;
  taskHolder.create = async () => {
    throw new MockPrismaKnownRequestError("Unique constraint failed", "P2002");
  };

  try {
    await enqueueTask(makeInput());
    assert.deepEqual(eventBusHolder.published, []);
  } finally {
    taskHolder.create = origCreate;
  }
});

// ---------------------------------------------------------------------------
// M4 SSE：新建成功要广播 pending
// ---------------------------------------------------------------------------

test("created 时向事件总线广播 pending", async () => {
  resetAll();

  await enqueueTask(makeInput({ mrId: "sse", commitSha: "sse-sha" }));

  assert.deepEqual(eventBusHolder.published, [
    { taskId: "TASK-FROM-MOCK", payload: { status: "pending" } },
  ]);
});

// ---------------------------------------------------------------------------
// 缺省字段落库口径：baseRef/headRef → ""，source/gitlabProjectId → null
// ---------------------------------------------------------------------------

test("缺省字段按 ?? 口径落库（baseRef/headRef 空串，source 为 null）", async () => {
  resetAll();

  await enqueueTask(
    makeInput({
      mrId: "d1",
      commitSha: "d1",
      baseRef: undefined,
      headRef: undefined,
      source: undefined,
      gitlabProjectId: undefined,
    }),
  );

  assert.equal(lastTaskCreateData?.baseRef, "");
  assert.equal(lastTaskCreateData?.headRef, "");
  assert.equal(lastTaskCreateData?.source, null);
  assert.equal(lastTaskCreateData?.gitlabProjectId, null);
});

// ---------------------------------------------------------------------------
// 非 P2002 错误必须原样向上抛，不能被幂等分支吞掉
// ---------------------------------------------------------------------------

test("非 P2002 的 Prisma 错误原样向上抛", async () => {
  resetAll();
  const origCreate = taskHolder.create;
  taskHolder.create = async () => {
    throw new MockPrismaKnownRequestError("Connection reset", "P1001");
  };

  try {
    await assert.rejects(
      async () => enqueueTask(makeInput({ mrId: "err", commitSha: "err" })),
      /Connection reset/,
    );
  } finally {
    taskHolder.create = origCreate;
  }
});

test("普通 Error 也向上抛（不走 duplicate 分支）", async () => {
  resetAll();
  const origCreate = taskHolder.create;
  taskHolder.create = async () => {
    throw new Error("db down");
  };

  try {
    await assert.rejects(
      async () => enqueueTask(makeInput({ mrId: "err2", commitSha: "err2" })),
      /db down/,
    );
  } finally {
    taskHolder.create = origCreate;
  }
});
