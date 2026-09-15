"use client";

import React from "react";

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
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-destructive text-destructive">
          ✕
        </span>
        <span>失败</span>
      </div>
    );
  }

  const currentIndex = STAGES.findIndex((s) => s.key === status);

  return (
    <div className="flex items-center gap-3">
      {STAGES.map((s, i) => (
        <React.Fragment key={s.key}>
          {i > 0 && (
            <span className="h-px w-1.5 bg-muted/50 flex-shrink-0" />
          )}
          <div className="flex items-center gap-1.5">
            <div className="relative h-6 w-6 flex-shrink-0">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className={`
                  flex h-4 w-4 items-center justify-center rounded-full
                  ${status === "done" || i < currentIndex
                    ? "bg-emerald-500 text-white"
                    : i === currentIndex
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50 text-muted-foreground"}
                  transition-all duration-200
                  ${i === currentIndex && status !== "done"
                    ? "animate-pulse"
                    : ""}
                `}>
                  {status === "done" || i < currentIndex ? "✓" : i + 1}
                </div>
              </div>
            </div>
            <span className={`
              text-xs font-medium
              ${status === "done" || i < currentIndex
                ? "text-foreground"
                : i === currentIndex
                  ? "text-primary"
                  : "text-muted-foreground"}
              transition-colors duration-200
            `}>
              {s.label}
            </span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}