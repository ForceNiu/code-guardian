// M5 安全门禁入口：把 CVE 扫描 + 构建体积检测的结果合并进分析报告。
// 与 enrichUncertain 同定位——「尽力而为」的增强，任何一步失败都静默降级，
// 绝不阻断主分析链路（任务仍会 done，只是缺安全门禁字段）。

import type { AnalysisResult } from "@/lib/types";
import { readManifest } from "./dependency-manifest";
import { scanVulnerabilities } from "./cve-scan";
import { measureBundleSize } from "./bundle-size";

/**
 * 就地增强 result：读仓库依赖清单，跑 CVE 扫描 + 体积检测。
 * @param workdir worker checkout 后的仓库根目录（含 package.json / package-lock.json）
 */
export async function enrichSecurity(result: AnalysisResult, workdir: string): Promise<void> {
  let manifest;
  try {
    manifest = readManifest(workdir);
  } catch (err) {
    console.error("[security] 依赖清单读取失败:", err instanceof Error ? err.message : err);
    return;
  }
  if (!manifest) return; // 非 npm 项目（无 package.json），跳过安全门禁

  const [vulns, size] = await Promise.allSettled([
    scanVulnerabilities(manifest.all),
    measureBundleSize(manifest.direct),
  ]);

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
