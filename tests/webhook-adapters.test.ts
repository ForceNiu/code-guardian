// 多源 Webhook 适配层单元测试（node:test + assert）
// 覆盖事件源识别 / GitHub 签名校验 / 三源字段映射，固化需求文档的映射表。

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  detectEvent,
  verifyGitHubSignature,
  adaptGitLabMr,
  adaptGitHubPush,
  adaptGitHubPr,
  adaptWebhook,
} from "../src/lib/webhook-adapters";

test("detectEvent 识别三源与未知", () => {
  assert.equal(detectEvent(new Headers({ "x-gitlab-event": "Merge Request Hook" })), "gitlab-mr");
  assert.equal(detectEvent(new Headers({ "x-github-event": "push" })), "github-push");
  assert.equal(detectEvent(new Headers({ "x-github-event": "pull_request" })), "github-pr");
  assert.equal(detectEvent(new Headers({})), null);
  assert.equal(detectEvent(new Headers({ "x-github-event": "issue" })), null);
});

test("verifyGitHubSignature 校验 HMAC-SHA256", () => {
  const secret = "s3cret";
  const body = '{"ref":"refs/heads/main"}';
  const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

  assert.equal(verifyGitHubSignature(secret, body, sig), true);
  assert.equal(verifyGitHubSignature("wrong", body, sig), false);
  assert.equal(verifyGitHubSignature(secret, body, null), false);
  assert.equal(verifyGitHubSignature(secret, body, "not-a-hash"), false);
});

test("adaptGitLabMr 字段映射（base=target，head=source）", () => {
  const payload = {
    object_attributes: {
      iid: 42,
      source_branch: "feature/price",
      target_branch: "main",
      last_commit: { id: "abc123" },
    },
    project: { git_http_url: "https://gitlab.com/group/repo.git" },
  };

  const r = adaptGitLabMr(payload);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.input, {
      gitUrl: "https://gitlab.com/group/repo.git",
      mrId: "42",
      commitSha: "abc123",
      baseRef: "main",
      headRef: "feature/price",
    });
  }
});

test("adaptGitLabMr 缺 git_http_url 时降级 http_url", () => {
  const payload = {
    object_attributes: {
      iid: 1,
      source_branch: "a",
      target_branch: "b",
      last_commit: { id: "x" },
    },
    project: { http_url: "https://gitlab.com/g/r" },
  };
  const r = adaptGitLabMr(payload);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.input.gitUrl, "https://gitlab.com/g/r");
});

test("adaptGitHubPush 字段映射（mrId=ref）", () => {
  const payload = {
    ref: "refs/heads/main",
    before: "1111111111111111111111111111111111111111",
    after: "2222222222222222222222222222222222222222",
    repository: { clone_url: "https://github.com/foo/bar.git" },
  };

  const r = adaptGitHubPush(payload);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.input, {
      gitUrl: "https://github.com/foo/bar.git",
      mrId: "refs/heads/main",
      commitSha: "2222222222222222222222222222222222222222",
      baseRef: "1111111111111111111111111111111111111111",
      headRef: "2222222222222222222222222222222222222222",
    });
  }
});

test("adaptGitHubPr 字段映射（base=base.sha，head=head.sha）", () => {
  const payload = {
    number: 7,
    pull_request: {
      base: { sha: "base-sha", ref: "main" },
      head: { sha: "head-sha", ref: "feature/x" },
    },
    repository: { clone_url: "https://github.com/foo/bar.git" },
  };

  const r = adaptGitHubPr(payload);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.input, {
      gitUrl: "https://github.com/foo/bar.git",
      mrId: "7",
      commitSha: "head-sha",
      baseRef: "base-sha",
      headRef: "head-sha",
    });
  }
});

test("adaptWebhook 按源分发并回带 source", () => {
  const pushRaw = JSON.stringify({
    ref: "refs/heads/dev",
    before: "aaa",
    after: "bbb",
    repository: { clone_url: "https://github.com/foo/bar.git" },
  });
  const r = adaptWebhook("github-push", pushRaw);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.source, "github-push");
    assert.equal(r.input.commitSha, "bbb");
  }
});

test("非法 payload 返回 ok:false", () => {
  assert.equal(adaptGitHubPush({}).ok, false);
  assert.equal(adaptGitHubPr({ number: 1 }).ok, false);
  assert.equal(adaptWebhook("github-pr", "not json").ok, false);
});
