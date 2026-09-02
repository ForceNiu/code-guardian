"use client";

export default function RiskSummary({
  summary,
}: {
  summary: { high: number; medium: number; low: number };
}) {
  return (
    <div className="risk-row">
      <div className="risk-card high">
        <div className="num">{summary.high}</div>
        <div className="cap">🔴 高危</div>
      </div>
      <div className="risk-card medium">
        <div className="num">{summary.medium}</div>
        <div className="cap">🟡 中危</div>
      </div>
      <div className="risk-card low">
        <div className="num">{summary.low}</div>
        <div className="cap">🟢 低危 / 通过</div>
      </div>
    </div>
  );
}
