// M5 安全门禁：依赖清单提取。
// 从仓库根目录读 package.json（顶层直接依赖）+ package-lock.json（完整依赖树含精确版本），
// 供 CVE 扫描（用完整树）与构建体积检测（用顶层依赖）共用。

import fs from "node:fs";
import path from "node:path";

/** 单个依赖（含是否顶层直接依赖） */
export interface DependencyInfo {
  name: string;
  version: string; // 精确版本（lockfile）或 semver 范围（仅 package.json 时）
  isDirect: boolean;
}

/** 提取出的依赖清单 */
export interface DependencyManifest {
  /** 顶层直接依赖（dependencies + devDependencies） */
  direct: DependencyInfo[];
  /** 完整依赖树（含传递依赖），有 lockfile 时 version 为精确版本 */
  all: DependencyInfo[];
  hasLockfile: boolean;
}

/** 从 package.json 提取顶层依赖 name -> 声明版本 */
function readDirect(root: string): Record<string, string> {
  const pkgPath = path.join(root, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
}

/**
 * 从 package-lock.json 的 packages 字段提取完整依赖树。
 * lockfile v2/v3 的 packages key 是安装路径（"node_modules/xxx"，嵌套为
 * "node_modules/a/node_modules/b"），包名取最后一个 "node_modules/" 之后的部分。
 */
function readLockfile(root: string): DependencyInfo[] | null {
  const lockPath = path.join(root, "package-lock.json");
  if (!fs.existsSync(lockPath)) return null;
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8")) as {
    packages?: Record<string, { version?: string }>;
  };
  const packages = lock.packages;
  if (!packages) return null;

  const out: DependencyInfo[] = [];
  for (const [pkgPath, meta] of Object.entries(packages)) {
    if (!pkgPath || !meta.version) continue; // 跳过根条目 "" 和缺 version 的
    const segments = pkgPath.split("node_modules/");
    const name = segments[segments.length - 1];
    if (!name) continue;
    out.push({ name, version: meta.version, isDirect: false });
  }
  return out;
}

/** 读取仓库依赖清单；非 npm 项目（无 package.json）返回 null。 */
export function readManifest(root: string): DependencyManifest | null {
  const pkgPath = path.join(root, "package.json");
  if (!fs.existsSync(pkgPath)) return null;

  const directMap = readDirect(root);
  const direct = Object.entries(directMap)
    .filter(([name]) => !name.startsWith("@types/")) // @types 纯类型包，不参与体积/运行时漏洞扫描
    .map(([name, version]) => ({ name, version, isDirect: true }));

  const directNames = new Set(direct.map((d) => d.name));
  const lockEntries = readLockfile(root);

  // 有 lockfile 时，用精确版本覆盖 direct 的 semver 范围（供体积/漏洞精确查询）
  if (lockEntries) {
    const exactVersion = new Map<string, string>();
    for (const e of lockEntries) {
      if (directNames.has(e.name) && !exactVersion.has(e.name)) exactVersion.set(e.name, e.version);
    }
    for (const d of direct) {
      const v = exactVersion.get(d.name);
      if (v) d.version = v;
    }
  }

  const all: DependencyInfo[] = lockEntries
    ? lockEntries.map((e) => ({ ...e, isDirect: directNames.has(e.name) }))
    : direct;

  return { direct, all, hasLockfile: lockEntries !== null };
}
