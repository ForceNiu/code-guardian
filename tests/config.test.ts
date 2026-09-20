// 集中配置单测（src/lib/config.ts）
//
// 重点锁的是「**未配置**」的判空口径 —— 本项目两个写端点靠它做 fail-closed：
// 判错方向（把「未配置」读成有值、或读成空串但被当成有效值）会**直接把接口敞开**，
// 而分析链路会真调 DeepSeek（直接产生费用）。所以这几条不是"顺手写的"，是红线相关。

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getConfig, validateConfig } from "../src/lib/config";

const KEYS = [
  "DATABASE_URL",
  "MANUAL_TRIGGER_TOKEN",
  "WEBHOOK_SECRET",
  "DEEPSEEK_API_KEY",
  "GITLAB_TOKEN",
  "HTTP_PROXY",
  "HTTPS_PROXY",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k]; // 不能赋 undefined —— 会被转成字符串 "undefined"
  }
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

test("未配置的变量一律读成 null（不是空串、不是 undefined）", () => {
  const c = getConfig();
  assert.equal(c.databaseUrl, null);
  assert.equal(c.manualTriggerToken, null);
  assert.equal(c.webhookSecret, null);
  assert.equal(c.deepseekApiKey, null);
  assert.equal(c.gitlabToken, null);
  assert.equal(c.proxy, null);
});

test("空串与全空白视同未配置 —— fail-closed 的关键口径", () => {
  process.env.MANUAL_TRIGGER_TOKEN = "";
  process.env.WEBHOOK_SECRET = "   ";
  const c = getConfig();
  assert.equal(c.manualTriggerToken, null, "空串必须判为未配置，否则接口会被放行");
  assert.equal(c.webhookSecret, null, "全空白必须判为未配置，否则接口会被放行");
});

test("正常值原样读出（不做 trim 之外加工）", () => {
  process.env.MANUAL_TRIGGER_TOKEN = "tok-123";
  process.env.DATABASE_URL = "postgresql://u:p@h/d";
  assert.equal(getConfig().manualTriggerToken, "tok-123");
  assert.equal(getConfig().databaseUrl, "postgresql://u:p@h/d");
});

test("代理：HTTPS_PROXY 优先于 HTTP_PROXY", () => {
  process.env.HTTP_PROXY = "http://a:1";
  process.env.HTTPS_PROXY = "http://b:2";
  assert.equal(getConfig().proxy, "b:2");
});

test("代理：去掉 http(s):// 前缀（下游只认 host:port）", () => {
  process.env.HTTP_PROXY = "http://127.0.0.1:7890";
  assert.equal(getConfig().proxy, "127.0.0.1:7890");
});

test("validateConfig：缺 DATABASE_URL 时报缺失，且**只有它**必填", () => {
  const r = validateConfig();
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(r.missing, ["DATABASE_URL"]);
});

test("validateConfig：配了 DATABASE_URL 就通过 —— 其余可选项不影响", () => {
  process.env.DATABASE_URL = "postgresql://u:p@h/d";
  assert.equal(validateConfig().ok, true);
});
