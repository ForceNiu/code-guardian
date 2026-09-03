// M5 GitLab 状态互操作：任务完成后，把审查结果回写成 GitLab MR 的 commit status（红绿灯），
// 作为合并门禁。仅 gitlab-mr 来源、且配置了 GITLAB_TOKEN 时才回写，失败静默降级。

import type { Task, Repository } from "@prisma/client";
import type { AnalysisResult } from "@/lib/types";

export type CommitStatusState = "pending" | "running" | "success" | "failed" | "canceled";

/** 一次 commit status 回写所需的上下文 */
export interface GitLabStatusContext {
  host: string; // 如 https://gitlab.com（从仓库 gitUrl 的 origin 推断）
  projectId: string; // GitLab project id（数字或 URL-encoded path）
  sha: string; // commit sha
  token: string; // GITLAB_TOKEN（PRIVATE-TOKEN header）
}

export interface CommitStatusOptions {
  name?: string; // status 名称，默认 "code-guardian"
  targetUrl?: string; // 报告页链接
  description?: string; // 状态描述
}

/**
 * 调用 GitLab Commit Status API 回写一次状态。
 * 端点：POST {host}/api/v4/projects/{projectId}/statuses/{sha}?state=...&name=...&target_url=...&description=...
 */
export async function setCommitStatus(
  ctx: GitLabStatusContext,
  state: CommitStatusState,
  opts: CommitStatusOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const params = new URLSearchParams({ state, name: opts.name ?? "code-guardian" });
  if (opts.targetUrl) params.set("target_url", opts.targetUrl);
  if (opts.description) params.set("description", opts.description);

  const url = `${ctx.host}/api/v4/projects/${encodeURIComponent(ctx.projectId)}/statuses/${ctx.sha}?${params.toString()}`;
  const resp = await fetchImpl(url, {
    method: "POST",
    headers: { "PRIVATE-TOKEN": ctx.token },
  });
  if (!resp.ok) {
    throw new Error(`GitLab commit status 请求失败: HTTP ${resp.status}`);
  }
}

/** 任务状态 + 审查结果 → GitLab commit status 状态 */
export function gitlabStatusState(status: string, result: AnalysisResult | null): CommitStatusState {
  if (status === "done") {
    return (result?.summary.high ?? 0) > 0 ? "failed" : "success";
  }
  if (status === "failed") return "failed";
  return "running"; // pending / parsing / analyzing / reporting
}

/**
 * 高层封装：据任务/仓库/结果回写 GitLab commit status。
 * 非 gitlab-mr 来源、无 projectId、无 token、gitUrl 非法时静默跳过（返回 false）。
 * 调用失败抛异常，由调用方（scheduler）catch 降级。
 */
export async function reportGitLabStatus(
  task: Pick<Task, "source" | "gitlabProjectId" | "commitSha" | "status">,
  repo: Pick<Repository, "gitUrl">,
  result: AnalysisResult | null,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (task.source !== "gitlab-mr" || !task.gitlabProjectId) return false;
  const token = process.env.GITLAB_TOKEN;
  if (!token) return false;

  let host: string;
  try {
    host = new URL(repo.gitUrl).origin;
  } catch {
    return false; // gitUrl 非法（本地路径等），跳过
  }

  const state = gitlabStatusState(task.status, result);
  const high = result?.summary.high ?? 0;
  const description =
    state === "failed"
      ? high > 0
        ? `发现 ${high} 个高危变更，建议修复后合并`
        : "分析失败"
      : "审查通过";

  await setCommitStatus(
    { host, projectId: task.gitlabProjectId, sha: task.commitSha, token },
    state,
    { description },
    fetchImpl,
  );
  return true;
}
