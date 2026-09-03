// M5 GitLab 状态回写单元测试（node:test + assert），mock fetch 验证 URL/header/状态映射/跳过逻辑。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  setCommitStatus,
  gitlabStatusState,
  reportGitLabStatus,
} from "../src/lib/status/gitlab-status";
import type { AnalysisResult } from "../src/lib/types";
import type { TaskStatus } from "@prisma/client";

/** 构造 reportGitLabStatus 所需的 task 片段（status 显式 TaskStatus 类型） */
function makeTask(source: string, gitlabProjectId: string, status: TaskStatus) {
  return { source, gitlabProjectId, commitSha: "sha1", status };
}

function mockFetch(capture?: { url?: string; headers?: Record<string, string> }) {
  return (async (url: string | URL, init?: RequestInit) => {
    if (capture) {
      capture.url = String(url);
      capture.headers = (init?.headers as Record<string, string>) ?? {};
    }
    return { ok: true, status: 201, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
}

function makeResult(high: number): AnalysisResult {
  return {
    changedFiles: [],
    changedSymbols: [],
    impactChain: [],
    summary: { totalFiles: 0, totalSymbols: 0, changedFileCount: 0, changedSymbolCount: 0, cacheHits: 0, high, medium: 0, low: 0 },
  };
}

const ctx = { host: "https://gitlab.com", projectId: "123", sha: "abc123", token: "tok" };

test("setCommitStatus：URL 与 PRIVATE-TOKEN header 构造正确", async () => {
  const cap: { url?: string; headers?: Record<string, string> } = {};
  await setCommitStatus(ctx, "success", { targetUrl: "https://app/report", description: "审查通过" }, mockFetch(cap));

  assert.equal(cap.url, "https://gitlab.com/api/v4/projects/123/statuses/abc123?state=success&name=code-guardian&target_url=https%3A%2F%2Fapp%2Freport&description=%E5%AE%A1%E6%9F%A5%E9%80%9A%E8%BF%87");
  assert.equal(cap.headers?.["PRIVATE-TOKEN"], "tok");
});

test("setCommitStatus：HTTP 错误抛异常", async () => {
  const f = (async () => ({ ok: false, status: 401, json: async () => ({}) }) as Response) as unknown as typeof fetch;
  await assert.rejects(() => setCommitStatus(ctx, "success", {}, f), /HTTP 401/);
});

test("gitlabStatusState 状态映射", () => {
  assert.equal(gitlabStatusState("done", makeResult(0)), "success");
  assert.equal(gitlabStatusState("done", makeResult(3)), "failed");
  assert.equal(gitlabStatusState("failed", null), "failed");
  assert.equal(gitlabStatusState("analyzing", null), "running");
  assert.equal(gitlabStatusState("pending", null), "running");
});

test("reportGitLabStatus：gitlab-mr + high 风险 → 回写 failed 门禁", async () => {
  process.env.GITLAB_TOKEN = "tok";
  const cap: { url?: string } = {};
  const task = makeTask("gitlab-mr", "42", "done");
  const repo = { gitUrl: "https://gitlab.com/foo/bar.git" };

  const done = await reportGitLabStatus(task, repo, makeResult(5), mockFetch(cap));
  assert.equal(done, true);
  assert.match(cap.url!, /state=failed/);
  assert.match(cap.url!, /projects\/42\/statuses\/sha1/);
  assert.match(cap.url!, /description=/);
  delete process.env.GITLAB_TOKEN;
});

test("reportGitLabStatus：非 gitlab-mr 来源跳过", async () => {
  process.env.GITLAB_TOKEN = "tok";
  const task = makeTask("github-pr", "42", "done");
  const repo = { gitUrl: "https://gitlab.com/foo/bar.git" };
  assert.equal(await reportGitLabStatus(task, repo, makeResult(0)), false);
  delete process.env.GITLAB_TOKEN;
});

test("reportGitLabStatus：无 token 跳过", async () => {
  delete process.env.GITLAB_TOKEN;
  const task = makeTask("gitlab-mr", "42", "done");
  const repo = { gitUrl: "https://gitlab.com/foo/bar.git" };
  assert.equal(await reportGitLabStatus(task, repo, makeResult(0)), false);
});

test("reportGitLabStatus：gitUrl 非法（本地路径）跳过", async () => {
  process.env.GITLAB_TOKEN = "tok";
  const task = makeTask("gitlab-mr", "42", "done");
  const repo = { gitUrl: "/absolute/path/fixtures/sample-repo" };
  assert.equal(await reportGitLabStatus(task, repo, makeResult(0)), false);
  delete process.env.GITLAB_TOKEN;
});
