"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import StatusSteps from "@/components/StatusSteps";
import RiskSummary from "@/components/RiskSummary";
import ImpactTable from "@/components/ImpactTable";
import DiffViewer from "@/components/DiffViewer";
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

const CHANGE_LABEL: Record<string, string> = { added: "新增", removed: "删除", modified: "修改", renamed: "重命名" };

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
        // 仍在运行 → 尝试建立 SSE 实时推送；已终止则无需监听
        if (RUNNING.has(data.task.status)) connectSSE();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }

    function connectSSE() {
      if (es) return; // 已建立，避免重复连接
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
            // 终止态：拉完整结果（含报告），关闭 SSE
            es?.close();
            es = null;
            void load();
          } else if (data.status) {
            // 中间态：乐观更新状态徽标，不用等下一轮
            setTask((prev) => (prev ? { ...prev, status: data.status! } : prev));
          }
        } else if (data.type === "connected") {
          // 连接建立：补一次检查，防「连接瞬间任务恰好 done 错过事件」的竞态
          void load();
        }
      };

      es.onerror = () => {
        // SSE 断开/失败（沙箱 dev 环境常见）→ 降级为轮询兜底
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

          {r.diffs && r.diffs.length > 0 && (
            <div className="card">
              <h2>代码 Diff</h2>
              <p className="desc">变更文件的 base（左）与 head（右）逐行对比。</p>
              <DiffViewer diffs={r.diffs} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
