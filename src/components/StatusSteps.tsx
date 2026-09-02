"use client";

const STAGES: { key: string; label: string }[] = [
  { key: "pending", label: "入队" },
  { key: "parsing", label: "拉取解析" },
  { key: "analyzing", label: "AST 分析" },
  { key: "reporting", label: "生成报告" },
  { key: "done", label: "完成" },
];

export default function StatusSteps({ status }: { status: string }) {
  if (status === "failed") {
    return (
      <div className="stepper">
        <span className="step failed">
          <span className="dot">✕</span>
          <span className="label">失败</span>
        </span>
      </div>
    );
  }

  const currentIndex = STAGES.findIndex((s) => s.key === status);

  return (
    <div className="stepper">
      {STAGES.map((s, i) => {
        const isDone = status === "done" || i < currentIndex;
        const isActive = i === currentIndex && status !== "done";
        return (
          <div key={s.key} className="step">
            {i > 0 && <span className="step-line" />}
            <span className={`step ${isDone ? "done" : isActive ? "active" : ""}`}>
              <span className="dot">{isDone ? "✓" : i + 1}</span>
              <span className="label">{s.label}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
