// M5 构建体积检测：对顶层直接依赖查 npm registry 的 dist.unpackedSize，
// 累计总依赖解包体积 + 门禁阈值。聚焦「用户主动引入的依赖」体积，
// 避免传递依赖爆炸（几百个包）导致的请求风暴。

import type { BundleSizeReport } from "@/lib/types";
import type { DependencyInfo } from "./dependency-manifest";

const REGISTRY_URL = "https://registry.npmjs.org";
const TOTAL_THRESHOLD_BYTES = 100 * 1024 * 1024; // 顶层依赖总体积门禁：100MB
const CONCURRENCY = 8; // 并发查询上限

/** 精确 semver（x.y.z 开头）才可直接拼 URL，否则退回 latest */
function isExactVersion(v: string): boolean {
  return /^\d+\.\d+\.\d+/.test(v);
}

/** scoped 包名（@scope/name）里的 "/" 需编码为 %2F，@ 保留 */
function registryPath(name: string): string {
  return name.startsWith("@") ? name.replace("/", "%2F") : name;
}

/** 有限并发 map，保留顺序 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const worker = async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

interface RegistryVersion {
  version: string;
  dist?: { unpackedSize?: number };
}

/**
 * 测量顶层依赖总体积。单个包查询失败（404/网络）静默跳过，不影响整体。
 * fetchImpl 可注入以便单测 mock。
 */
export async function measureBundleSize(
  directDeps: DependencyInfo[],
  fetchImpl: typeof fetch = fetch,
): Promise<BundleSizeReport> {
  const rows = await mapWithConcurrency(directDeps, CONCURRENCY, async (dep) => {
    try {
      const version = isExactVersion(dep.version) ? dep.version : "latest";
      const url = `${REGISTRY_URL}/${registryPath(dep.name)}/${version}`;
      const resp = await fetchImpl(url);
      if (!resp.ok) return { name: dep.name, version: dep.version, bytes: 0 };
      const data = (await resp.json()) as RegistryVersion;
      return {
        name: dep.name,
        version: data.version ?? dep.version,
        bytes: data.dist?.unpackedSize ?? 0,
      };
    } catch {
      return { name: dep.name, version: dep.version, bytes: 0 };
    }
  });

  const packages = rows
    .filter((r) => r.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);

  const totalBytes = packages.reduce((sum, p) => sum + p.bytes, 0);
  const largest = packages.length > 0 ? packages[0] : null;

  return {
    totalBytes,
    packageCount: packages.length,
    largest,
    thresholdBytes: TOTAL_THRESHOLD_BYTES,
    exceeded: totalBytes > TOTAL_THRESHOLD_BYTES,
    packages,
  };
}
