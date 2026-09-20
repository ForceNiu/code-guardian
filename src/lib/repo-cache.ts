// 仓库工作目录（.cache/repos/<repoId>）的容量治理。
//
// 背景（P0-3）：`worker/analyze.worker.cjs` 的 `ensureRepo()` 只 clone / fetch，
// **从不删除** —— 分析过的每个仓库都会永久留下一份完整 clone（含 .git）。
// 单实例部署下它会一直涨到磁盘满。本模块提供「按最久未用淘汰」。
//
// 设计：把「选谁删」抽成纯函数 `pickEvictable`（可定点单测），
// fs 删除留在 `pruneRepoCache`（不测）—— 副作用那部分没法稳定断言。
//
// ⚠️ 已知边界：`protectedDirs` 是**进程内**内存集合，**只在单实例部署下有效**。
//    多实例（每实例一套 .cache）时，A 实例可能删掉 B 实例正在用的目录。
//    若要覆盖多实例：淘汰前检查 `.git/index.lock`，或写 last-used marker 并在任务心跳里续期。
//    本项目是单实例部署（无 Redis / 消息队列，见 scheduler.ts 设计注释），故不过度设计。

import fs from "node:fs";
import path from "node:path";

export type CacheEntry = { dir: string; mtimeMs: number; bytes: number };

export const DEFAULT_MAX_REPOS = 20; // 最多保留 20 个仓库工作目录
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 总占用上限 2GB

/** 递归统计目录字节数；目录被并发删掉时按已读到的部分计，不抛。 */
export function dirBytes(dir: string): number {
  let total = 0;
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else total += fs.statSync(full).size;
    }
  };
  try {
    walk(dir);
  } catch {
    /* 目录已不存在 → 按已累计的算 */
  }
  return total;
}

/** 扫 .cache/repos 的一级子目录，产出 CacheEntry[]。
 *  跳过非目录、跳过没有 .git 的（只认我们自己 clone 出来的仓库，防误删无关文件）。 */
export function scanRepoCache(root: string): CacheEntry[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(root);
  } catch {
    return []; // 缓存目录还没建过
  }
  const out: CacheEntry[] = [];
  for (const name of names) {
    const dir = path.join(root, name);
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
      const gitDir = path.join(dir, ".git");
      if (!fs.existsSync(gitDir)) continue;
      // mtime 取 workdir 与其 .git 目录的较大值：fetch 更新的是 .git **内部**文件，
      // workdir 自身的 mtime 未必变化，只看它会把活跃仓库误判成冷的。
      const mtimeMs = Math.max(fs.statSync(dir).mtimeMs, fs.statSync(gitDir).mtimeMs);
      out.push({ dir, mtimeMs, bytes: dirBytes(dir) });
    } catch {
      continue;
    }
  }
  return out;
}

/** 纯函数：按 mtime 升序（最久未用优先）挑出要删的目录，直到同时满足两个上限。
 *  `protectedDirs` = 正在被任务使用的 workdir，绝不动。 */
export function pickEvictable(
  entries: CacheEntry[],
  opts: {
    maxRepos?: number;
    maxBytes?: number;
    protectedDirs?: ReadonlySet<string>;
  } = {},
): string[] {
  const maxRepos = opts.maxRepos ?? DEFAULT_MAX_REPOS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const keep = opts.protectedDirs ?? new Set<string>();
  const candidates = entries
    .filter((e) => !keep.has(e.dir))
    .sort((a, b) => a.mtimeMs - b.mtimeMs);
  const out: string[] = [];
  let count = entries.length;
  let bytes = entries.reduce((s, e) => s + e.bytes, 0);
  for (const e of candidates) {
    if (count <= maxRepos && bytes <= maxBytes) break;
    out.push(e.dir);
    count -= 1;
    bytes -= e.bytes;
  }
  return out;
}

/** 执行淘汰。**删除失败只记日志，绝不抛** —— 缓存治理不能反过来拖垮分析任务。 */
export function pruneRepoCache(
  root: string,
  opts: {
    maxRepos?: number;
    maxBytes?: number;
    protectedDirs?: ReadonlySet<string>;
  } = {},
): { removed: string[]; freedBytes: number } {
  const entries = scanRepoCache(root);
  const targets = pickEvictable(entries, opts);
  let freedBytes = 0;
  const removed: string[] = [];
  for (const dir of targets) {
    const bytes = entries.find((e) => e.dir === dir)?.bytes ?? 0;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push(dir);
      freedBytes += bytes;
    } catch (err) {
      console.error("[repo-cache] 删除失败:", err instanceof Error ? err.message : err);
    }
  }
  return { removed, freedBytes };
}
