// 静态报告导出：把 AnalysisResult 转成 answer-me-with-html 稿件，再调 am CLI 渲染成单文件 HTML。
//
// 为什么产物是「单文件 HTML」而不是 PDF / 截图：报告要能被转发 —— 贴 MR 评论、发 IM、归档。
// 单文件零外部依赖（不引 CDN / 外部字体），断网也能打开，收件人不需要装任何东西。
//
// 🔴 与本项目的两条既有约定对齐：
// 1. **CLI 路径只从 `getConfig()` 取**（`src/lib/config.ts` 顶部的硬约束：环境变量只在一处读）。
//    未配置 = 该能力关闭，调用方按 fail-closed 拒绝（返回 503），不是「静默跳过」。
// 2. **失败不外泄内部堆栈**：本模块的异常在 route 层只转成一句人话，细节进服务端日志
//    （同 `fix(scheduler): 失败任务 errorMessage 不再外泄内部堆栈` 的处理口径）。

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getConfig } from "@/lib/config";
import type { AnalysisResult } from "@/lib/types";

export type ReportInput = {
  repoName: string;
  mrId: string;
  baseRef: string;
  headRef: string;
  result: AnalysisResult;
};

/** 能力不可用（未配置 / CLI 缺失）。route 层据此返回 503，与两个写端点的 fail-closed 口径一致。 */
export class ReportUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportUnavailableError";
  }
}

/** 渲染超时：与 `security/index.ts` 里 git show 的口径一致（30s）。单次渲染实测约 50ms。 */
const RENDER_TIMEOUT_MS = 30_000;

const SEVERITY_CELL = { high: "no 高危", medium: "warn 中危", low: "ok 低危" } as const;
const CONFIDENCE_CELL = {
  proven: "ok 规则判定",
  heuristic: "warn 需复核",
  uncertain: "no AI 补判",
} as const;

/** Markdown 表格单元格转义：`|` 会截断表格（签名里的 union type 就有），反引号会破坏行内代码。 */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/`/g, "'");
}

/** 影响链路图里的节点名。am 的 flow 语法实测支持斜杠 / 连字符 / 点，无需转义。 */
function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

/**
 * 生成稿件。**纯函数、不碰文件系统、不调子进程** —— 单测直接断言这段文本即可，
 * 不必真的装 CLI（这也是把「生成稿件」和「调 CLI」拆成两个函数的唯一理由）。
 */
export function buildReportDraft(input: ReportInput): string {
  const { repoName, mrId, baseRef, headRef, result: r } = input;
  const s = r.summary ?? {};
  const chain = r.impactChain ?? [];
  const L: string[] = [];

  L.push("---");
  L.push(`title: ${repoName} · MR #${mrId}`);
  L.push(`subtitle: ${baseRef} … ${headRef}`);
  L.push("theme: shadcn");
  L.push(`source: code-guardian · ${new Date().toISOString().slice(0, 10)}`);
  L.push("---");
  L.push(
    `本次改动命中 **${s.changedFileCount ?? 0} 个文件 / ${s.changedSymbolCount ?? 0} 个导出符号**，` +
      `风险定级 高危 ${s.high ?? 0}、中危 ${s.medium ?? 0}、低危 ${s.low ?? 0}。`
  );

  // A 本次规模
  L.push("## A 本次规模 {span=1}");
  L.push("```kv cols=2");
  L.push(`* 全仓文件: ${s.totalFiles ?? 0}`);
  L.push(`导出符号: ${s.totalSymbols ?? 0}`);
  L.push(`变更文件: ${s.changedFileCount ?? 0}`);
  L.push(`变更符号: ${s.changedSymbolCount ?? 0}`);
  L.push(`高危: ${s.high ?? 0}`);
  L.push(`缓存命中: ${s.cacheHits ?? 0}`);
  L.push("```");

  // B 门禁结论
  const high = chain.filter((c) => c.severity === "high");
  L.push("## B 门禁结论 {span=2}");
  if (high.length > 0) {
    L.push("```callout warn 存在破坏性变更");
    for (const c of high) {
      const verb = c.changeType === "removed" ? "被删除" : "发生变更";
      L.push(`${c.symbol} ${verb}，${c.impactedFiles.length} 个引用方会受影响。`);
    }
    L.push("```");
  } else {
    L.push("```callout ok 无高危变更");
    L.push("对外接口层面未发现破坏性改动。");
    L.push("```");
  }
  // 🔴 这条边界必须跟着报告走：不写，读者会把「0 条」当成「无影响」（README「已知边界」）。
  L.push(
    "> 边界：工具只判断对外接口（导出签名）有没有变。函数体内部实现改动不产生条目，" +
      "「影响链路 0 条」不等于「这次改动没有影响」。"
  );

  // C 影响链路
  L.push("## C 影响链路 {span=3}");
  L.push("| 文件 | 符号 | 变更 | 风险 | 置信度 | 引用方 |");
  L.push("|---|---|---|---|---|---|");
  for (const c of chain) {
    const refs =
      c.impactedFiles.length > 0 ? c.impactedFiles.map((f) => cell(f)).join("<br>") : "—";
    L.push(
      `| \`${cell(c.file)}\` | **${cell(c.symbol)}** | ${c.changeType} | ` +
        `${SEVERITY_CELL[c.severity]} | ${CONFIDENCE_CELL[c.confidence]} | ${refs} |`
    );
  }

  // D 高危影响路径（只有高危才画，避免图被几十条低危撑爆）
  if (high.length > 0) {
    L.push("## D 高危影响路径 {span=3}");
    L.push("```flow LR");
    for (const c of high.slice(0, 6)) {
      L.push(`(${c.file}) -> *${c.symbol}: ${c.changeType}`);
      for (const f of c.impactedFiles.slice(0, 4)) L.push(`${c.symbol} -> [${f}]`);
    }
    L.push("```");
  }

  // E 签名变化明细
  const sigs = (r.changedSymbols ?? []).filter((c) => c.oldSignature && c.newSignature);
  if (sigs.length > 0) {
    L.push("## E 签名变化明细 {span=3}");
    L.push("| 文件 | 符号 | 旧签名 | 新签名 |");
    L.push("|---|---|---|---|");
    for (const c of sigs.slice(0, 12)) {
      L.push(
        `| \`${cell(c.file)}\` | ${cell(c.symbol)} | \`${cell(c.oldSignature ?? "")}\` | ` +
          `\`${cell(c.newSignature ?? "")}\` |`
      );
    }
  }

  // F 依赖体积门禁
  const bs = r.bundleSize;
  if (bs) {
    L.push("## F 依赖体积门禁 {span=2}");
    L.push("```limits");
    L.push(
      `顶层依赖 | ${mb(bs.totalBytes)} / ${mb(bs.thresholdBytes)} | ${bs.exceeded ? "超出" : "未超"}`
    );
    if (bs.largest) {
      L.push(`最大单包 ${bs.largest.name} | ${mb(bs.largest.bytes)} / ${mb(bs.thresholdBytes)}`);
    }
    // U8：查询失败时 totalBytes 偏小，必须可见，否则「未超阈值」是假象。
    if (bs.failedCount) {
      L.push(`查询失败 | ${bs.failedCount} / ${bs.queriedCount ?? 0} | 数据不完整`);
    }
    L.push("```");
  }

  // G CVE 漏洞
  const vulns = r.vulnerabilities ?? [];
  if (vulns.length > 0) {
    L.push("## G CVE 漏洞 {span=1}");
    L.push("| 包 | 严重度 | 影响版本 |");
    L.push("|---|---|---|");
    for (const v of vulns.slice(0, 8)) {
      L.push(`| ${cell(v.package)} | ${v.severity} | \`${cell(v.vulnerableVersions)}\` |`);
    }
  }

  return L.join("\n");
}

/**
 * 调 am CLI 把稿件渲染成 HTML。失败一律抛错，由调用方决定 503 还是 500。
 *
 * 用 `execFileSync` 而非 `spawn`：同 `security/index.ts` 里 git show 的既有写法；
 * 参数走数组不经 shell，稿件经 stdin 传入，不落业务目录。
 */
export function renderStaticReport(draft: string): string {
  const { amCliPath } = getConfig();
  if (!amCliPath) {
    throw new ReportUnavailableError("未配置 AM_CLI_PATH，静态报告导出不可用");
  }
  if (!fs.existsSync(amCliPath)) {
    throw new ReportUnavailableError("AM_CLI_PATH 指向的文件不存在");
  }

  const out = path.join(os.tmpdir(), `cg-report-${process.pid}-${Date.now()}.html`);
  try {
    execFileSync("node", [amCliPath, "render", "-", "-o", out, "--no-open"], {
      input: draft,
      encoding: "utf8",
      timeout: RENDER_TIMEOUT_MS,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return fs.readFileSync(out, "utf8");
  } catch (err) {
    // 堆栈不外抛（route 层只回一句人话），但保留原始错误信息在服务端日志里。
    const reason = err instanceof Error ? err.message : String(err);
    console.error("[export-report] 渲染失败:", reason);
    throw new Error("静态报告渲染失败");
  } finally {
    fs.rmSync(out, { force: true });
  }
}
