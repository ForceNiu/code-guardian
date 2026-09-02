// 分析引擎的公共类型定义（Worker 与主线程共享契约）

/** 单个导出符号 */
export interface SymbolInfo {
  name: string;
  type: string; // function / variable / class / type / default
  line: number;
  paramCount?: number; // 函数才有
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
  line: number;
}

/** 一条影响链路（谁改动了 → 影响了哪些文件） */
export interface ImpactEdge {
  file: string; // 被改动的文件
  symbol: string; // 被改动的导出符号
  changeType: ChangedSymbol["changeType"];
  impactedFiles: string[]; // 引用该符号的文件
  severity: "high" | "medium" | "low";
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
