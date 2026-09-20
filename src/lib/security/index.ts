// M5 安全门禁入口：把 CVE 扫描 + 构建体积检测的结果合并进分析报告。
// 与 enrichUncertain 同定位——「尽力而为」的增强，任何一步失败都静默降级，
// 绝不阻断主分析链路（任务仍会 done，只是缺安全门禁字段）。

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { AnalysisResult, DepChanges, DepChange } from "@/lib/types";
import { readManifest } from "./dependency-manifest";
import { scanVulnerabilities } from "./cve-scan";
import { measureBundleSize } from "./bundle-size";

/**
 * 比较两个依赖映射，产出依赖改动清单。
 * 纯函数、不碰 git/fs，便于单测（见 tests/dep-changes.test.ts）。
 */
export function diffDepMaps(
  base: Record<string, { version: string; isDev: boolean }>,
  head: Record<string, { version: string; isDev: boolean }>,
): DepChange[] {
  const changes: DepChange[] = [];
  const names = new Set([...Object.keys(base), ...Object.keys(head)]);
  for (const name of names) {
    const b = base[name];
    const h = head[name];
    if (!b && h) {
      changes.push({ name, to: h.version, kind: "added", isDev: h.isDev });
    } else if (b && !h) {
      changes.push({ name, from: b.version, kind: "removed", isDev: b.isDev });
    } else if (b && h && b.version !== h.version) {
      const kind = compareSemver(b.version, h.version) < 0 ? "upgraded" : "downgraded";
      changes.push({ name, from: b.version, to: h.version, kind, isDev: h.isDev });
    }
  }
  return changes;
}

/** 去掉 semver 范围前缀（^ ~ > < = 空格），取前三段数字比较；无法解析按 0 处理 */
function compareSemver(a: string, b: string): number {
  const parse = (s: string): number[] => {
    // 🔴 修 P1-5：原写法直接去前缀，遇到 `>=1.2.0 <2.0.0` 会变成 `1.2.02.0.0`，
    //    split(".") 取前三段得 [1,2,2] —— 上界 `<2.0.0` 的 2 污染了第三段。
    //    实测判反：`>=1.2.0 <2.0.0` vs `1.2.1` → downgraded（真实 upgraded）。
    //    先按 `||` 切、再按空白切，只取**首个版本范围**再比较。（零依赖，不引 semver 包）
    const first = s.split("||")[0].split(/\s+/).filter(Boolean)[0] ?? "";
    const parts = first.replace(/[\^~>=<\s]/g, "").split(".");
    return parts.slice(0, 3).map((p) => parseInt(p, 10) || 0);
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

/** P1-3：git show 也要有上限。worker 侧的 `git()` 有 120s 超时，而这里是全仓
 *  **唯一**一处 `execFileSync` 没给 `timeout` 的地方 —— 大仓库 / 慢盘上挂起会
 *  永久阻塞事件循环。安全门禁是「尽力而为」的增强，但**挂住就不是增强而是事故**。
 *  超时会抛错，已被下面现有的 `catch { return null }` 接住，不新增失败路径。 */
const GIT_SHOW_TIMEOUT_MS = 30000;

/** 读某个 ref 的 package.json 依赖映射；ref=null 表示读工作区当前文件（已 checkout 到 headRef） */
function readPkgDeps(
  workdir: string,
  ref: string | null,
): Record<string, { version: string; isDev: boolean }> | null {
  let raw: string | null = null;
  if (ref === null) {
    try {
      raw = fs.readFileSync(path.join(workdir, "package.json"), "utf8");
    } catch {
      return null;
    }
  } else {
    try {
      raw = execFileSync("git", ["show", `${ref}:package.json`], {
        cwd: workdir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: GIT_SHOW_TIMEOUT_MS,
      });
    } catch {
      return null; // git 不可用 / ref 不可达 / 该 ref 无 package.json
    }
  }
  if (!raw) return null;
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(raw);
  } catch {
    return null;
  }
  const out: Record<string, { version: string; isDev: boolean }> = {};
  const merge = (deps: Record<string, string> | undefined, isDev: boolean) => {
    if (!deps) return;
    for (const [name, version] of Object.entries(deps)) out[name] = { version, isDev };
  };
  merge(pkg.dependencies, false);
  merge(pkg.devDependencies, true);
  return out;
}

/**
 * U6(b)：比对 base/head 的 package.json，得出「本次 PR 改动了哪些依赖」。
 * 与「全仓依赖体检」（CVE 扫描整仓依赖树）是两回事——这里只回答「PR 自己动了哪些依赖」。
 * 任一 ref 缺失 / git 不可用 / 基线不可读 → 返回 unknown（绝不抛错，降级显示）。
 */
export function detectChangedDeps(workdir: string, baseRef?: string, headRef?: string): DepChanges {
  if (!baseRef || !headRef) return { status: "unknown", changes: [] };
  const base = readPkgDeps(workdir, baseRef);
  const head = readPkgDeps(workdir, null); // head 直接读工作区（已 checkout 到 headRef）
  if (!base || !head) return { status: "unknown", changes: [] };
  return { status: "ok", changes: diffDepMaps(base, head) };
}

/**
 * 就地增强 result：读仓库依赖清单，跑 CVE 扫描 + 体积检测。
 * @param workdir worker checkout 后的仓库根目录（含 package.json / package-lock.json）
 * @param baseRef 基线 ref（用于比对「本次 PR 改了哪些依赖」），缺失则 depChanges 为 unknown
 * @param headRef 头部分支 ref（worker 已将其 checkout 到 workdir）
 */
export async function enrichSecurity(
  result: AnalysisResult,
  workdir: string,
  baseRef?: string,
  headRef?: string,
): Promise<void> {
  let manifest;
  try {
    manifest = readManifest(workdir);
  } catch (err) {
    console.error("[security] 依赖清单读取失败:", err instanceof Error ? err.message : err);
    // U9：整条门禁都没跑起来，也要在报告上留状态，而不是"什么都不显示"
    result.securityStatus = { vulnerabilities: "failed", bundleSize: "failed" };
    return;
  }
  // U9：非 npm 项目不是"失败"，是"没跑"—— 两者在报告上必须能区分开
  if (!manifest) {
    result.securityStatus = { vulnerabilities: "skipped", bundleSize: "skipped" };
    return;
  }

  const [vulns, size] = await Promise.allSettled([
    scanVulnerabilities(manifest.all),
    measureBundleSize(manifest.direct),
  ]);

  // U9：**无论成败都写状态**。此前失败只 console.error（仅服务端日志），
  // 而 UI 是 `{r.vulnerabilities && (...)}` → 失败时整块不渲染，
  // 读者只能靠"怎么少了一块"反推。现在报告页能直接显示"未产出"。
  // U6(b)：同时挂上「本次 PR 改了哪些依赖」（比对 base/head 的 package.json）
  result.securityStatus = {
    vulnerabilities: vulns.status === "fulfilled" ? "ok" : "failed",
    bundleSize: size.status === "fulfilled" ? "ok" : "failed",
    depChanges: detectChangedDeps(workdir, baseRef, headRef),
  };

  if (vulns.status === "fulfilled") {
    result.vulnerabilities = vulns.value;
  } else {
    console.error("[security] CVE 扫描失败:", vulns.reason instanceof Error ? vulns.reason.message : vulns.reason);
  }

  if (size.status === "fulfilled") {
    result.bundleSize = size.value;
  } else {
    console.error("[security] 体积检测失败:", size.reason instanceof Error ? size.reason.message : size.reason);
  }
}
