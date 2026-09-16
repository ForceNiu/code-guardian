"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Shield, Plus, ArrowRight } from "@phosphor-icons/react";

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
  // Hero 三个数字用服务端聚合计数，不用 tasks 窗口 filter ——
  // 列表窗口是 size=50，任务超 50 条后窗口内计数会小于真实值。
  const [stats, setStats] = useState({ total: 0, done: 0, failed: 0 });
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    gitUrl: "",
    baseRef: "",
    headRef: "",
    mrId: "",
    token: "", // 访问口令：对应服务端 MANUAL_TRIGGER_TOKEN（写端点鉴权，见 api/tasks/route.ts）
  });
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks?size=50");
      const data = await res.json();
      setTasks(data.tasks ?? []);
      setStats({
        total: data.total ?? 0,
        done: data.done ?? 0,
        failed: data.failed ?? 0,
      });
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
        headers: {
          "Content-Type": "application/json",
          // 写端点鉴权（fail-closed）：服务端未配 MANUAL_TRIGGER_TOKEN 会直接 503
          "x-manual-trigger-token": form.token,
        },
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
        // 口令保留（避免重复输入），只清空业务字段
        setForm({ gitUrl: "", baseRef: "", headRef: "", mrId: "", token: form.token });
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
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-3 no-underline">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-sm">
              <Shield size={18} weight="bold" />
           </div>
            <div className="flex flex-col leading-none">
              <span className="text-sm font-semibold tracking-tight">
                Code Guardian
             </span>
              <span className="mt-0.5 text-xs text-muted-foreground">
                AI 代码副作用检测平台
             </span>
           </div>
         </Link>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/30 px-2.5 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              系统运行中
           </span>
         </div>
       </div>
     </header>

      <main className="mx-auto max-w-7xl px-6 pb-20 pt-10">
        {/* 非对称 Hero 区域 */}
        <section className="grid grid-cols-1 gap-12 lg:grid-cols-[3fr_2fr] lg:items-end">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="mb-3 text-sm font-medium uppercase tracking-widest text-muted-foreground">
              MR 合并前 · 影响链路审计
           </p>
            <h1 className="text-balance text-4xl font-semibold leading-[1.1] tracking-tighter md:text-5xl">
              在合并前看清代码的<br />
              <span className="text-muted-foreground">真实副作用边界</span>
           </h1>
            <p className="mt-5 max-w-[58ch] text-base leading-relaxed text-muted-foreground">
              粘贴仓库与对比分支，自动跑通 diff → AST 分析 → 规则引擎 / AI 语义引擎双轨判定，
              输出「改动文件 → 导出符号 → 引用方」的完整影响链路。
           </p>
         </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.5,
              delay: 0.1,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="grid grid-cols-3 gap-4 text-sm"
          >
            <div className="rounded-lg border border-border/50 p-4">
              <div className="text-2xl font-semibold tabular-nums">
                {stats.total}
             </div>
              <div className="mt-1 text-xs text-muted-foreground">
                任务总数
             </div>
           </div>
            <div className="rounded-lg border border-border/50 p-4">
              <div className="text-2xl font-semibold tabular-nums">
                {stats.done}
             </div>
              <div className="mt-1 text-xs text-muted-foreground">
                已完成
             </div>
           </div>
            <div className="rounded-lg border border-border/50 p-4">
              <div className="text-2xl font-semibold tabular-nums">
                {stats.failed}
             </div>
              <div className="mt-1 text-xs text-muted-foreground">
                失败
             </div>
           </div>
         </motion.div>
       </section>

        {/* 手动触发分析卡片 */}
        <section className="mt-14">
          <Card className="overflow-hidden">
            <div className="border-b border-border/40 px-8 py-5">
              <div className="flex items-center gap-2">
                <Plus size={16} className="text-muted-foreground" />
                <h2 className="text-base font-semibold tracking-tight">
                  触发分析
               </h2>
             </div>
              <p className="mt-1 text-sm text-muted-foreground">
                填入仓库与对比分支，调度器将自动跑通五阶段流水线。
             </p>
           </div>
            <form onSubmit={submit} className="px-8 py-6">
              <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    仓库地址
                 </label>
                  <Input
                    required
                    value={form.gitUrl}
                    onChange={(e) =>
                      setForm({ ...form, gitUrl: e.target.value })
                    }
                    placeholder="/path/to/repo 或 https://gitlab.com/group/repo.git"
                  />
               </div>
                <div>
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    基准 ref（base）
                 </label>
                  <Input
                    value={form.baseRef}
                    onChange={(e) =>
                      setForm({ ...form, baseRef: e.target.value })
                    }
                    placeholder="main / 或 commit sha"
                  />
               </div>
                <div>
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    目标 ref（head）
                 </label>
                  <Input
                    value={form.headRef}
                    onChange={(e) =>
                      setForm({ ...form, headRef: e.target.value })
                    }
                    placeholder="feature-branch / 或 commit sha"
                  />
               </div>
                <div className="md:col-span-2">
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    MR 编号（可选，用于去重）
                 </label>
                  <Input
                    value={form.mrId}
                    onChange={(e) =>
                      setForm({ ...form, mrId: e.target.value })
                    }
                    placeholder="默认 manual"
                  />
               </div>
                {/* 写端点鉴权：服务端比对 MANUAL_TRIGGER_TOKEN（fail-closed，未配置则 503） */}
                <div className="md:col-span-2">
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    访问口令（写入类接口鉴权，必填）
                 </label>
                  <Input
                    required
                    type="password"
                    autoComplete="off"
                    value={form.token}
                    onChange={(e) =>
                      setForm({ ...form, token: e.target.value })
                    }
                    placeholder="与服务端 MANUAL_TRIGGER_TOKEN 一致"
                  />
               </div>
             </div>
              <div className="mt-7 flex items-center justify-between gap-4">
                <p className="text-xs text-muted-foreground">
                  支持本地路径与 Git URL · 提交后将自动去重
               </p>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "提交中…" : "开始分析"}
                  <ArrowRight size={14} />
               </Button>
             </div>
              {msg && (
                <div
                  className={`mt-4 rounded-lg px-4 py-2.5 text-sm ${
                    msg.ok
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "bg-rose-500/10 text-rose-700 dark:text-rose-400"
                  }`}
                >
                  {msg.text}
               </div>
              )}
           </form>
         </Card>
       </section>

        {/* 任务列表区域 */}
        <section className="mt-14">
          <div className="mb-5 flex items-baseline justify-between">
            <h2 className="text-base font-semibold tracking-tight">
              分析任务
           </h2>
            <span className="text-xs text-muted-foreground">
              每 3 秒自动刷新
           </span>
         </div>
          <Card>
            {loading ? (
              <div className="px-6 py-6" role="status" aria-live="polite">
                <div className="flex items-center gap-3 mb-4 text-sm text-muted-foreground">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted/40 border-t-primary" />
                  加载中…
                </div>
                <div className="space-y-2">
                  {/* Skeleton rows representing table structure */}
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-4/5 bg-muted/60 rounded"></div> {/* 仓库 */}
                    <div className="h-3 w-1/5 bg-muted/60 rounded"></div> {/* MR */}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-1/3 bg-muted/60 rounded"></div> {/* 状态 */}
                    <div className="h-3 w-1/4 bg-muted/60 rounded"></div> {/* 提交 */}
                    <div className="h-3 w-1/3 bg-muted/60 rounded"></div> {/* 创建时间 */}
                    <div className="h-3 w-1/5 bg-muted/60 rounded"></div> {/* 操作 */}
                  </div>
                  {/* Additional rows for visual richness */}
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-2/3 bg-muted/60 rounded"></div>
                    <div className="h-3 w-1/3 bg-muted/60 rounded"></div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3/5 bg-muted/60 rounded"></div>
                    <div className="h-3 w-2/5 bg-muted/60 rounded"></div>
                  </div>
                </div>
              </div>
            ) : tasks.length === 0 ? (
              <div className="flex flex-col items-start gap-2 px-6 py-10 text-sm text-muted-foreground">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
                  <Plus size={16} weight="bold" />
               </span>
                <p className="font-medium text-foreground">暂无任务</p>
                <p className="text-xs text-muted-foreground">先在上方手动触发一次分析</p>
             </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border/40">
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        仓库
                     </th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        MR
                     </th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        状态
                     </th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        提交
                     </th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        创建时间
                     </th>
                      <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        操作
                     </th>
                   </tr>
                 </thead>
                  <tbody>
                    {tasks.map((t) => (
                      <tr
                        key={t.id}
                        className="border-b border-border/30 transition-colors hover:bg-muted/30 last:border-0"
                      >
                        <td className="px-6 py-3.5 text-sm font-medium">
                          {t.repo?.name ?? "—"}
                       </td>
                        <td className="px-6 py-3.5 font-mono text-xs text-muted-foreground">
                          #{t.mrId}
                       </td>
                        <td className="px-6 py-3.5">
                          <Badge
                            variant={
                              STATUS_BADGE[t.status] === "low"
                                ? "secondary"
                                : STATUS_BADGE[t.status] === "high"
                                  ? "destructive"
                                  : "outline"
                            }
                          >
                            {STATUS_LABEL[t.status] ?? t.status}
                         </Badge>
                       </td>
                        <td className="px-6 py-3.5 font-mono text-xs text-muted-foreground">
                          {t.commitSha.slice(0, 8)}
                       </td>
                        <td className="px-6 py-3.5 text-xs text-muted-foreground">
                          {new Date(t.createdAt).toLocaleString("zh-CN")}
                       </td>
                        <td className="px-6 py-3.5 text-right">
                          <Link
                            href={`/tasks/${t.id}`}
                            className="inline-flex items-center gap-1 text-sm font-medium text-foreground hover:text-primary"
                          >
                            查看报告
                            <ArrowRight size={14} />
                         </Link>
                       </td>
                     </tr>
                    ))}
                 </tbody>
               </table>
             </div>
            )}
         </Card>
       </section>
     </main>

      <footer className="border-t border-border/40 py-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 text-xs text-muted-foreground">
          <span>Code Guardian · AI 增强的代码审查</span>
          <span className="font-mono">v0.1.0</span>
       </div>
     </footer>
   </div>
  );
}