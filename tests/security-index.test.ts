// C7 · `src/lib/security/index.ts` 的「失败不阻断主链路」语义（node:test + 模块 mock）
//
// 为什么先测这一条：它守护的是「安全门禁挂掉时，主分析链路不许被拖死」，
// 也就是检测型系统里最容易「看起来正常、其实整段被静默跳过」的地方。
//
// 本文件同时是**本仓库的第一套「模块 mock」范式**（见 docs/AUDIT-BACKLOG.md §二.1），
// 后续 C4 / C2 / C3 等要走 DB 的模块都复用同一套写法：
//   ① `mock.module(绝对路径, { namedExports })` 替换掉模块级依赖（prisma / 子模块 / worker_threads）
//   ② 行为**不写死在 mock 里**，而是放进可变的 `holder`，由每个用例改写
//      （mock.module 没有「按用例重置」，用 holder 才能让不同用例走不同分支）
//   ③ **第一条用例必须是自检**：证明 mock 真的生效了。
//      否则整套断言可能都在对着「真实实现」跑，结论全部无效。
//
// ⚠️ 运行本文件依赖 `--experimental-test-module-mocks`（已写进 package.json 的 test 脚本）。

import { test, before, mock } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import type {
  AnalysisResult,
  BundleSizeReport,
  Vulnerability,
} from "../src/lib/types";
import type { DependencyInfo, DependencyManifest } from "../src/lib/security/dependency-manifest";

// ⚠️ 本文件不用顶层 `await import()`：tsx 在 package.json 无 `"type": "module"` 时会把 .ts 当 CJS，
//    顶层 await 会直接报 `ERR_REQUIRE_ASYNC_MODULE`。改用 `before` 钩子做「先注册 mock、再加载被测模块」。
let enrichSecurity: (result: AnalysisResult, workdir: string) => Promise<void>;

const abs = (fileName: string) =>
  fileURLToPath(new URL(`../src/lib/security/${fileName}`, import.meta.url));

// ---------------------------------------------------------------------------
// 可变 holder：mock 只注册一次，行为由各用例改写
// ---------------------------------------------------------------------------

const direct: DependencyInfo[] = [{ name: "left-pad", version: "1.3.0", isDirect: true }];
const transitive: DependencyInfo[] = [{ name: "deep-dep", version: "2.0.0", isDirect: false }];

const manifest: DependencyManifest = {
  direct,
  all: [...direct, ...transitive],
  hasLockfile: true,
};

const vulnerability: Vulnerability = {
  package: "left-pad",
  version: "1.3.0",
  severity: "high",
  title: "测试漏洞",
  url: "https://example.invalid/advisory",
  vulnerableVersions: "<1.3.1",
  isDirect: true,
};

const bundleReport: BundleSizeReport = {
  totalBytes: 123,
  packageCount: 1,
  largest: { name: "left-pad", version: "1.3.0", bytes: 123 },
  thresholdBytes: 1000,
  exceeded: false,
  packages: [{ name: "left-pad", version: "1.3.0", bytes: 123 }],
};

const holder: {
  manifest: DependencyManifest | null;
  manifestThrows: Error | null;
  cve: () => Promise<Vulnerability[]>;
  size: () => Promise<BundleSizeReport>;
  /** 记录子模块实际收到的入参，用于断言「接线有没有接错」 */
  seen: { all?: DependencyInfo[]; direct?: DependencyInfo[] };
  calls: { cve: number; size: number };
} = {
  manifest,
  manifestThrows: null,
  cve: async () => [],
  size: async () => bundleReport,
  seen: {},
  calls: { cve: 0, size: 0 },
};

before(async () => {
  mock.module(abs("dependency-manifest.ts"), {
    namedExports: {
      readManifest: () => {
        if (holder.manifestThrows) throw holder.manifestThrows;
        return holder.manifest;
      },
    },
  });

  mock.module(abs("cve-scan.ts"), {
    namedExports: {
      scanVulnerabilities: (deps: DependencyInfo[]) => {
        holder.calls.cve += 1;
        holder.seen.all = deps;
        return holder.cve();
      },
    },
  });

  mock.module(abs("bundle-size.ts"), {
    namedExports: {
      measureBundleSize: (deps: DependencyInfo[]) => {
        holder.calls.size += 1;
        holder.seen.direct = deps;
        return holder.size();
      },
    },
  });

  // 注意：这里**不带 `.ts` 扩展名** —— TS 的 `allowImportingTsExtensions` 未开，
  // 带扩展名会被 typecheck 拒（TS5097）。tsx 对无扩展名路径能正常解析。
  ({ enrichSecurity } = await import("../src/lib/security/index"));
});

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function reset(): void {
  holder.manifest = manifest;
  holder.manifestThrows = null;
  holder.cve = async () => [vulnerability];
  holder.size = async () => bundleReport;
  holder.seen = {};
  holder.calls = { cve: 0, size: 0 };
}

/** 最小可用的 AnalysisResult（本用例只关心 security 两个可选字段） */
function makeResult(): AnalysisResult {
  return {
    changedFiles: [{ path: "src/api.ts", status: "modified" }],
    changedSymbols: [],
    impactChain: [],
    summary: {
      totalFiles: 1,
      totalSymbols: 0,
      changedFileCount: 1,
      changedSymbolCount: 0,
      cacheHits: 0,
      high: 0,
      medium: 0,
      low: 0,
    },
  };
}

// workdir 用一个**必然不存在**的目录：若 mock 未生效，真实 readManifest 会走真实文件系统
// → 返回 null（非 npm 项目）→ 两个字段都写不进去 → 用例会红。这就是自检的原理。
const WORKDIR = "/nonexistent-c7-fixture-dir";

// ---------------------------------------------------------------------------

test("自检：模块 mock 确实生效（不生效则本文件其余断言全部无效）", async () => {
  reset();
  const result = makeResult();

  await enrichSecurity(result, WORKDIR);

  assert.equal(result.vulnerabilities?.length, 1);
  assert.equal(result.bundleSize?.totalBytes, 123);
  assert.equal(holder.calls.cve, 1);
  assert.equal(holder.calls.size, 1);
});

test("接线正确：CVE 收到完整依赖树（all），体积检测只收到直接依赖（direct）", async () => {
  reset();
  const result = makeResult();

  await enrichSecurity(result, WORKDIR);

  assert.deepEqual(holder.seen.all, [...direct, ...transitive]);
  assert.deepEqual(holder.seen.direct, direct);
});

test("非 npm 项目（无 package.json）：跳过整段安全门禁，且不调用任何子模块", async () => {
  reset();
  holder.manifest = null;
  const result = makeResult();

  await enrichSecurity(result, WORKDIR);

  assert.equal(result.vulnerabilities, undefined);
  assert.equal(result.bundleSize, undefined);
  assert.equal(holder.calls.cve, 0);
  assert.equal(holder.calls.size, 0);
});

test("依赖清单读取失败：吞掉异常直接返回，不阻断主链路", async () => {
  reset();
  holder.manifestThrows = new Error("lockfile 解析炸了");
  const result = makeResult();

  // 关键：不许抛出 —— 抛出去会让整个分析任务变成 failed
  await enrichSecurity(result, WORKDIR);

  assert.equal(result.vulnerabilities, undefined);
  assert.equal(result.bundleSize, undefined);
  assert.equal(holder.calls.cve, 0);
  assert.equal(holder.calls.size, 0);
});

test("CVE 失败但体积检测成功：成功的那一项仍要写入（allSettled 语义）", async () => {
  reset();
  holder.cve = async () => {
    throw new Error("npm registry 挂了");
  };
  const result = makeResult();

  await enrichSecurity(result, WORKDIR);

  // 这一条是与「Promise.all」的分水岭：用 all 的话整段会抛错，体积结果一起丢
  assert.equal(result.vulnerabilities, undefined);
  assert.equal(result.bundleSize?.totalBytes, 123);
  assert.equal(holder.calls.cve, 1);
  assert.equal(holder.calls.size, 1);
});

test("两项都失败：静默降级，不写入字段也不抛出", async () => {
  reset();
  holder.cve = async () => {
    throw new Error("CVE 不可用");
  };
  holder.size = async () => {
    throw new Error("体积检测不可用");
  };
  const result = makeResult();

  await enrichSecurity(result, WORKDIR);

  assert.equal(result.vulnerabilities, undefined);
  assert.equal(result.bundleSize, undefined);
});
