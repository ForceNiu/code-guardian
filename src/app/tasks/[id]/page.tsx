"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import StatusSteps from "@/components/StatusSteps";
import RiskSummary from "@/components/RiskSummary";
import ImpactTable from "@/components/ImpactTable";
import type { AnalysisResult } from "@/lib/types";

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

const CHANGE_LABEL: Record<string, string> = { added: "新增", removed: "删除", modified: "修改" };

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function load() {
      try {
        const res = await fetch(`/api/tasks/${params.id}`);
        if (!res.ok) throw new Error("任务不存在");
        const data = await res.json();
        if (cancelled) return;
        setTask(data.task);
        if (RUNNING.has(data.task.status)) {
          timer = setTimeout(load, 2000);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [params.id]);

  if (error) {
    return (
      <div className="container">
        <Link href="/" className="back">← 返回列表</Link>
        <div className="error-box">{error}</div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="container">
        <Link href="/" className="back">← 返回列表</Link>
        <div className="empty">加载中…</div>
      </div>
    );
  }

  const r = task.result;

  return (
    <div className="container">
      <Link href="/" className="back">← 返回列表</Link>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div>
            <h2 style={{ marginBottom: 6 }}>
              {task.repo?.name ?? "—"}{" "}
              <span className="meta">MR #{task.mrId}</span>
            </h2>
            <div className="meta mono">
              {task.baseRef || "—"} … {task.headRef || "—"}
            </div>
            <div className="meta">创建于 {new Date(task.createdAt).toLocaleString("zh-CN")}</div>
          </div>
          <StatusSteps status={task.status} />
        </div>

        {task.status === "failed" && task.errorMessage && (
          <div className="error-box">{task.errorMessage}</div>
        )}
      </div>

      {r && (
        <>
          <div className="card">
            <h2>风险总览</h2>
            <RiskSummary summary={r.summary} />
            <div className="meta" style={{ marginTop: 12 }}>
              全仓 {r.summary.totalFiles} 个文件 · {r.summary.totalSymbols} 个导出符号 · 本次变更{" "}
              {r.summary.changedFileCount} 个文件 · {r.summary.changedSymbolCount} 个符号
            </div>
          </div>

          <div className="card">
            <h2>影响链路</h2>
            <p className="desc">「第 X 行 → 影响函数 Y → 影响文件 Z」的跨文件引用追踪结果。</p>
            <ImpactTable edges={r.impactChain} />
          </div>

          {r.changedSymbols.length > 0 && (
            <div className="card">
              <h2>变更符号明细</h2>
              <table className="table">
                <thead>
                  <tr>
                    <th>文件</th>
                    <th>符号</th>
                    <th>变更</th>
                    <th>原签名</th>
                    <th>新签名</th>
                    <th>行</th>
                  </tr>
                </thead>
                <tbody>
                  {r.changedSymbols.map((s, i) => (
                    <tr key={i}>
                      <td className="mono">{s.file}</td>
                      <td className="mono">{s.symbol}</td>
                      <td>
                        <span className={`tag ${s.changeType}`}>{CHANGE_LABEL[s.changeType]}</span>
                      </td>
                      <td className="mono muted">{s.oldSignature ?? "—"}</td>
                      <td className="mono">{s.newSignature ?? "—"}</td>
                      <td className="mono">{s.line}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {r.changedFiles.length > 0 && (
            <div className="card">
              <h2>变更文件</h2>
              <div className="chip-list">
                {r.changedFiles.map((f) => (
                  <span key={f.path} className="chip">
                    <span className={`tag ${f.status}`} style={{ marginRight: 6 }}>
                      {f.status === "added" ? "+" : f.status === "deleted" ? "−" : "~"}
                    </span>
                    {f.path}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
