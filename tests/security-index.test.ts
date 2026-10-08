// C7 · `src/lib/security/index.ts` 的「失败不阻断主链路」语义 (Jest)
// 使用 jest.mock() 替代 node:test 的 mock.module()

import { jest } from '@jest/globals';
import assert from 'node:assert/strict';
import type {
  AnalysisResult,
  BundleSizeReport,
  Vulnerability,
} from '../src/lib/types';
import type { DependencyInfo, DependencyManifest } from '../src/lib/security/dependency-manifest';

// Holder for mutable mock behaviors
const direct: DependencyInfo[] = [{ name: 'left-pad', version: '1.3.0', isDirect: true }];
const transitive: DependencyInfo[] = [{ name: 'deep-dep', version: '2.0.0', isDirect: false }];

const manifest: DependencyManifest = {
  direct,
  all: [...direct, ...transitive],
  hasLockfile: true,
};

const vulnerability: Vulnerability = {
  package: 'left-pad',
  version: '1.3.0',
  severity: 'high',
  title: '测试漏洞',
  url: 'https://example.invalid/advisory',
  vulnerableVersions: '<1.3.1',
  isDirect: true,
};

const bundleReport: BundleSizeReport = {
  totalBytes: 123,
  packageCount: 1,
  largest: { name: 'left-pad', version: '1.3.0', bytes: 123 },
  thresholdBytes: 1000,
  exceeded: false,
  packages: [{ name: 'left-pad', version: '1.3.0', bytes: 123 }],
};

const holder: {
  manifest: DependencyManifest | null;
  manifestThrows: Error | null;
  cve: () => Promise<Vulnerability[]>;
  size: () => Promise<BundleSizeReport>;
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

// Mock dependency-manifest module
jest.mock('../src/lib/security/dependency-manifest.ts', () => ({
  readManifest: () => {
    if (holder.manifestThrows) throw holder.manifestThrows;
    return holder.manifest;
  },
}));

// Mock cve-scan module
jest.mock('../src/lib/security/cve-scan.ts', () => ({
  scanVulnerabilities: (deps: DependencyInfo[]) => {
    holder.calls.cve += 1;
    holder.seen.all = deps;
    return holder.cve();
  },
}));

// Mock bundle-size module
jest.mock('../src/lib/security/bundle-size.ts', () => ({
  measureBundleSize: (deps: DependencyInfo[]) => {
    holder.calls.size += 1;
    holder.seen.direct = deps;
    return holder.size();
  },
}));

// Import the module under test after mocks are set up
let enrichSecurity: (result: AnalysisResult, workdir: string) => Promise<void>;

beforeAll(async () => {
  const mod = await import('../src/lib/security/index');
  enrichSecurity = mod.enrichSecurity;
});

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
    changedFiles: [{ path: 'src/api.ts', status: 'modified' }],
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
const WORKDIR = '/nonexistent-c7-fixture-dir';

// ---------------------------------------------------------------------------

test('自检：模块 mock 确实生效（不生效则本文件其余断言全部无效）', async () => {
  reset();
  const result = makeResult();

  await enrichSecurity(result, WORKDIR);

  assert.equal(result.vulnerabilities?.length, 1);
  assert.equal(result.bundleSize?.totalBytes, 123);
  assert.equal(holder.calls.cve, 1);
  assert.equal(holder.calls.size, 1);
});

test('接线正确：CVE 收到完整依赖树（all），体积检测只收到直接依赖（direct）', async () => {
  reset();
  const result = makeResult();

  await enrichSecurity(result, WORKDIR);

  assert.deepEqual(holder.seen.all, [...direct, ...transitive]);
  assert.deepEqual(holder.seen.direct, direct);
});

test('非 npm 项目（无 package.json）：跳过整段安全门禁，且不调用任何子模块', async () => {
  reset();
  holder.manifest = null;
  const result = makeResult();

  await enrichSecurity(result, WORKDIR);

  assert.equal(result.vulnerabilities, undefined);
  assert.equal(result.bundleSize, undefined);
  assert.equal(holder.calls.cve, 0);
  assert.equal(holder.calls.size, 0);
});

test('依赖清单读取失败：吞掉异常直接返回，不阻断主链路', async () => {
  reset();
  holder.manifestThrows = new Error('lockfile 解析炸了');
  const result = makeResult();

  // 关键：不许抛出 —— 抛出去会让整个分析任务变成 failed
  await enrichSecurity(result, WORKDIR);

  assert.equal(result.vulnerabilities, undefined);
  assert.equal(result.bundleSize, undefined);
  assert.equal(holder.calls.cve, 0);
  assert.equal(holder.calls.size, 0);
});

test('CVE 失败但体积检测成功：成功的那一项仍要写入（allSettled 语义）', async () => {
  reset();
  holder.cve = async () => {
    throw new Error('npm registry 挂了');
  };
  const result = makeResult();

  await enrichSecurity(result, WORKDIR);

  // 这一条是与「Promise.all」的分水岭：用 all 的话整段会抛错，体积结果一起丢
  assert.equal(result.vulnerabilities, undefined);
  assert.equal(result.bundleSize?.totalBytes, 123);
  assert.equal(holder.calls.cve, 1);
  assert.equal(holder.calls.size, 1);
});

test('两项都失败：静默降级，不写入字段也不抛出', async () => {
  reset();
  holder.cve = async () => {
    throw new Error('CVE 不可用');
  };
  holder.size = async () => {
    throw new Error('体积检测不可用');
  };
  const result = makeResult();

  await enrichSecurity(result, WORKDIR);

  assert.equal(result.vulnerabilities, undefined);
  assert.equal(result.bundleSize, undefined);
});
