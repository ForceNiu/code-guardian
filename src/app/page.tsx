"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type TaskRow = {
  id: string;
  mrId: string;
  commitSha: string;
  status: string;
  createdAt: string;
  repo: { name: string; gitUrl: string } | null;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "等待中",
  parsing: "解析中",
  analyzing: "分析中",
  reporting: "生成报告",
  done: "完成",
  failed: "失败",
};

const STATUS_BADGE: Record<string, string> = {
  pending: "neutral",
  parsing: "neutral",
  analyzing: "neutral",
  reporting: "neutral",
  done: "low",
  failed: "high",
};

export default function Home() {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ gitUrl: "", baseRef: "", headRef: "", mrId: "" });
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks?size=50");
      const data = await res.json();
      setTasks(data.tasks ?? []);
    } catch {
      // 后端未就绪时静默
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 首次拉取 + 3s 轮询：setState 均在 await 之后（异步回调），非 effect 内同步 setState
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMsg(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gitUrl: form.gitUrl,
          baseRef: form.baseRef || undefined,
          headRef: form.headRef || undefined,
          mrId: form.mrId || "manual",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg({
          ok: true,
          text:
            data.status === "duplicate"
              ? "已存在相同任务（幂等去重），直接跳转"
              : "任务已入队，调度器将自动开始分析",
        });
        setForm({ gitUrl: "", baseRef: "", headRef: "", mrId: "" });
        void load();
      } else {
        setMsg({ ok: false, text: data.error || "提交失败" });
      }
    } catch {
      setMsg({ ok: false, text: "网络错误" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <span className="logo">G</span>
          <div>
            <h1>Code Guardian</h1>
            <div className="sub">AI 代码副作用检测与审查治理平台</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>手动触发分析</h2>
        <p className="desc">
          粘贴仓库地址与对比分支，拉取 diff 后做 AST 分析，输出「改动影响了哪些函数 / 文件」。
        </p>
        <form onSubmit={submit} className="form-grid">
          <label className="full">
            仓库地址（Git URL 或本地路径）
            <input
              required
              value={form.gitUrl}
              onChange={(e) => setForm({ ...form, gitUrl: e.target.value })}
              placeholder="/path/to/repo 或 https://gitlab.com/group/repo.git"
            />
          </label>
          <label>
            基准 ref（base）
            <input
              value={form.baseRef}
              onChange={(e) => setForm({ ...form, baseRef: e.target.value })}
              placeholder="main / 或 commit sha"
            />
          </label>
          <label>
            目标 ref（head）
            <input
              value={form.headRef}
              onChange={(e) => setForm({ ...form, headRef: e.target.value })}
              placeholder="feature-branch / 或 commit sha"
            />
          </label>
          <label className="full">
            MR 编号（可选，用于去重）
            <input
              value={form.mrId}
              onChange={(e) => setForm({ ...form, mrId: e.target.value })}
              placeholder="默认 manual"
            />
          </label>
          <div className="full">
            <button className="btn" type="submit" disabled={submitting}>
              {submitting ? "提交中…" : "开始分析"}
            </button>
          </div>
        </form>
        {msg && (
          <div className={msg.ok ? "" : "error-box"} style={msg.ok ? { marginTop: 12, color: "var(--low)" } : undefined}>
            {msg.text}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "20px 20px 0" }}>
          <h2>分析任务</h2>
        </div>
        {loading ? (
          <div className="empty">加载中…</div>
        ) : tasks.length === 0 ? (
          <div className="empty">暂无任务，先在上方手动触发一次分析。</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>仓库</th>
                <th>MR</th>
                <th>状态</th>
                <th>提交</th>
                <th>创建时间</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td>{t.repo?.name ?? "—"}</td>
                  <td className="mono">#{t.mrId}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[t.status] ?? "neutral"}`}>
                      {STATUS_LABEL[t.status] ?? t.status}
                    </span>
                  </td>
                  <td className="mono" style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {t.commitSha.slice(0, 8)}
                  </td>
                  <td className="meta">{new Date(t.createdAt).toLocaleString("zh-CN")}</td>
                  <td>
                    <Link href={`/tasks/${t.id}`}>查看报告 →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
