// M5 构建体积检测单元测试（node:test + assert），mock fetch 验证 unpackedSize 累计与阈值。

import { test } from "node:test";
import assert from "node:assert/strict";
import { measureBundleSize } from "../src/lib/security/bundle-size";
import type { DependencyInfo } from "../src/lib/security/dependency-manifest";

/** 按 URL 返回不同体积的 mock fetch，记录请求的 URL 列表 */
function mockFetch(sizes: Record<string, number>, capture?: string[]) {
  return (async (url: string | URL) => {
    const u = String(url);
    capture?.push(u);
    const bytes = sizes[u];
    if (bytes === undefined) return { ok: false, status: 404, json: async () => ({}) } as Response;
    return { ok: true, status: 200, json: async () => ({ version: "1.0.0", dist: { unpackedSize: bytes } }) } as Response;
  }) as unknown as typeof fetch;
}

test("空依赖返回 0 体积、无最大包、未超阈值", async () => {
  const out = await measureBundleSize([], mockFetch({}));
  assert.equal(out.totalBytes, 0);
  assert.equal(out.packageCount, 0);
  assert.equal(out.largest, null);
  assert.equal(out.exceeded, false);
});

test("多个依赖：累计 unpackedSize、找最大包、按体积降序", async () => {
  const sizes: Record<string, number> = {
    "https://registry.npmjs.org/a/1.0.0": 1000,
    "https://registry.npmjs.org/b/2.0.0": 5000,
    "https://registry.npmjs.org/@scope%2Fc/3.0.0": 3000,
  };
  const deps: DependencyInfo[] = [
    { name: "a", version: "1.0.0", isDirect: true },
    { name: "b", version: "2.0.0", isDirect: true },
    { name: "@scope/c", version: "3.0.0", isDirect: true },
  ];
  const out = await measureBundleSize(deps, mockFetch(sizes));

  assert.equal(out.totalBytes, 9000);
  assert.equal(out.packageCount, 3);
  assert.equal(out.largest?.name, "b");
  assert.equal(out.largest?.bytes, 5000);
  assert.deepEqual(out.packages.map((p) => p.name), ["b", "@scope/c", "a"]); // 降序
  assert.equal(out.exceeded, false); // 远小于 100MB
});

test("scoped 包名路径正确编码（@ 保留、/ 编码为 %2F）", async () => {
  const urls: string[] = [];
  const deps: DependencyInfo[] = [{ name: "@scope/pkg", version: "1.0.0", isDirect: true }];
  const sizes = { "https://registry.npmjs.org/@scope%2Fpkg/1.0.0": 100 };
  await measureBundleSize(deps, mockFetch(sizes, urls));
  assert.equal(urls[0], "https://registry.npmjs.org/@scope%2Fpkg/1.0.0");
});

test("单个包查询失败（404）静默跳过，不影响整体", async () => {
  const deps: DependencyInfo[] = [
    { name: "ok", version: "1.0.0", isDirect: true },
    { name: "missing", version: "9.9.9", isDirect: true },
  ];
  const sizes = { "https://registry.npmjs.org/ok/1.0.0": 200 };
  const out = await measureBundleSize(deps, mockFetch(sizes));
  assert.equal(out.totalBytes, 200);
  assert.equal(out.packageCount, 1);
});

test("非精确版本（semver 范围）退回 latest 查询", async () => {
  const urls: string[] = [];
  const deps: DependencyInfo[] = [{ name: "pkg", version: "^1.0.0", isDirect: true }];
  const sizes = { "https://registry.npmjs.org/pkg/latest": 100 };
  await measureBundleSize(deps, mockFetch(sizes, urls));
  assert.equal(urls[0], "https://registry.npmjs.org/pkg/latest");
});

test("超过 100MB 总阈值时 exceeded=true", async () => {
  const deps: DependencyInfo[] = [{ name: "huge", version: "1.0.0", isDirect: true }];
  const sizes = { "https://registry.npmjs.org/huge/1.0.0": 101 * 1024 * 1024 };
  const out = await measureBundleSize(deps, mockFetch(sizes));
  assert.equal(out.exceeded, true);
});
