"use client";

// M4 Monaco Diff：变更文件的 base/head 两侧对比视图。
// ⚠️ 2026-09-20 实测更正：**并非「零 CDN 依赖」**。Turbopack 下 next.config.ts 的 webpack 插件不生效，
//    编辑器与 worker 实际从 `cdn.jsdelivr.net/npm/monaco-editor@0.55.1` 加载
//    （理由与影响见 next.config.ts 顶部注释、决定见 docs/AUDIT-BACKLOG.md §三「明确不做」②）。
//    后果：离线 / 内网部署时本组件会一直停在 loading；有网时首屏约 20s 才渲染。

import { useState } from "react";
import dynamic from "next/dynamic";
import type { FileDiff } from "@/lib/types";

// Monaco 是重组件，ssr:false + 按需加载，降低首屏成本
const DiffEditor = dynamic(
  () => import("@monaco-editor/react").then((m) => m.DiffEditor),
  {
    ssr: false,
    loading: () => (
      <div className="p-6 text-center text-sm text-muted-foreground">
        Diff 视图加载中…
      </div>
    ),
  },
);

const EXT_LANG: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".json": "json",
  ".css": "css",
  ".scss": "scss",
  ".less": "less",
  ".html": "html",
  ".htm": "html",
  ".md": "markdown",
  ".py": "python",
  ".yml": "yaml",
  ".yaml": "yaml",
};

function inferLanguage(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return "plaintext";
  return EXT_LANG[path.slice(dot)] ?? "plaintext";
}

const STATUS_MARK: Record<string, string> = { added: "+", deleted: "−", modified: "~" };

export default function DiffViewer({ diffs }: { diffs: FileDiff[] }) {
  const [selected, setSelected] = useState(0);

  if (diffs.length === 0) return null;

  const idx = Math.min(selected, diffs.length - 1);
  const current = diffs[idx];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h2 className="text-base font-semibold tracking-tight">
          代码 Diff
        </h2>
        <p className="text-sm text-muted-foreground">
          变更文件的 base（左）与 head（右）逐行对比。
        </p>
      </div>
      
      <div className="border border-border/50 rounded-lg overflow-hidden">
        <div className="flex border-b border-border/30 bg-muted/50">
          {diffs.map((d, i) => (
            <button
              key={d.path}
              type="button"
              role="tab"
              aria-selected={i === idx}
              className={`
                flex-1 px-4 py-3 text-xs font-medium text-muted-foreground
                transition-all duration-200
                ${i === idx
                  ? "text-primary border-b-2 border-primary"
                  : "hover:text-muted-foreground/80 hover:bg-muted/30"}
              `}
              onClick={() => setSelected(i)}
              title={d.path}
            >
              <span className={`mr-2 inline-flex h-3 w-3 items-center justify-center rounded-full ${
                d.status === "added"
                  ? "bg-emerald-500 text-emerald-50"
                  : d.status === "deleted"
                    ? "bg-rose-500 text-rose-50"
                    : "bg-muted/50 text-muted-foreground"
              }`}>
                {STATUS_MARK[d.status]}
              </span>
              <span className="truncate max-w-[120px]">{d.path}</span>
            </button>
          ))}
        </div>
        
        <div className="flex h-[520px]">
          <DiffEditor
            original={current.oldContent}
            modified={current.newContent}
            language={inferLanguage(current.path)}
            theme="vs-dark"
            height="520px"
            options={{
              readOnly: true,
              renderSideBySide: true,
              minimap: { enabled: false },
              fontSize: 13,
              scrollBeyondLastLine: false,
              folding: true,
              lineNumbersMinChars: 3,
            }}
          />
        </div>
      </div>
    </div>
  );
}