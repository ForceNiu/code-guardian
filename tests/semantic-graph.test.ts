// M3b AI 语义引擎单元测试（node:test + assert）
// 用 mock LLM 注入，验证 LangGraph 4 节点管线：
//   restate（问题重述）→ retrieve（上下文检索）→ predict（影响面预测）→ suggest（修复建议）
// 覆盖：正常判定、空输入、非法 JSON 回灌重试、全部失败抛错。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeUncertainChanges,
  type LLMInvoker,
  type SemanticChange,
} from "../src/lib/ai/semantic-graph";

/** 根据 prompt 关键词区分 predict/suggest 调用的 mock LLM */
class MockLLM implements LLMInvoker {
  calls: string[] = [];
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
    this.calls.push(text);
    if (text.includes("逐一判定 severity 和 confidence")) return { content: this.predictContent };
    return { content: this.suggestContent };
  }
}

/** 按队列顺序依次返回内容的 mock LLM（用于回灌重试测试） */
class QueueMockLLM implements LLMInvoker {
  private queue: string[];
  constructor(...responses: string[]) {
    this.queue = responses;
  }
  async invoke(): Promise<{ content: string }> {
    return { content: this.queue.shift() ?? "{}" };
  }
}

const changes: SemanticChange[] = [
  {
    file: "src/api.ts",
    symbol: "removeMe",
    changeType: "removed",
    oldSignature: "removeMe(): void",
    impactedFiles: ["src/app.ts"],
  },
  {
    file: "src/api.ts",
    symbol: "addOpt",
    changeType: "modified",
    oldSignature: "addOpt(a: number)",
    newSignature: "addOpt(a: number, b?: string)",
    impactedFiles: [],
  },
];

test("空 changes 直接返回空数组，不调 LLM", async () => {
  const mock = new MockLLM("{}", "{}");
  const result = await analyzeUncertainChanges([], mock);
  assert.deepEqual(result, []);
  assert.equal(mock.calls.length, 0);
});

test("正常判定：输出与输入顺序一一对应，字段正确合并", async () => {
  const predict = JSON.stringify({
    judgments: [
      { index: 0, severity: "high", confidence: "proven", reason: "删除导出" },
      { index: 1, severity: "low", confidence: "heuristic", reason: "新增可选参数" },
    ],
  });
  const suggest = JSON.stringify({
    suggestions: [
      { index: 0, suggestion: "改为废弃标记而非直接删除" },
      { index: 1, suggestion: "无需处理" },
    ],
  });
  const mock = new MockLLM(predict, suggest);

  const result = await analyzeUncertainChanges(changes, mock);

  assert.deepEqual(result, [
    { file: "src/api.ts", symbol: "removeMe", severity: "high", confidence: "proven", suggestion: "改为废弃标记而非直接删除" },
    { file: "src/api.ts", symbol: "addOpt", severity: "low", confidence: "heuristic", suggestion: "无需处理" },
  ]);
  // 管线应恰好调两次 LLM：一次 predict + 一次 suggest
  assert.equal(mock.calls.length, 2);
});

test("predict 输出非法 JSON 时回灌重试，成功后继续 suggest", async () => {
  const predict = JSON.stringify({
    judgments: [{ index: 0, severity: "medium", confidence: "uncertain", reason: "方向不明" }],
  });
  const suggest = JSON.stringify({ suggestions: [{ index: 0, suggestion: "人工复核" }] });
  // 第一次 predict 返回无 JSON 结构的文本 → 回灌重试 → 第二次返回合法 predict → 最后 suggest
  const mock = new QueueMockLLM("这不是 JSON", predict, suggest);

  const result = await analyzeUncertainChanges([changes[0]], mock);
  assert.equal(result.length, 1);
  assert.equal(result[0].severity, "medium");
  assert.equal(result[0].suggestion, "人工复核");
});

test("predict 三次都失败时抛错（由上层 enrich 降级兜底）", async () => {
  const mock = new QueueMockLLM("坏1", "坏2", "坏3");
  await assert.rejects(
    () => analyzeUncertainChanges([changes[0]], mock),
    /影响面预测失败/,
  );
});
