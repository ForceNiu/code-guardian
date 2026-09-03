// M3b 集成层：把规则引擎判为 uncertain 的变更送 AI 语义引擎，结果合并回 impactChain。
// 健壮性：AI 不可用（无 key / 调用失败）时静默降级，保留原 uncertain 结果，不影响任务成功。

import type { AnalysisResult } from "@/lib/types";
import { createLLM } from "./deepseek";
import { analyzeUncertainChanges, type SemanticChange, type LLMInvoker } from "./semantic-graph";

/**
 * 把规则引擎判为 uncertain 的变更送 AI 语义引擎，结果合并回 impactChain。
 * @param result 规则引擎输出（会被就地修改 severity/confidence/suggestion）
 * @param llm 可选注入（单测传 mock；生产不传，内部走 createLLM()）
 */
export async function enrichUncertain(
  result: AnalysisResult,
  llm?: LLMInvoker | null,
): Promise<AnalysisResult> {
  const uncertainEdges = result.impactChain.filter((e) => e.confidence === "uncertain");
  if (uncertainEdges.length === 0) return result;

  const effectiveLlm: LLMInvoker | null = llm === undefined ? createLLM() : llm;
  if (!effectiveLlm) {
    console.warn("[AI] 未配置 DEEPSEEK_API_KEY，跳过 uncertain 变更的 AI 判定");
    return result;
  }

  // 从 changedSymbols 补全签名上下文（impactChain 只有 file/symbol/changeType）
  const symbolMap = new Map(result.changedSymbols.map((cs) => [`${cs.file}#${cs.symbol}`, cs]));

  const changes: SemanticChange[] = uncertainEdges.map((e) => {
    const cs = symbolMap.get(`${e.file}#${e.symbol}`);
    return {
      file: e.file,
      symbol: e.symbol,
      changeType: e.changeType,
      oldSignature: cs?.oldSignature,
      newSignature: cs?.newSignature,
      impactedFiles: e.impactedFiles,
    };
  });

  try {
    const judgements = await analyzeUncertainChanges(changes, effectiveLlm);
    const judgeMap = new Map(judgements.map((j) => [`${j.file}#${j.symbol}`, j]));

    for (const edge of result.impactChain) {
      const j = judgeMap.get(`${edge.file}#${edge.symbol}`);
      if (!j) continue;
      edge.severity = j.severity;
      edge.confidence = j.confidence;
      if (j.suggestion) edge.suggestion = j.suggestion;
    }

    // AI 可能改变 severity，重算汇总计数
    result.summary.high = result.impactChain.filter((i) => i.severity === "high").length;
    result.summary.medium = result.impactChain.filter((i) => i.severity === "medium").length;
    result.summary.low = result.impactChain.filter((i) => i.severity === "low").length;

    console.log(`[AI] uncertain 变更 ${changes.length} 条已由 AI 语义引擎判定完成`);
  } catch (err) {
    console.error("[AI] uncertain 变更 AI 判定失败，降级保留原规则引擎结果:", err);
  }

  return result;
}
