// M3b 集成层 enrichUncertain 单元测试（node:test + assert）
// 覆盖：无 uncertain 变更直接返回 / 无 LLM 降级 / AI 判定后合并 severity+confidence+suggestion+summary 重算 / AI 抛错降级。

import { test } from "node:test";
import assert from "node:assert/strict";
import type { AnalysisResult } from "../src/lib/types";
import { enrichUncertain } from "../src/lib/ai/enrich";
import type { LLMInvoker } from "../src/lib/ai/semantic-graph";

/** 按 prompt 关键词区分 predict/suggest 的 mock LLM */
class MockLLM implements LLMInvoker {
  constructor(
    private predictContent: string,
    private suggestContent: string,
  ) {}
  async invoke(input: unknown): Promise<{ content: string }> {
    const text = Array.isArray(input)
      ? input
          .map((m) => (typeof m === "string" ? m : String((m as { content?: unknown }).content ?? "")))
          .join("\n")
      : String(input);
    if (text.includes("逐一判定 severity 和 confidence")) return { content: this.predictContent };
    return { content: this.suggestContent };
  }
}

/** 永远抛错的 mock LLM（模拟 AI 不可用） */
class FailingLLM implements LLMInvoker {
  async invoke(): Promise<{ content: string }> {
    throw new Error("AI 服务不可用");
  }
}

function makeResult(): AnalysisResult {
  return {
    changedFiles: [{ path: "src/api.ts", status: "modified" }],
    changedSymbols: [
      {
        file: "src/api.ts",
        symbol: "removeMe",
        changeType: "removed",
        oldSignature: "removeMe(): void",
        line: 1,
      },
      {
        file: "src/api.ts",
        symbol: "addOpt",
        changeType: "modified",
        oldSignature: "addOpt(a: number)",
        newSignature: "addOpt(a: number, b?: string)",
        line: 10,
      },
    ],
    impactChain: [
      { file: "src/api.ts", symbol: "removeMe", changeType: "removed", impactedFiles: ["src/app.ts"], severity: "low", confidence: "uncertain" },
      { file: "src/api.ts", symbol: "addOpt", changeType: "modified", impactedFiles: [], severity: "low", confidence: "uncertain" },
    ],
    summary: { totalFiles: 1, totalSymbols: 2, changedFileCount: 1, changedSymbolCount: 2, cacheHits: 0, high: 0, medium: 0, low: 2 },
  };
}

test("无 uncertain 变更时直接返回，不调 LLM", async () => {
  const result = makeResult();
  result.impactChain.forEach((e) => (e.confidence = "proven"));
  const mock = new MockLLM("{}", "{}");

  const out = await enrichUncertain(result, mock);
  assert.equal(out, result); // 原引用直接返回
  assert.equal(result.impactChain[0].confidence, "proven"); // 未被改写
});

test("注入 null LLM 时降级，保留原 uncertain 结果", async () => {
  const result = makeResult();
  const before = JSON.stringify(result.impactChain);

  const out = await enrichUncertain(result, null);
  assert.equal(out, result);
  assert.equal(JSON.stringify(result.impactChain), before); // 完全未变
  assert.equal(result.impactChain[0].confidence, "uncertain");
});

test("AI 判定后合并 severity/confidence/suggestion 并重算 summary", async () => {
  const predict = JSON.stringify({
    judgments: [
      { index: 0, severity: "high", confidence: "proven", reason: "删除导出" },
      { index: 1, severity: "low", confidence: "heuristic", reason: "新增可选参数" },
    ],
  });
  const suggest = JSON.stringify({
    suggestions: [
      { index: 0, suggestion: "改为废弃标记" },
      { index: 1, suggestion: "无需处理" },
    ],
  });
  const mock = new MockLLM(predict, suggest);
  const result = makeResult();

  const out = await enrichUncertain(result, mock);

  // severity/confidence/suggestion 已合并
  assert.equal(result.impactChain[0].severity, "high");
  assert.equal(result.impactChain[0].confidence, "proven");
  assert.equal(result.impactChain[0].suggestion, "改为废弃标记");
  assert.equal(result.impactChain[1].severity, "low");
  assert.equal(result.impactChain[1].confidence, "heuristic");
  assert.equal(result.impactChain[1].suggestion, "无需处理");

  // summary 计数已按新 severity 重算
  assert.equal(result.summary.high, 1);
  assert.equal(result.summary.medium, 0);
  assert.equal(result.summary.low, 1);

  assert.equal(out, result);
});

test("AI 抛错时降级，保留原 uncertain 结果与 summary", async () => {
  const result = makeResult();
  const before = JSON.stringify({ chain: result.impactChain, summary: result.summary });

  const out = await enrichUncertain(result, new FailingLLM());
  assert.equal(out, result);
  assert.equal(JSON.stringify({ chain: result.impactChain, summary: result.summary }), before);
  assert.equal(result.impactChain[0].confidence, "uncertain");
});
