// 多源 Webhook 适配层：把 GitLab MR / GitHub push / GitHub PR 三种异源 payload
// 统一映射成内部入队格式 { gitUrl, mrId, commitSha, baseRef, headRef }。
// 对应需求文档「模块 1 · 多源事件适配」小节。纯函数 + zod 校验，可独立单测。

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { EnqueueInput } from "./enqueue";

/** 支持的三种事件源 */
export type WebhookSource = "gitlab-mr" | "github-push" | "github-pr";

/** 单个源适配的结果 */
export type AdaptResult =
  | { ok: true; input: EnqueueInput }
  | { ok: false; error: string };

/** 分发后带 source 的结果 */
export type DispatchResult =
  | { ok: true; source: WebhookSource; input: EnqueueInput }
  | { ok: false; error: string };

/**
 * 依据请求头识别事件源。
 * - GitLab：`X-Gitlab-Event`（MR 事件值为 "Merge Request Hook"）
 * - GitHub：`X-GitHub-Event`（"push" / "pull_request"）
 * 返回 null 表示无法识别（走统一格式的向后兼容路径）。
 */
export function detectEvent(headers: Headers): WebhookSource | null {
  if (headers.get("x-gitlab-event")) return "gitlab-mr";
  const github = headers.get("x-github-event");
  if (github === "push") return "github-push";
  if (github === "pull_request") return "github-pr";
  return null;
}

/**
 * GitHub 签名校验：比对 `X-Hub-Signature-256`（值为 `sha256=<hex>`）。
 * 用 timingSafeEqual 防时序侧信道；长度不等直接判失败。
 */
export function verifyGitHubSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  if (!signatureHeader) return false;
  const expected =
    "sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signatureHeader, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ---------- GitLab MR ----------

const GitLabMrSchema = z.object({
  object_attributes: z.object({
    iid: z.union([z.number(), z.string()]),
    source_branch: z.string(),
    target_branch: z.string(),
    last_commit: z.object({ id: z.string() }),
  }),
  project: z.object({
    id: z.union([z.number(), z.string()]).optional(),
    git_http_url: z.string().optional(),
    http_url: z.string().optional(),
  }),
});

/**
 * GitLab MR → 统一格式。
 * baseRef = target_branch（合入目标，如 main），headRef = source_branch（来源特性分支）。
 * 这样 worker 的 `git diff base...head` 恰好是「目标分支 … 特性分支」的差异。
 */
export function adaptGitLabMr(payload: unknown): AdaptResult {
  const parsed = GitLabMrSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: `gitlab mr payload invalid: ${parsed.error.issues[0]?.message ?? "unknown"}` };
  }
  const p = parsed.data;
  const gitUrl = p.project.git_http_url ?? p.project.http_url;
  if (!gitUrl) {
    return { ok: false, error: "gitlab mr payload missing project.git_http_url" };
  }
  return {
    ok: true,
    input: {
      gitUrl,
      mrId: String(p.object_attributes.iid),
      commitSha: p.object_attributes.last_commit.id,
      baseRef: p.object_attributes.target_branch,
      headRef: p.object_attributes.source_branch,
      ...(p.project.id !== undefined ? { gitlabProjectId: String(p.project.id) } : {}),
    },
  };
}

// ---------- GitHub push ----------

const GitHubPushSchema = z.object({
  ref: z.string(), // refs/heads/{branch}
  before: z.string(), // push 前的 commit（新分支为全 0）
  after: z.string(), // push 后的 commit
  repository: z.object({ clone_url: z.string() }),
});

/**
 * GitHub push → 统一格式。
 * push 没有 MR 概念，用 `refs/heads/{branch}` 充当幂等键（即 ref 本身）。
 * baseRef = before，headRef = after，`git diff before...after` 即本次 push 的差异。
 */
export function adaptGitHubPush(payload: unknown): AdaptResult {
  const parsed = GitHubPushSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: `github push payload invalid: ${parsed.error.issues[0]?.message ?? "unknown"}` };
  }
  const p = parsed.data;
  return {
    ok: true,
    input: {
      gitUrl: p.repository.clone_url,
      mrId: p.ref,
      commitSha: p.after,
      baseRef: p.before,
      headRef: p.after,
    },
  };
}

// ---------- GitHub PR ----------

const GitHubPrSchema = z.object({
  number: z.union([z.number(), z.string()]),
  pull_request: z.object({
    base: z.object({ sha: z.string(), ref: z.string().optional() }),
    head: z.object({ sha: z.string(), ref: z.string().optional() }),
  }),
  repository: z.object({ clone_url: z.string() }),
});

/**
 * GitHub PR → 统一格式。
 * baseRef = base.sha，headRef/commitSha = head.sha，mrId = PR number。
 * 注意：fork 出的 PR，head.sha 不在目标仓库内，worker 需要额外 fetch 来源 fork，
 * 当前 M2 按同仓 PR 实现（这是已知边界，M5 前补齐 fork 支持）。
 */
export function adaptGitHubPr(payload: unknown): AdaptResult {
  const parsed = GitHubPrSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: `github pr payload invalid: ${parsed.error.issues[0]?.message ?? "unknown"}` };
  }
  const p = parsed.data;
  return {
    ok: true,
    input: {
      gitUrl: p.repository.clone_url,
      mrId: String(p.number),
      commitSha: p.pull_request.head.sha,
      baseRef: p.pull_request.base.sha,
      headRef: p.pull_request.head.sha,
    },
  };
}

/** 依据事件源分发到对应适配器（先 JSON.parse raw body）。 */
export function adaptWebhook(source: WebhookSource, rawBody: string): DispatchResult {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { ok: false, error: "invalid json body" };
  }

  const result: AdaptResult =
    source === "gitlab-mr"
      ? adaptGitLabMr(payload)
      : source === "github-push"
        ? adaptGitHubPush(payload)
        : adaptGitHubPr(payload);

  if (!result.ok) return result;
  return { ok: true, source, input: result.input };
}
