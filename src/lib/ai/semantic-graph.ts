// M3b AI 语义引擎：LangGraph 4 节点管线（问题重述 → 上下文检索 → 影响面预测 → 修复建议）。
// 只处理规则引擎判为 uncertain（置信度 <70%）的变更；规则已定级的（proven / heuristic）不送 AI，控制成本。
// ⚠️ 刻意不写具体比例：全仓无测算出处，且真实仓库实测 0 `uncertain`（见 docs/AUDIT-BACKLOG.md 审计收口批 AUD-1）。
// 架构见 docs/architecture.md §8「双轨审查引擎」。

import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

/** LLM 调用契约（DeepSeekLLM 满足此接口，单测用 mock 实现注入） */
export interface LLMInvoker {
  invoke(input: unknown, options?: { signal?: AbortSignal }): Promise<{ content: string }>;
}

/** 一条 uncertain 变更（供 AI 判定的输入） */
export interface SemanticChange {
  file: string;
  symbol: string;
  changeType: string;
  oldSignature?: string;
  newSignature?: string;
  impactedFiles: string[];
}

/** AI 判定结果（合并回 impactChain） */
export interface AIJudgement {
  file: string;
  symbol: string;
  severity: "high" | "medium" | "low";
  /**
   * 🔴 2026-09-16 收窄：AI **不得**输出 "proven"。
   * `proven` 的语义是「变更自身即证据，可直接作为门禁」，这是**确定性规则引擎专属**的结论
   * （`rules.cjs` 的 RULE_TABLE 产出）。AI 的判断本质是经验性的，让它自称 proven 会让下游
   * 无法区分「规则引擎的确定性证明」与「AI 的自我评估」（R4 实测：7 条 AI 判定里 5 条拿到 proven）。
   * 类型与 zod schema 双层收窄 —— 类型层挡住我们自己的代码，schema 层挡住模型的输出。
   */
  confidence: "heuristic" | "uncertain";
  suggestion: string;
}

// ===== 超时保护：合并「调用超时」与「上层取消」两种信号（复用 interview-forge 方案） =====
async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
  externalSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const combined = externalSignal
    ? AbortSignal.any([controller.signal, externalSignal])
    : controller.signal;
  try {
    return await run(combined);
  } finally {
    clearTimeout(timer);
  }
}

/** LangGraph 节点第二参数：configurable 由路由层透传 */
type NodeConfig = {
  configurable?: {
    signal?: AbortSignal;
    [key: string]: unknown;
  };
};

// ===== 图状态 =====
const SemanticState = Annotation.Root({
  changes: Annotation<SemanticChange[]>,
  problem: Annotation<string>,
  context: Annotation<string>,
  prediction: Annotation<string>,
  results: Annotation<AIJudgement[]>,
});

// ===== AI 输出的 JSON schema（zod 校验 + 失败回灌） =====
// ⚠️ confidence 只有两档：proven 属规则引擎，AI 报 proven 会被 schema 拒绝并触发回灌重试。
const judgmentSchema = z.object({
  index: z.number(),
  severity: z.enum(["high", "medium", "low"]),
  confidence: z.enum(["heuristic", "uncertain"]),
  reason: z.string(),
});
const predictSchema = z.object({ judgments: z.array(judgmentSchema) });

const suggestionSchema = z.object({
  suggestions: z.array(z.object({ index: z.number(), suggestion: z.string() })),
});

// ===== 节点① 问题重述（纯函数，不调 LLM）：把 uncertain 变更清单格式化成自然语言问题 =====
function restate(state: typeof SemanticState.State) {
  const lines = state.changes.map((c, i) => {
    const oldSig = c.oldSignature ? `\n    旧签名: ${c.oldSignature}` : "";
    const newSig = c.newSignature ? `\n    新签名: ${c.newSignature}` : "";
    const impacted = c.impactedFiles.length > 0 ? `\n    受影响文件: ${c.impactedFiles.join(", ")}` : "\n    受影响文件: 无";
    return `[${i}] ${c.file}#${c.symbol}（changeType=${c.changeType}）${oldSig}${newSig}${impacted}`;
  });
  return { problem: lines.join("\n\n") };
}

// ===== 节点② 上下文检索（纯函数，不调 LLM）：附上 semver 判据与符号上下文 =====
function retrieve() {
  const context = [
    "semver 判据（业界口径）：",
    "- 删除导出/成员、收紧类型/可见性、新增必填项 = breaking → high",
    "- 新增导出/成员、放宽类型/可见性、新增可选项 = 兼容 → low",
    "- 类型具体→具体、方向不明、需结合业务 = medium",
    "",
    "confidence 取值（**只有两档，proven 不在其中**）：",
    "- heuristic = 你的经验判断，建议人工复核",
    "- uncertain = 仍无法确定（尽量少用，仅当真无法判断时）",
    "⚠️ proven 是「规则引擎的确定性证明」专属标记，由确定性规则产出，AI 不得使用：",
    "你的判断本质是经验性的，即使很有把握也只能报 heuristic（报 proven 会被判为非法输出）。",
  ].join("\n");
  return { context };
}

// ===== 节点③ 影响面预测（LLM）：输入问题+上下文，输出 severity/confidence/reason =====
function makePredict(llm: LLMInvoker) {
  return async (state: typeof SemanticState.State, config?: NodeConfig) => {
    const signal = config?.configurable?.signal as AbortSignal | undefined;
    const prompt = [
      "你是资深代码审查专家，负责评估代码变更的破坏性（breaking change）风险。",
      "",
      "以下变更规则引擎无法确定，请逐一判定 severity 和 confidence：",
      "",
      state.problem,
      "",
      state.context,
      "",
      '严格输出 JSON（不要任何解释文字、不要 markdown 代码块）：',
      '{"judgments":[{"index":0,"severity":"high","confidence":"heuristic","reason":"..."}]}',
      "index 必须与变更编号 [N] 一致；severity 取值 high/medium/low；confidence 只能取 heuristic 或 uncertain（**不得输出 proven**）。",
    ].join("\n");

    let lastErr = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      const fullPrompt = prompt + (lastErr
        ? `\n\n你上一次的输出未通过校验，请修正后只输出纯 JSON：\n${lastErr}`
        : "");
      const response = await withTimeout(
        (sig) => llm.invoke([new SystemMessage(fullPrompt)], { signal: sig }),
        30000,
        signal,
      );
      const text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        lastErr = "未找到 JSON 结构";
        continue;
      }
      try {
        predictSchema.parse(JSON.parse(jsonMatch[0]));
        return { prediction: jsonMatch[0] };
      } catch (e) {
        lastErr = `JSON 校验失败：${e instanceof Error ? e.message : String(e)}`;
      }
    }
    throw new Error(`影响面预测失败：${lastErr || "未知错误"}`);
  };
}

// ===== 节点④ 修复建议（LLM）：输入判定结果，输出一句话建议 =====
function makeSuggest(llm: LLMInvoker) {
  return async (state: typeof SemanticState.State, config?: NodeConfig) => {
    const signal = config?.configurable?.signal as AbortSignal | undefined;

    let judgments: z.infer<typeof predictSchema>["judgments"] = [];
    try {
      judgments = predictSchema.parse(JSON.parse(state.prediction)).judgments;
    } catch {
      // predict 已保证 prediction 是合法 JSON，此处仅防御
      throw new Error("prediction 状态缺失或非法");
    }

    const changeLines = state.changes.map((c, i) => {
      const j = judgments.find((x) => x.index === i);
      return `[${i}] ${c.file}#${c.symbol}（${c.changeType}）→ severity=${j?.severity ?? "?"}, confidence=${j?.confidence ?? "?"}`;
    });

    const prompt = [
      "针对以下代码变更及其判定结果，为每条给出一句话、可执行的修复建议：",
      "",
      changeLines.join("\n"),
      "",
      '严格输出 JSON（不要任何解释文字）：',
      '{"suggestions":[{"index":0,"suggestion":"..."}]}',
      "index 必须与变更编号 [N] 一致；suggestion 用一句话中文描述。",
    ].join("\n");

    let lastErr = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      const fullPrompt = prompt + (lastErr
        ? `\n\n你上一次的输出未通过校验，请修正后只输出纯 JSON：\n${lastErr}`
        : "");
      const response = await withTimeout(
        (sig) => llm.invoke([new SystemMessage(fullPrompt)], { signal: sig }),
        30000,
        signal,
      );
      const text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        lastErr = "未找到 JSON 结构";
        continue;
      }
      try {
        const parsed = suggestionSchema.parse(JSON.parse(jsonMatch[0]));
        const results: AIJudgement[] = state.changes.map((c, i) => {
          const j = judgments.find((x) => x.index === i);
          const s = parsed.suggestions.find((x) => x.index === i);
          return {
            file: c.file,
            symbol: c.symbol,
            severity: j?.severity ?? "low",
            confidence: j?.confidence ?? "uncertain",
            suggestion: s?.suggestion ?? "（无建议）",
          };
        });
        return { results };
      } catch (e) {
        lastErr = `JSON 校验失败：${e instanceof Error ? e.message : String(e)}`;
      }
    }
    throw new Error(`修复建议生成失败：${lastErr || "未知错误"}`);
  };
}

/** 构建 4 节点管线（llm 经闭包注入，节点零改动调用） */
export function buildSemanticGraph(llm: LLMInvoker) {
  const graph = new StateGraph(SemanticState)
    .addNode("restate", restate)
    .addNode("retrieve", retrieve)
    .addNode("predict", makePredict(llm))
    .addNode("suggest", makeSuggest(llm))
    .addEdge(START, "restate")
    .addEdge("restate", "retrieve")
    .addEdge("retrieve", "predict")
    .addEdge("predict", "suggest")
    .addEdge("suggest", END);
  return graph.compile();
}

/** 入口：对 uncertain 变更跑完整管线，返回 AI 判定结果（与输入顺序一一对应） */
export async function analyzeUncertainChanges(
  changes: SemanticChange[],
  llm: LLMInvoker,
): Promise<AIJudgement[]> {
  if (changes.length === 0) return [];
  const graph = buildSemanticGraph(llm);
  const result = await graph.invoke({ changes });
  return result.results;
}
