const { parseFile, diffSymbols } = require("../src/worker/analyze-core.cjs");
const { runRules } = require("../src/worker/rules.cjs");

function demo(name, oldCode, newCode) {
  const oldExports = parseFile(oldCode).exports;
  const newExports = parseFile(newCode).exports;
  const changed = diffSymbols("src/types.ts", oldExports, newExports);
  console.log(`\n【${name}】`);
  for (const cs of changed) {
    const r = runRules(cs, 2);
    const oldSig = cs.oldSignature || "";
    const newSig = cs.newSignature || "";
    console.log(`  ${cs.symbol}: ${cs.changeType} ${oldSig} -> ${newSig} => ${r.severity}/${r.confidence}`);
  }
}

// 1) 删字段 → 应 high/proven
demo("删字段", "export interface User { name: string; age: number }", "export interface User { name: string }");
// 2) 增可选字段 → 应 low/proven
demo("增可选字段", "export interface User { name: string }", "export interface User { name: string; age?: number }");
// 3) 增必填字段 → 应 high/proven
demo("增必填字段", "export interface User { name: string }", "export interface User { name: string; age: number }");
// 4) 字段类型收窄 any->string → 应 high/proven
demo("字段类型收窄", "export type Config = { v: any }", "export type Config = { v: string }");
// 5) 字段重命名 → 应 high/proven
demo("字段重命名", "export interface User { fullName: string }", "export interface User { name: string }");
// 6) 纯 type 别名（无字段）目标类型变化 → 应 medium/heuristic（具体→具体）
demo("type别名引用变化", "export type ID = string", "export type ID = number");
// 7) type 别名 any→具体 收窄 → 应 high/proven
demo("type别名收窄", "export type V = any", "export type V = string");
