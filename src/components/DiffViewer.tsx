"use client";

// M4 Monaco Diff：变更文件的 base/head 两侧对比视图。
// 用 @monaco-editor/react（默认 CDN loader，固定版本），next/dynamic 懒加载避免首屏拖慢。

import { useState } from "react";
import dynamic from "next/dynamic";
import { loader } from "@monaco-editor/react";
import type { FileDiff } from "@/lib/types";

// 固定 CDN 版本，避免默认 loader 版本漂移（生产依赖 jsdelivr CDN，已验证可达）
loader.config({
  paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs" },
});

// Monaco 是重组件，ssr:false + 按需加载，降低首屏成本
const DiffEditor = dynamic(
  () => import("@monaco-editor/react").then((m) => m.DiffEditor),
  {
    ssr: false,
    loading: () => <div className="empty">Diff 视图加载中…</div>,
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
    <div className="diff-viewer">
      <div className="diff-file-list" role="tablist" aria-label="变更文件">
        {diffs.map((d, i) => (
          <button
            key={d.path}
            type="button"
            role="tab"
            aria-selected={i === idx}
            className={`diff-file ${i === idx ? "active" : ""}`}
            onClick={() => setSelected(i)}
            title={d.path}
          >
            <span className={`tag ${d.status}`}>{STATUS_MARK[d.status]}</span>
            <span className="diff-file-name">{d.path}</span>
          </button>
        ))}
      </div>

      <div className="diff-pane">
        <div className="diff-pane-head mono">
          {current.path}{" "}
          <span className="muted">
            （{current.status === "added" ? "新增" : current.status === "deleted" ? "删除" : "修改"}）
          </span>
        </div>
        <DiffEditor
          original={current.oldContent}
          modified={current.newContent}
          language={inferLanguage(current.path)}
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
  );
}
