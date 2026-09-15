"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import StatusSteps from "@/components/StatusSteps";
import RiskSummary from "@/components/RiskSummary";
import ImpactTable from "@/components/ImpactTable";
import DiffViewer from "@/components/DiffViewer";
import type { AnalysisResult } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

type TaskDetail = {
  id: string;
  mrId: string;
  commitSha: string;
  baseRef: string;
  headRef: string;
  status: string;
  result: AnalysisResult | null;
  errorMessage: string | null;
  createdAt: string;
  repo: { name: string; gitUrl: string } | null;
};

const RUNNING = new Set(["pending", "parsing", "analyzing", "reporting"]);

const CHANGE_LABEL: Record<string, string> = { added: "新增", removed: "删除", modified: "修改", renamed: "重命名" };

// M5 安全门禁：CVE severity（npm 四档）→ 前端 badge 类 / 中文标签
const SEV_CLASS: Record<string, string> = { critical: "high", high: "high", moderate: "medium", low: "low" };
const SEV_LABEL: Record<string, string> = { critical: "严重", high: "高危", moderate: "中危", low: "低危" };

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
  if (n >= 1024) return (n / 1024).toFixed(1) + " KB";
  return n + " B";
}

function severityBadgeVariant(sev: string): "destructive" | "secondary" | "outline" {
  if (sev === "high") return "destructive";
  if (sev === "medium") return "secondary";
  return "outline";
}

function confidenceBadgeVariant(conf: string): "outline" | "secondary" {
  if (conf === "proven") return "outline";
  if (conf === "heuristic") return "secondary";
  return "outline";
}

function confidenceLabel(conf: string): string {
  if (conf === "proven") return "确定";
  if (conf === "heuristic") return "经验";
  return "待定";
}

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let es: EventSource | null = null;

    async function load() {
      try {
        const res = await fetch(`/api/tasks/${params.id}`);
        if (!res.ok) throw new Error("任务不存在");
        const data = await res.json();
        if (cancelled) return;
        setTask(data.task);
        if (RUNNING.has(data.task.status)) connectSSE();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }

    function connectSSE() {
      if (es) return;
      es = new EventSource(`/api/tasks/${params.id}/stream`);

      es.onmessage = (event) => {
        let data: { type?: string; status?: string; errorMessage?: string } = {};
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        if (data.type === "status") {
          if (data.status === "done" || data.status === "failed") {
            es?.close();
            es = null;
            void load();
          } else if (data.status) {
            setTask((prev) => (prev ? { ...prev, status: data.status! } : prev));
          }
        } else if (data.type === "connected") {
          void load();
        }
      };

      es.onerror = () => {
        es?.close();
        es = null;
        if (!timer) timer = setInterval(() => void load(), 2000);
      };
    }

    void load();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      if (es) es.close();
    };
  }, [params.id]);

  if (error) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-10">
        <Link href="/" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          ← 返回列表
        </Link>
        <div className="rounded-lg bg-destructive/10 p-4 text-destructive text-sm font-mono">
          {error}
        </div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-10">
        <Link href="/" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          ← 返回列表
        </Link>
        <div className="space-y-4 px-6 py-6" role="status" aria-live="polite">
          <div className="flex items-center gap-3 mb-4 text-sm text-muted-foreground">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted/40 border-t-primary" />
            加载中…
          </div>
          <div className="space-y-2">
            {/* Skeleton rows representing table structure */}
            <div className="flex items-center gap-2">
              <div className="h-3 w-4/5 bg-muted/60 rounded"></div> {/* 仓库 */}
              <div className="h-3 w-1/5 bg-muted/60 rounded"></div> {/* MR */}
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 w-1/3 bg-muted/60 rounded"></div> {/* 状态 */}
              <div className="h-3 w-1/4 bg-muted/60 rounded"></div> {/* 提交 */}
              <div className="h-3 w-1/3 bg-muted/60 rounded"></div> {/* 创建时间 */}
              <div className="h-3 w-1/5 bg-muted/60 rounded"></div> {/* 操作 */}
            </div>
            {/* Additional rows for visual richness */}
            <div className="flex items-center gap-2">
              <div className="h-3 w-2/3 bg-muted/60 rounded"></div>
              <div className="h-3 w-1/3 bg-muted/60 rounded"></div>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 w-3/5 bg-muted/60 rounded"></div>
              <div className="h-3 w-2/5 bg-muted/60 rounded"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const r = task.result;

  return (
    <div className="mx-auto max-w-7xl px-6 pb-16 pt-10">
      <Link href="/" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        ← 返回列表
      </Link>

      {/* 任务头部卡片 */}
      <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">
              {task.repo?.name ?? "—"}
              <span className="ml-2 text-sm text-muted-foreground">MR #{task.mrId}</span>
            </h1>
            <p className="mt-1 text-sm font-mono text-muted-foreground">
              {task.baseRef || "—"} … {task.headRef || "—"}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              创建于 {new Date(task.createdAt).toLocaleString("zh-CN")}
            </p>
          </div>
          <StatusSteps status={task.status} />
        </div>

        {task.status === "failed" && task.errorMessage && (
          <div className="mt-4 rounded-lg bg-destructive/10 p-3 text-destructive text-sm font-mono">
            {task.errorMessage}
          </div>
        )}
      </div>

      {r && (
        <>
          {/* 风险总览 */}
          <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm mb-6">
            <div className="flex items-baseline justify-between gap-4 mb-4">
              <h2 className="text-base font-semibold tracking-tight">风险总览</h2>
            </div>
            <RiskSummary summary={r.summary} />
            <p className="mt-4 text-sm text-muted-foreground">
              全仓 {r.summary.totalFiles} 个文件 · {r.summary.totalSymbols} 个导出符号 · 本次变更{" "}
              {r.summary.changedFileCount} 个文件 · {r.summary.changedSymbolCount} 个符号
            </p>
          </div>

          {/* 影响链路 */}
          <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm mb-6">
            <div className="flex items-baseline justify-between gap-4 mb-4">
              <h2 className="text-base font-semibold tracking-tight">影响链路</h2>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              「改动文件 → 导出符号 → 规则引擎/AI 语义引擎定级 → 引用方文件」的完整链路：
              规则引擎能确定的直接定级，归不了类的 <code className="px-1.5 py-0.5 text-xs font-mono bg-muted rounded">uncertain</code> 变更送 AI 语义引擎二次判定并给出修复建议。
            </p>
            <ImpactTable edges={r.impactChain} />
          </div>

          {/* AI 语义判定明细 */}
          {r.impactChain.some((e) => e.suggestion) && (
            <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm mb-6">
              <div className="flex items-baseline justify-between gap-4 mb-4">
                <h2 className="text-base font-semibold tracking-tight">AI 语义判定明细</h2>
              </div>
              <p className="mb-4 text-sm text-muted-foreground">
                以下为规则引擎判为 <code className="px-1.5 py-0.5 text-xs font-mono bg-muted rounded">uncertain</code>、转交 DeepSeek 语义引擎（LangGraph 四节点：
                问题重述 → 上下文检索 → 影响面预测 → 修复建议）判定的变更。
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/40">
                      <th className="h-10 px-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground w-[220px]">
                        变更符号
                      </th>
                      <th className="h-10 px-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground w-[80px]">
                        风险
                      </th>
                      <th className="h-10 px-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground w-[90px]">
                        置信度
                      </th>
                      <th className="h-10 px-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        AI 修复建议
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {r.impactChain
                      .filter((e) => e.suggestion)
                      .map((e, i) => (
                        <tr key={i} className="hover:bg-muted/30 transition-colors">
                          <td className="h-10 px-4 font-mono text-xs text-muted-foreground truncate max-w-[200px] align-top py-3">
                            {e.file}
                            <span className="ml-1 text-muted-foreground/70">#{e.symbol}</span>
                         </td>
                          <td className="h-10 px-4 align-top py-3">
                            <Badge variant={severityBadgeVariant(e.severity)}>
                              {e.severity === "high" ? "高危" : e.severity === "medium" ? "中危" : "低危"}
                           </Badge>
                         </td>
                          <td className="h-10 px-4 align-top py-3">
                            <Badge variant={confidenceBadgeVariant(e.confidence)}>
                              {confidenceLabel(e.confidence)}
                           </Badge>
                         </td>
                          <td className="px-4 align-top py-3">
                            <div className="flex items-start gap-2.5 p-2.5 bg-muted/50 rounded-md border border-border/40">
                              <span className="flex-shrink-0 inline-flex h-5 px-2 items-center justify-center rounded bg-foreground/90 text-background text-xs font-semibold">
                                AI
                             </span>
                              <span className="text-sm text-foreground leading-relaxed whitespace-normal break-words">
                                {e.suggestion}
                             </span>
                           </div>
</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 安全门禁 */}
          {(r.vulnerabilities || r.bundleSize) && (
            <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm mb-6">
              <div className="flex items-baseline justify-between gap-4 mb-4">
                <h2 className="text-base font-semibold tracking-tight">安全门禁</h2>
              </div>
              <p className="mb-4 text-sm text-muted-foreground">
                M5 依赖安全检测：CVE 漏洞扫描（npm 官方漏洞库）+ 依赖体积门禁。扫描失败时本卡片缺失、不影响主分析。
              </p>

              {r.vulnerabilities && (
                <div className="mb-6">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">依赖漏洞（CVE）</h3>
                  {r.vulnerabilities.length === 0 ? (
                    <p className="text-sm text-muted-foreground">未发现已知漏洞 ✅</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border/40">
                            <th className="h-10 px-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground w-[200px]">依赖</th>
                            <th className="h-10 px-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground w-[90px]">版本</th>
                            <th className="h-10 px-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground w-[70px]">严重度</th>
                            <th className="h-10 px-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">漏洞</th>
                            <th className="h-10 px-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground w-[110px]">影响范围</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                          {r.vulnerabilities.map((v, i) => (
                            <tr key={i} className="hover:bg-muted/50 transition-colors">
                              <td className="h-10 px-4 font-mono text-xs text-muted-foreground truncate max-w-[180px]">
                                {v.package}
                                {!v.isDirect && <span className="ml-1 text-muted-foreground/70">（传递）</span>}
                              </td>
                              <td className="h-10 px-4 font-mono text-xs text-muted-foreground">{v.version}</td>
                              <td className="h-10 px-4">
                                <Badge variant={severityBadgeVariant(SEV_CLASS[v.severity] ?? "low")}>
                                  {SEV_LABEL[v.severity] ?? "低危"}
                                </Badge>
                              </td>
                              <td className="h-10 px-4 text-sm text-foreground truncate max-w-[300px]">
                                <a href={v.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                                  {v.title}
                                </a>
                              </td>
                              <td className="h-10 px-4 font-mono text-xs text-muted-foreground truncate max-w-[100px]">{v.vulnerableVersions}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {r.bundleSize && (
                <div>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">依赖体积</h3>
                  <p className="text-sm text-muted-foreground">
                    顶层依赖 {r.bundleSize.packageCount} 个 · 总体积{" "}
                    <strong className="text-foreground">{formatBytes(r.bundleSize.totalBytes)}</strong>{" "}
                    {r.bundleSize.exceeded ? (
                      <Badge variant="destructive" className="ml-2">
                        超过阈值 {formatBytes(r.bundleSize.thresholdBytes)}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="ml-2">
                        未超阈值 {formatBytes(r.bundleSize.thresholdBytes)}
                      </Badge>
                    )}
                    {r.bundleSize.largest && (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        最大单包 {r.bundleSize.largest.name} {formatBytes(r.bundleSize.largest.bytes)}
                      </span>
                    )}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* 变更符号明细 */}
          {r.changedSymbols.length > 0 && (
            <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm mb-6">
              <div className="flex items-baseline justify-between gap-4 mb-4">
                <h2 className="text-base font-semibold tracking-tight">变更符号明细</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/40">
                      <th className="h-10 px-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">文件</th>
                      <th className="h-10 px-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">符号</th>
                      <th className="h-10 px-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">变更</th>
                      <th className="h-10 px-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground w-[280px]">原签名</th>
                      <th className="h-10 px-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground w-[280px]">新签名</th>
                      <th className="h-10 px-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">行</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {r.changedSymbols.map((s, i) => (
                      <tr key={i} className="hover:bg-muted/50 transition-colors">
                        <td className="h-10 px-4 font-mono text-xs text-muted-foreground truncate max-w-[180px]">{s.file}</td>
                        <td className="h-10 px-4 font-mono text-xs text-muted-foreground truncate max-w-[120px]">{s.symbol}</td>
                        <td className="h-10 px-4">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                            s.changeType === "added"
                              ? "bg-emerald-50 text-emerald-700 dark:text-emerald-400"
                              : s.changeType === "removed"
                                ? "bg-rose-50 text-rose-700 dark:text-rose-400"
                                : s.changeType === "modified"
                                  ? "bg-amber-50 text-amber-700 dark:text-amber-400"
                                  : "bg-blue-50 text-blue-700 dark:text-blue-400"
                          }`}>
                            {CHANGE_LABEL[s.changeType] ?? s.changeType}
                          </span>
                        </td>
                        <td className="h-10 px-4 font-mono text-xs text-muted-foreground whitespace-normal break-all max-w-[280px] leading-relaxed">{s.oldSignature ?? "—"}</td>
                        <td className="h-10 px-4 font-mono text-xs text-foreground whitespace-normal break-all max-w-[280px] leading-relaxed">{s.newSignature ?? "—"}</td>
                        <td className="h-10 px-4 font-mono text-xs text-muted-foreground">{s.line}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 变更文件 */}
          {r.changedFiles.length > 0 && (
            <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm mb-6">
              <div className="flex items-baseline justify-between gap-4 mb-4">
                <h2 className="text-base font-semibold tracking-tight">变更文件</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {r.changedFiles.map((f) => (
                  <span
                    key={f.path}
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-muted/50 text-muted-foreground"
                  >
                    <span className={`inline-flex h-3 w-3 items-center justify-center rounded-full ${
                      f.status === "added"
                        ? "bg-emerald-500 text-emerald-50"
                        : f.status === "deleted"
                          ? "bg-rose-500 text-rose-50"
                          : "bg-muted/50 text-muted-foreground"
                    }`}>
                      {f.status === "added" ? "+" : f.status === "deleted" ? "−" : "~"}
                    </span>
                    <span className="truncate max-w-[200px] font-mono">{f.path}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 代码 Diff */}
          {r.diffs && r.diffs.length > 0 && (
            <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
              <div className="flex items-baseline justify-between gap-4 mb-4">
                <h2 className="text-base font-semibold tracking-tight">代码 Diff</h2>
              </div>
              <p className="mb-4 text-sm text-muted-foreground">变更文件的 base（左）与 head（右）逐行对比。</p>
              <DiffViewer diffs={r.diffs} />
            </div>
          )}
        </>
      )}
    </div>
  );
}