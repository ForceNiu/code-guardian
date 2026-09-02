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
};

export default function ImpactTable({ edges }: { edges: ImpactEdge[] }) {
  if (edges.length === 0) {
    return <div className="empty">本次变更没有检测到导出符号变化（或变更仅涉及内部实现）。</div>;
  }

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 200 }}>改动文件</th>
            <th style={{ width: 140 }}>导出符号</th>
            <th style={{ width: 90 }}>变更类型</th>
            <th style={{ width: 90 }}>风险</th>
            <th>影响文件（引用方）</th>
          </tr>
        </thead>
        <tbody>
          {edges.map((e, i) => (
            <tr key={i}>
              <td className="mono">{e.file}</td>
              <td className="mono">{e.symbol}</td>
              <td>
                <span className={`tag ${e.changeType}`}>{CHANGE_LABEL[e.changeType] ?? e.changeType}</span>
              </td>
              <td>
                <span className={`badge ${e.severity}`}>{SEVERITY_LABEL[e.severity]}</span>
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
