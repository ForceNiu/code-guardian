"use client";

import type { ImpactEdge } from "@/lib/types";

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

// 置信度（M3b 双轨）：proven=规则引擎可直接定级 / heuristic=AI 经验判断 / uncertain=仍不确定
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
    return <div className="empty">本次变更没有检测到导出符号变化（或变更仅涉及内部实现）。</div>;
  }

  const aiCount = edges.filter((e) => e.suggestion).length;

  return (
    <div>
      <div className="meta" style={{ marginBottom: 10 }}>
        共 {edges.length} 条影响链路 ·{" "}
        <span className="engine-tag rule">规则引擎</span> {edges.length - aiCount} 条
        {" · "}
        <span className="engine-tag ai">AI 语义引擎</span> {aiCount} 条
      </div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 190 }}>改动文件</th>
              <th style={{ width: 130 }}>导出符号</th>
              <th style={{ width: 80 }}>变更类型</th>
              <th style={{ width: 70 }}>风险</th>
              <th style={{ width: 90 }}>置信度</th>
              <th>影响文件（引用方）</th>
            </tr>
          </thead>
          <tbody>
            {edges.map((e, i) => {
              const eng = engineOf(e);
              return [
                <tr key={`${i}-main`}>
                  <td className="mono">{e.file}</td>
                  <td className="mono">{e.symbol}</td>
                  <td>
                    <span className={`tag ${e.changeType}`}>
                      {CHANGE_LABEL[e.changeType] ?? e.changeType}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${e.severity}`}>{SEVERITY_LABEL[e.severity]}</span>
                  </td>
                  <td>
                    <span
                      className={`badge ${e.confidence}`}
                      title={`判定来源：${eng === "ai" ? "AI 语义引擎" : "规则引擎"}`}
                    >
                      {CONF_LABEL[e.confidence] ?? e.confidence}
                    </span>
                  </td>
                  <td>
                    {e.impactedFiles.length > 0 ? (
                      <div className="chip-list">
                        {e.impactedFiles.map((f) => (
                          <span key={f} className="chip">
                            {f}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="muted">无直接引用方</span>
                    )}
                  </td>
                </tr>,
                e.suggestion ? (
                  <tr key={`${i}-suggest`} className="suggestion-row">
                    <td colSpan={6}>
                      <div className="suggestion-line">
                        <span className="mark">AI</span>
                        <span className="txt">{e.suggestion}</span>
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
