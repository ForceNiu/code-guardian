// 分析引擎的公共类型定义（Worker 与主线程共享契约）

/** 单个函数参数（M3 规则引擎的结构化原料） */
export interface ParamInfo {
  type: string; // 参数类型文本（无注解时为 ""）
  optional: boolean; // 是否可选（id?: string）
  rest?: boolean; // 是否 rest 参数（...args）
}

/** type/interface 的单个字段（M3a-2 字段级规则的结构化原料） */
export interface FieldInfo {
  name: string; // 字段名
  type: string; // 字段类型文本（无注解时为 ""）
  optional: boolean; // 是否可选（age?: number）
}

/** 单个导出符号 */
export interface SymbolInfo {
  name: string;
  type: string; // function / variable / class / type / default
  line: number;
  paramCount?: number; // 函数才有（兼容旧增量缓存）
  params?: ParamInfo[]; // 函数参数细节（M3 规则引擎原料，函数才有）
  returnType?: string; // 函数返回类型文本（函数才有）
  async?: boolean; // 是否 async 函数（函数才有）
  fields?: FieldInfo[]; // type/interface 字段细节（M3a-2 字段级原料，type 才有）
  aliasType?: string; // type 别名目标类型文本（如 "string" / "SomeType"，非对象字面量的 type 别名才有）
}

/** 单个 import 声明 */
export interface ImportInfo {
  name: string; // 导入的符号名（default / * / 具名）
  source: string; // 模块说明符，如 "./utils/format"
  line: number;
}

/** 变更文件的 diff 状态 */
export type ChangeStatus = "added" | "modified" | "deleted";

/** 一条变更符号记录 */
export interface ChangedSymbol {
  file: string;
  symbol: string;
  changeType: "added" | "removed" | "modified";
  oldSignature?: string;
  newSignature?: string;
  /** M3：结构化符号信息，供规则引擎做精细判断（added 只有 newSymbol，removed 只有 oldSymbol） */
  oldSymbol?: SymbolInfo;
  newSymbol?: SymbolInfo;
  line: number;
}

/** 规则引擎置信度：proven=自身即证据可直接门禁 / heuristic=类型变但证明不了需复核 / uncertain=归不了类交 AI */
export type Confidence = "proven" | "heuristic" | "uncertain";

/** 一条影响链路（谁改动了 → 影响了哪些文件） */
export interface ImpactEdge {
  file: string; // 被改动的文件
  symbol: string; // 被改动的导出符号
  changeType: ChangedSymbol["changeType"];
  impactedFiles: string[]; // 引用该符号的文件
  severity: "high" | "medium" | "low";
  confidence: Confidence; // M3 规则引擎输出的置信度（供 AI 分流 + 前端标注）
}

/** Worker 输出的完整分析结果 */
export interface AnalysisResult {
  changedFiles: { path: string; status: ChangeStatus }[];
  changedSymbols: ChangedSymbol[];
  impactChain: ImpactEdge[];
  summary: {
    totalFiles: number;
    totalSymbols: number;
    changedFileCount: number;
    changedSymbolCount: number;
    cacheHits: number; // 本次分析命中增量缓存（跳过 parse）的文件数
    high: number;
    medium: number;
    low: number;
  };
}

/** 反向索引缓存表的一行（供主线程持久化到 export_symbols） */
export interface SymbolTableEntry {
  filePath: string;
  hash: string;
  symbols: {
    name: string;
    type: string;
    line: number;
    importers: string[];
  }[];
  /** 完整导出符号（含 paramCount），写 file_snapshots.symbols 供下次增量复用 */
  exports: SymbolInfo[];
  /** 完整 import 列表，写 file_snapshots.symbols 供下次增量复用 */
  imports: ImportInfo[];
}

/** 增量缓存：主线程从 file_snapshots 读出，随 workerData 传给 worker 复用 */
export interface SymbolCache {
  hashByFile: Record<string, string>;
  exportsByFile: Record<string, SymbolInfo[]>;
  importsByFile: Record<string, ImportInfo[]>;
}

/** Worker 输出：分析报告 + 符号缓存 */
export interface WorkerOutput {
  result: AnalysisResult;
  symbolTable: SymbolTableEntry[];
}

/** Worker 输入（workerData） */
export interface WorkerInput {
  repoId: string;
  gitUrl: string;
  baseRef: string;
  headRef: string;
  workdir: string;
  /** 增量缓存（可选）：首次分析为空，后续分析复用上次解析结果 */
  cache?: SymbolCache;
}

/** 一条待分析任务的执行上下文 */
export interface TaskContext {
  taskId: string;
  repoId: string;
  gitUrl: string;
  baseRef: string;
  headRef: string;
}
