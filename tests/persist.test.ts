// C2 · `src/lib/persist.ts` 持久化与增量缓存读取单测（node:test + 模块 mock）
// 范式见 tests/security-index.test.ts 与技能 detection-regression-discipline ⑥：
//   ① mock.module(绝对路径, { namedExports }) 替换模块级依赖（这里是 ./prisma 的单例）
//   ② 行为放可变 holder，各用例改写（mock.module 没有「按用例 reset」）
//   ③ 第一条用例必须是自检：断言一个真实实现不可能返回的哨兵值
//   ④ 被 mock 的导出必须真实存在：persist.ts 只导出 persistSymbolTable / readSymbolCache
// ⚠️ 运行依赖 `--experimental-test-module-mocks`（已写进 package.json 的 test 脚本）

import { test, before, mock } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import type {
  SymbolTableEntry,
  SymbolCache,
  SymbolInfo,
  ImportInfo,
  ReexportInfo,
} from "../src/lib/types";

// ---------------------------------------------------------------------------
// 被测模块：mock 注册之后才能动态导入
// ---------------------------------------------------------------------------

let persistSymbolTable: (repoId: string, symbolTable: SymbolTableEntry[]) => Promise<void>;
let readSymbolCache: (repoId: string) => Promise<SymbolCache>;

const absPrisma = fileURLToPath(new URL("../src/lib/prisma.ts", import.meta.url));

// ---------------------------------------------------------------------------
// 假依赖：类型 + 可变 holder
// ---------------------------------------------------------------------------

type TxFake = {
  exportSymbol: {
    deleteMany: () => Promise<void>;
    createMany: (arg: { data: unknown[] }) => Promise<void>;
  };
  fileSnapshot: {
    upsert: () => Promise<void>;
  };
};

type CachedSymbols = {
  exports?: SymbolInfo[];
  imports?: ImportInfo[];
  reexports?: ReexportInfo[];
};

type SnapshotRow = {
  repoId: string;
  filePath: string;
  contentHash: string;
  symbols: CachedSymbols | null;
};

/** 事务内的调用轨迹 —— 空表不该留下任何一条 */
let txCalls: string[] = [];
/** 是否进入了事务 —— 空表必须根本不进 */
let txEntered = 0;

const txHolder: TxFake = {
  exportSymbol: {
    deleteMany: async () => {
      txCalls.push("deleteMany");
    },
    createMany: async () => {
      txCalls.push("createMany");
    },
  },
  fileSnapshot: {
    upsert: async () => {
      txCalls.push("upsert");
    },
  },
};

const snapshotHolder = {
  rows: [] as SnapshotRow[],
};

before(async () => {
  mock.module(absPrisma, {
    namedExports: {
      prisma: {
        // 真实实现会传第二个参数 { timeout: 30000 }，运行时多传实参无害，这里不接它
        $transaction: async (fn: (tx: TxFake) => Promise<void>) => {
          txEntered++;
          return fn(txHolder);
        },
        fileSnapshot: {
          findMany: async (arg: { where: { repoId: string } }) =>
            snapshotHolder.rows.filter((r) => r.repoId === arg.where.repoId),
        },
      },
    },
  });

  // 动态 import 路径**不带 .ts 后缀**（会撞 TS5097，typecheck / build 都挂）
  ({ persistSymbolTable, readSymbolCache } = await import("../src/lib/persist"));
});

function resetTx() {
  txCalls = [];
  txEntered = 0;
}

function resetSnapshots() {
  snapshotHolder.rows = [];
}

/**
 * 夹具必须贴合真实类型（这是上一版踩的坑：凭猜测写的字段与 types.ts 不符，typecheck 直接红）：
 *   symbols[]    的 importers 是**必填**
 *   imports[]    用的是 source，不是 from
 *   reexports[]  只有 { source, line }
 */
function makeSymbolTable(): SymbolTableEntry[] {
  return [
    {
      filePath: "/test/file.ts",
      hash: "hash123",
      symbols: [{ name: "sym1", type: "function", line: 10, importers: ["/test/a.ts"] }],
      exports: [{ name: "exp1", type: "function", line: 1 }],
      imports: [{ name: "imp1", source: "./imp", line: 2 }],
      reexports: [{ source: "./barrel", line: 3 }],
    },
  ];
}

// ---------------------------------------------------------------------------
// 自检：两条，分别证明「读」和「写」的 mock 都真的接进来了
// 哨兵值由 mock 产出，真实实现（会去连真库）不可能返回它
// ---------------------------------------------------------------------------

test("自检：readSymbolCache 读到 mock 独有的哨兵哈希", async () => {
  resetSnapshots();
  snapshotHolder.rows = [
    {
      repoId: "test-repo",
      filePath: "/sentinel.ts",
      contentHash: "HASH-ONLY-MOCK-CAN-PRODUCE",
      symbols: null,
    },
  ];

  const cache = await readSymbolCache("test-repo");

  assert.equal(cache.hashByFile["/sentinel.ts"], "HASH-ONLY-MOCK-CAN-PRODUCE");
});

test("自检：persistSymbolTable 确实进了 mock 事务（upsert 被调用）", async () => {
  resetTx();

  await persistSymbolTable("test-repo", makeSymbolTable());

  assert.ok(txEntered > 0, "mock 的 $transaction 应被调用");
  assert.ok(txCalls.includes("upsert"), "事务内应发生 upsert");
});

// ---------------------------------------------------------------------------
// persistSymbolTable
// ---------------------------------------------------------------------------

test("persistSymbolTable 调用顺序：deleteMany → createMany → upsert", async () => {
  resetTx();

  await persistSymbolTable("test-repo", makeSymbolTable());

  assert.deepEqual(txCalls, ["deleteMany", "createMany", "upsert"]);
});

test("persistSymbolTable 空 symbolTable 直接返回，不进事务", async () => {
  resetTx();

  await persistSymbolTable("test-repo", []);

  assert.equal(txEntered, 0, "空表根本不该开事务");
  assert.deepEqual(txCalls, []);
});

// ---------------------------------------------------------------------------
// readSymbolCache
// ---------------------------------------------------------------------------

test("readSymbolCache 按快照拆出四张表", async () => {
  resetSnapshots();
  snapshotHolder.rows = [
    {
      repoId: "test-repo",
      filePath: "/test/file.ts",
      contentHash: "hash123",
      symbols: {
        exports: [{ name: "exp1", type: "function", line: 1 }],
        imports: [{ name: "imp1", source: "./imp", line: 2 }],
        reexports: [{ source: "./barrel", line: 3 }],
      },
    },
  ];

  const cache = await readSymbolCache("test-repo");

  assert.deepEqual(cache.hashByFile, { "/test/file.ts": "hash123" });
  assert.deepEqual(cache.exportsByFile["/test/file.ts"], [
    { name: "exp1", type: "function", line: 1 },
  ]);
  assert.deepEqual(cache.importsByFile["/test/file.ts"], [
    { name: "imp1", source: "./imp", line: 2 },
  ]);
  assert.deepEqual(cache.reexportsByFile?.["/test/file.ts"], [{ source: "./barrel", line: 3 }]);
});

test("readSymbolCache 无快照 → 四张空表", async () => {
  resetSnapshots();

  const cache = await readSymbolCache("unknown-repo");

  assert.deepEqual(cache, {
    hashByFile: {},
    exportsByFile: {},
    importsByFile: {},
    reexportsByFile: {},
  });
});

test("readSymbolCache 只返回该 repo 的快照，不串仓", async () => {
  resetSnapshots();
  snapshotHolder.rows = [
    { repoId: "repo-A", filePath: "/a.ts", contentHash: "ha", symbols: null },
    { repoId: "repo-B", filePath: "/b.ts", contentHash: "hb", symbols: null },
  ];

  const cache = await readSymbolCache("repo-A");

  assert.deepEqual(cache.hashByFile, { "/a.ts": "ha" });
});

// ---------------------------------------------------------------------------
// 防御性解析：readSymbolCache 对「旧缓存 / 脏数据」必须容错（不抛、不写入残缺项）
// 真实实现逐字段用 Array.isArray 判过，下面几条就是它的守护断言
// ---------------------------------------------------------------------------

test("防御：symbols 为 null 时只出哈希，不崩", async () => {
  resetSnapshots();
  snapshotHolder.rows = [
    { repoId: "test-repo", filePath: "/old.ts", contentHash: "h1", symbols: null },
  ];

  const cache = await readSymbolCache("test-repo");

  assert.deepEqual(cache.hashByFile, { "/old.ts": "h1" });
  assert.deepEqual(cache.exportsByFile, {});
  assert.deepEqual(cache.importsByFile, {});
});

test("防御：旧缓存缺 reexports 字段时不崩，该项留空", async () => {
  resetSnapshots();
  snapshotHolder.rows = [
    {
      repoId: "test-repo",
      filePath: "/legacy.ts",
      contentHash: "h2",
      // 老快照只有 exports/imports，没有 reexports（types.ts 注释里写明要容错）
      symbols: {
        exports: [{ name: "e", type: "function", line: 1 }],
        imports: [{ name: "i", source: "./i", line: 2 }],
      },
    },
  ];

  const cache = await readSymbolCache("test-repo");

  assert.deepEqual(cache.hashByFile, { "/legacy.ts": "h2" });
  assert.deepEqual(cache.reexportsByFile, {});
});

test("防御：exports 不是数组（脏数据）时不写入", async () => {
  resetSnapshots();
  snapshotHolder.rows = [
    {
      repoId: "test-repo",
      filePath: "/dirty.ts",
      contentHash: "h3",
      symbols: { exports: "not-an-array" } as unknown as CachedSymbols,
    },
  ];

  const cache = await readSymbolCache("test-repo");

  assert.deepEqual(cache.hashByFile, { "/dirty.ts": "h3" });
  assert.deepEqual(cache.exportsByFile, {});
});
