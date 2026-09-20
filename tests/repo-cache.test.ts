// P0-3 · 仓库缓存淘汰单测
//
// 只测「策略」—— `pickEvictable` 是纯函数，能定点断言；`scanRepoCache` / `dirBytes`
// 用真 tmp 目录测。真正执行 `rmSync` 的 `pruneRepoCache` **不在单测里跑**（副作用，
// 且删错了会波及开发机），它的正确性由上面两个函数 + 代码评审兜住。
//
// 为什么必须有这层：仓库工作目录是「只增不减」的（ensureRepo 只 clone/fetch、从不删），
// 单实例部署下会一直涨到磁盘满。淘汰逻辑写错了（比如删掉正在用的目录）比不淘汰更糟，
// 所以策略要能单测。

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  pickEvictable,
  scanRepoCache,
  dirBytes,
  type CacheEntry,
} from "../src/lib/repo-cache";

const entry = (dir: string, mtimeMs: number, bytes = 1000): CacheEntry => ({
  dir,
  mtimeMs,
  bytes,
});

test("未超限时一个都不删", () => {
  const entries = [entry("a", 1), entry("b", 2)];
  assert.deepEqual(pickEvictable(entries, { maxRepos: 20, maxBytes: 10 ** 9 }), []);
});

test("目录数超限时删最久未用的（mtime 最小）", () => {
  const entries = [entry("new", 300), entry("old", 100), entry("mid", 200)];
  assert.deepEqual(pickEvictable(entries, { maxRepos: 1, maxBytes: 10 ** 9 }), ["old", "mid"]);
});

test("总字节超限时也触发淘汰", () => {
  const entries = [entry("new", 300, 800), entry("old", 100, 800)];
  assert.deepEqual(pickEvictable(entries, { maxRepos: 20, maxBytes: 1000 }), ["old"]);
});

test("protectedDirs 里的目录永不被选中（正在跑的任务不能被删）", () => {
  const entries = [entry("inuse", 1), entry("old", 2), entry("mid", 3)];
  const out = pickEvictable(entries, { maxRepos: 1, protectedDirs: new Set(["inuse"]) });
  assert.ok(!out.includes("inuse"), "正在使用的目录绝不能被淘汰");
  assert.deepEqual(out, ["old", "mid"]);
});

test("空列表 → 返回空数组", () => {
  assert.deepEqual(pickEvictable([], { maxRepos: 1 }), []);
});

test("scanRepoCache：缓存目录不存在 → 空数组，且不抛", () => {
  assert.deepEqual(scanRepoCache(path.join(os.tmpdir(), "cg-no-such-cache-dir")), []);
});

test("scanRepoCache：只认带 .git 的目录，忽略散落文件与普通目录", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cg-cache-"));
  fs.mkdirSync(path.join(root, "repo-with-git", ".git"), { recursive: true });
  fs.mkdirSync(path.join(root, "plain-dir"));
  fs.writeFileSync(path.join(root, "stray.txt"), "x");
  const got = scanRepoCache(root).map((e) => path.basename(e.dir));
  assert.deepEqual(got.sort(), ["repo-with-git"]);
  assert.ok(dirBytes(root) > 0, "dirBytes 应统计到 stray.txt");
  fs.rmSync(root, { recursive: true, force: true });
});
