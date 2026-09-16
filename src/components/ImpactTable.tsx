"use client";

import type { ImpactEdge } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

const SEVERITY_LABEL: Record<string, string> = {
  high: "高危",
  medium: "中危",
  low: "低危",
};

const CHANGE_LABEL: Record<string, string> = {
  added: "新增",
  removed: "删除",
  modified: "修改",
  renamed: "重命名",
};

// 置信度（M3b 双轨）：proven=确定性规则引擎直接定级 / heuristic=AI 经验判断 / uncertain=仍不确定
// 🔴 2026-09-16：AI 侧 schema 已收窄，proven **只可能**来自规则引擎 ——
// 所以「确定」这个标签现在是有保证的（此前 AI 也能自称 proven，标签会误导）。
const CONF_LABEL: Record<string, string> = {
  proven: "确定",
  heuristic: "经验",
  uncertain: "待定",
};

/** 判定来源：带 AI 建议（suggestion）说明走了 AI 语义引擎，否则为规则引擎直接判定 */
function engineOf(e: ImpactEdge): "ai" | "rule" {
  return e.suggestion ? "ai" : "rule";
}

export default function ImpactTable({ edges }: { edges: ImpactEdge[] }) {
  if (edges.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        本次变更没有检测到导出符号变化（或变更仅涉及内部实现）。
      </div>
    );
  }

  const aiCount = edges.filter((e) => e.suggestion).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground">
          共 {edges.length} 条影响链路 ·{" "}
          <span className="inline-flex items-center gap-1 rounded-border px-2 py-0.5 text-xs font-medium">
            <span className="engine-tag rule">规则引擎</span> {edges.length - aiCount} 条
          </span>
          {" · "}
          <span className="inline-flex items-center gap-1 rounded-border px-2 py-0.5 text-xs font-medium">
            <span className="engine-tag ai">AI 语义引擎</span> {aiCount} 条
          </span>
        </span>
      </div>
      <div className="border border-border/50">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50">
              <th className="h-10 px-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                改动文件
              </th>
              <th className="h-10 px-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                导出符号
              </th>
              <th className="h-10 px-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                变更类型
              </th>
              <th className="h-10 px-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                风险
              </th>
              <th className="h-10 px-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                置信度
              </th>
              <th className="h-10 px-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                影响文件（引用方）
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {edges.map((e, i) => {
              const eng = engineOf(e);
              return [
                <tr key={`${i}-main`} className="hover:bg-muted/50 transition-colors">
                  <td className="h-10 px-4 font-mono text-xs text-muted-foreground truncate max-w-[180px]">
                    {e.file}
                  </td>
                  <td className="h-10 px-4 font-mono text-xs text-muted-foreground truncate max-w-[120px]">
                    {e.symbol}
                  </td>
                  <td className="h-10 px-4">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                      e.changeType === "added"
                        ? "bg-emerald-50 text-emerald-700 dark:text-emerald-400"
                        : e.changeType === "removed"
                          ? "bg-rose-50 text-rose-700 dark:text-rose-400"
                          : e.changeType === "modified"
                            ? "bg-amber-50 text-amber-700 dark:text-amber-400"
                            : "bg-blue-50 text-blue-700 dark:text-blue-400"
                    }`}>
                      {CHANGE_LABEL[e.changeType] ?? e.changeType}
                    </span>
                  </td>
                  <td className="h-10 px-4">
                    <Badge
                      variant={
                        e.severity === "high"
                          ? "destructive"
                          : e.severity === "medium"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {SEVERITY_LABEL[e.severity]}
                    </Badge>
                  </td>
                  <td className="h-10 px-4">
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant={
                          e.confidence === "proven"
                            ? "outline"
                            : e.confidence === "heuristic"
                              ? "secondary"
                              : "outline"
                        }
                        className="text-xs"
                      >
                        {CONF_LABEL[e.confidence] ?? e.confidence}
                      </Badge>
                      <span
                        className={`text-[11px] font-medium ${
                          eng === "ai" ? "text-primary" : "text-muted-foreground"
                        }`}
                        title={eng === "ai" ? "AI 语义引擎判定" : "规则引擎判定"}
                      >
                        {eng === "ai" ? "AI" : "规则"}
                      </span>
                    </div>
                  </td>
                  <td className="h-10 px-4 text-xs text-muted-foreground">
                    {e.impactedFiles.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {e.impactedFiles.map((f) => (
                          <span
                            key={f}
                            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-muted/50 text-muted-foreground"
                          >
                            {f}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground italic">无直接引用方</span>
                    )}
                  </td>
                </tr>,
                e.suggestion ? (
                  <tr key={`${i}-suggest`} className="bg-primary/[0.06] hover:bg-primary/[0.06]">
                    <td colSpan={6} className="border-l-2 border-l-primary px-4 py-3">
                      <div className="flex items-start gap-2.5">
                        <span className="mt-0.5 inline-flex flex-none items-center rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-bold leading-none text-primary">
                          AI
                        </span>
                        <span className="text-sm leading-relaxed text-foreground">
                          {e.suggestion}
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}