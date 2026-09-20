// U6(b) · `diffDepMaps` 纯函数单测（不依赖 git/fs，直接验证依赖改动判定逻辑）
//
// 为什么单独测这一层：detectChangedDeps 的 git/fs 交互难在单测里稳定复现，
// 但其「两个依赖映射 → 改动清单」的核心判断是纯函数，抽出来测最稳、也最快暴露回归。

import { test } from "node:test";
import assert from "node:assert/strict";
import { diffDepMaps } from "../src/lib/security/index";

type M = Record<string, { version: string; isDev: boolean }>;

test("新增依赖被标为 added，且正确带 isDev", () => {
  const base: M = { a: { version: "1.0.0", isDev: false } };
  const head: M = { a: { version: "1.0.0", isDev: false }, b: { version: "2.0.0", isDev: true } };
  const c = diffDepMaps(base, head);
  assert.equal(c.length, 1);
  assert.deepEqual(c[0], { name: "b", to: "2.0.0", kind: "added", isDev: true });
});

test("声明版本号变大（^1.2.3 → ^1.3.0）判为 upgraded，并保留 from/to", () => {
  const base: M = { a: { version: "^1.2.3", isDev: false } };
  const head: M = { a: { version: "^1.3.0", isDev: false } };
  const c = diffDepMaps(base, head);
  assert.equal(c.length, 1);
  assert.equal(c[0].kind, "upgraded");
  assert.equal(c[0].from, "^1.2.3");
  assert.equal(c[0].to, "^1.3.0");
});

test("声明版本号变小判为 downgraded", () => {
  const base: M = { a: { version: "2.0.0", isDev: false } };
  const head: M = { a: { version: "1.0.0", isDev: false } };
  const c = diffDepMaps(base, head);
  assert.equal(c[0].kind, "downgraded");
});

test("移除依赖被标为 removed，isDev 取 base 侧", () => {
  const base: M = { a: { version: "1.0.0", isDev: true } };
  const head: M = {};
  const c = diffDepMaps(base, head);
  assert.equal(c.length, 1);
  assert.deepEqual(c[0], { name: "a", from: "1.0.0", kind: "removed", isDev: true });
});

test("版本完全相同不产生任何改动", () => {
  const base: M = { a: { version: "1.0.0", isDev: false } };
  const head: M = { a: { version: "1.0.0", isDev: false } };
  assert.equal(diffDepMaps(base, head).length, 0);
});

test("仅 isDev 变化（devDependencies ↔ dependencies）不算依赖改动", () => {
  const base: M = { a: { version: "1.0.0", isDev: false } };
  const head: M = { a: { version: "1.0.0", isDev: true } };
  assert.equal(diffDepMaps(base, head).length, 0);
});
