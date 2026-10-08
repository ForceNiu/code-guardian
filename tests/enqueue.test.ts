// C3 · `src/lib/enqueue.ts` 入队幂等单测 (Jest)
// 使用 jest.mock() 替代 node:test 的 mock.module()

import { jest } from '@jest/globals';
import assert from 'node:assert/strict';
import type { EnqueueInput, EnqueueResult } from '../src/lib/enqueue';

// Type for the mocked Prisma error
class MockPrismaKnownRequestError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'PrismaClientKnownRequestError';
    this.code = code;
  }
}

// Holder for mutable mock behaviors
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

const repoHolder = {
  findUnique: jest.fn(async (gitUrl: string): Promise<RepoRow | null> =>
    gitUrl === 'https://github.com/user/repo.git' ? { id: 'repo-1', name: 'repo', gitUrl } : null),
  create: jest.fn(async (data: { name: string; gitUrl: string }): Promise<RepoRow> => ({
    id: 'repo-1',
    name: data.name,
    gitUrl: data.gitUrl,
  })),
};

const taskHolder = {
  create: jest.fn(async (data: CreateTaskData): Promise<TaskRow> => ({
    id: 'TASK-FROM-MOCK',
    repoId: data.repoId,
    mrId: data.mrId,
    commitSha: data.commitSha,
  })),
  findUnique: jest.fn(async (key: CompositeKey | undefined): Promise<TaskRow | null> => {
    if (key && key.repoId === 'repo-1' && key.mrId === '12' && key.commitSha === 'abc') {
      return { id: 'EXISTING-TASK', repoId: key.repoId, mrId: key.mrId, commitSha: key.commitSha };
    }
    return null;
  }),
};

const eventBusHolder = {
  published: [] as PublishCall[],
  publish: jest.fn((taskId: string, payload: { status: string }) => {
    eventBusHolder.published.push({ taskId, payload });
  }),
};

let lastTaskCreateData: CreateTaskData | null = null;
let repoCreateCalls = 0;

// Mock @prisma/client
jest.mock('@prisma/client', () => ({
  Prisma: {
    PrismaClientKnownRequestError: MockPrismaKnownRequestError,
  },
}));

// Mock prisma module
jest.mock('../src/lib/prisma.ts', () => ({
  prisma: {
    repository: {
      findUnique: (arg: { where: { gitUrl: string } }) => repoHolder.findUnique(arg.where.gitUrl),
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
}));

// Mock events module
jest.mock('../src/lib/events.ts', () => ({
  getEventBus: () => eventBusHolder,
}));

// Import the module under test after mocks are set up
let enqueueTask: (input: EnqueueInput) => Promise<EnqueueResult>;

beforeAll(async () => {
  const mod = await import('../src/lib/enqueue');
  enqueueTask = mod.enqueueTask;
});

function resetAll() {
  lastTaskCreateData = null;
  repoCreateCalls = 0;
  eventBusHolder.published = [];
  jest.clearAllMocks();
}

function makeInput(overrides: Partial<EnqueueInput> = {}): EnqueueInput {
  return {
    gitUrl: 'https://github.com/user/repo.git',
    mrId: '12',
    commitSha: 'abc',
    baseRef: 'main',
    headRef: 'feature',
    source: 'manual',
    gitlabProjectId: '123',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 自检：mock 生效
// ---------------------------------------------------------------------------

test('自检：created 的 taskId 来自 mock 哨兵', async () => {
  resetAll();

  const result = await enqueueTask(makeInput({ mrId: 'new-1', commitSha: 'new-sha' }));

  assert.equal(result.status, 'created');
  assert.equal(result.taskId, 'TASK-FROM-MOCK');
});

// ---------------------------------------------------------------------------
// 仓库的找 / 建
// ---------------------------------------------------------------------------

test('仓库已存在 → 不再建仓，直接复用 repo-1', async () => {
  resetAll();

  await enqueueTask(makeInput({ mrId: 'n1', commitSha: 's1' }));

  assert.equal(repoCreateCalls, 0);
  assert.equal(lastTaskCreateData?.repoId, 'repo-1');
});

test('仓库不存在 → 建仓，name 由 deriveName 从 gitUrl 推出', async () => {
  resetAll();

  await enqueueTask(makeInput({ gitUrl: 'https://github.com/other/widget.git', mrId: '5', commitSha: 'def' }));

  assert.equal(repoCreateCalls, 1);
  assert.equal(lastTaskCreateData?.repoId, 'repo-1');
});

test('deriveName 边界：尾斜杠 + .git 都剥掉，仍取到最后一段', async () => {
  resetAll();
  let createdName = '';
  // Store original implementation before mocking
  const originalCreateImpl = repoHolder.create.getMockImplementation();
  repoHolder.create.mockImplementation(async (data: { name: string; gitUrl: string }) => {
    createdName = data.name;
    // Call original implementation directly
    return { id: 'repo-1', name: data.name, gitUrl: data.gitUrl };
  });

  await enqueueTask(makeInput({ gitUrl: 'https://github.com/other/widget.git/', mrId: '6', commitSha: 'ghi' }));
  assert.equal(createdName, 'widget');
});

// ---------------------------------------------------------------------------
// 幂等：P2002 → duplicate
// ---------------------------------------------------------------------------

test('重复入队（P2002）→ duplicate，taskId 来自复合索引查回的既有任务', async () => {
  resetAll();
  taskHolder.create.mockRejectedValueOnce(new MockPrismaKnownRequestError('Unique constraint failed', 'P2002'));

  const result = await enqueueTask(makeInput());
  assert.equal(result.status, 'duplicate');
  assert.equal(result.taskId, 'EXISTING-TASK');
});

test('duplicate 分支不广播 pending（只有真正新建才广播）', async () => {
  resetAll();
  taskHolder.create.mockRejectedValueOnce(new MockPrismaKnownRequestError('Unique constraint failed', 'P2002'));

  await enqueueTask(makeInput());
  assert.deepEqual(eventBusHolder.published, []);
});

// ---------------------------------------------------------------------------
// M4 SSE：新建成功要广播 pending
// ---------------------------------------------------------------------------

test('created 时向事件总线广播 pending', async () => {
  resetAll();

  await enqueueTask(makeInput({ mrId: 'sse', commitSha: 'sse-sha' }));

  assert.deepEqual(eventBusHolder.published, [
    { taskId: 'TASK-FROM-MOCK', payload: { status: 'pending' } },
  ]);
});

// ---------------------------------------------------------------------------
// 缺省字段落库口径：baseRef/headRef → ""，source/gitlabProjectId → null
// ---------------------------------------------------------------------------

test('缺省字段按 ?? 口径落库（baseRef/headRef 空串，source 为 null）', async () => {
  resetAll();

  await enqueueTask(
    makeInput({
      mrId: 'd1',
      commitSha: 'd1',
      baseRef: undefined,
      headRef: undefined,
      source: undefined,
      gitlabProjectId: undefined,
    }),
  );

  assert.equal(lastTaskCreateData?.baseRef, '');
  assert.equal(lastTaskCreateData?.headRef, '');
  assert.equal(lastTaskCreateData?.source, null);
  assert.equal(lastTaskCreateData?.gitlabProjectId, null);
});

// ---------------------------------------------------------------------------
// 非 P2002 错误必须原样向上抛，不能被幂等分支吞掉
// ---------------------------------------------------------------------------

test('非 P2002 的 Prisma 错误原样向上抛', async () => {
  resetAll();
  taskHolder.create.mockRejectedValueOnce(new MockPrismaKnownRequestError('Connection reset', 'P1001'));

  await assert.rejects(
    async () => enqueueTask(makeInput({ mrId: 'err', commitSha: 'err' })),
    /Connection reset/,
  );
});

test('普通 Error 也向上抛（不走 duplicate 分支）', async () => {
  resetAll();
  taskHolder.create.mockRejectedValueOnce(new Error('db down'));

  await assert.rejects(
    async () => enqueueTask(makeInput({ mrId: 'err2', commitSha: 'err2' })),
    /db down/,
  );
});
