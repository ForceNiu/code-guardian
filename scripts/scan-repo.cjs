#!/usr/bin/env node
/**
 * 用真实仓库驱动分析 worker，绕过 DB / HTTP 直接检验引擎。
 *
 * 存在的理由：单测拦不住「静默失效」类缺陷——输出看起来完全正常，但引擎其实没在工作。
 * 历史上一句话 bug（git show 路径引号）让全仓库文件被误判 added，118 个单测全绿却毫无察觉，
 * 是靠跑真实仓库才发现的。任何改动引擎的行为，都应重跑本脚本做端到端核对。
 *
 * 用法：
 *   node scripts/scan-repo.cjs <仓库绝对路径> [baseRef] [headRef]
 *
 * 示例：
 *   node scripts/scan-repo.cjs ../interview-forge main~20 main
 *   node scripts/scan-repo.cjs /path/to/repo HEAD~3 HEAD
 *
 * 说明：gitUrl 传本地绝对路径即可（worker 内部走 git clone，不依赖网络）。
 *      完整 JSON 结果写入 /tmp/cg-scan-<仓库名>.json。
 */
const { Worker } = require("node:worker_threads");
const path = require("node:path");
const fs = require("node:fs");

const CG = path.resolve(__dirname, "..");
const SRC = process.argv[2] ? path.resolve(process.argv[2]) : null;
const baseRef = process.argv[3] || "main~10";
const headRef = process.argv[4] || "main";

if (!SRC || !fs.existsSync(SRC)) {
  console.error("用法: node scripts/scan-repo.cjs <仓库绝对路径> [baseRef] [headRef]");
  console.error("示例: node scripts/scan-repo.cjs ../interview-forge main~20 main");
  process.exit(1);
}

const name = path.basename(SRC);
const workdir = `/tmp/cg-scan-${name}`;
fs.rmSync(workdir, { recursive: true, force: true });

const w = new Worker(path.join(CG, "worker", "analyze.worker.cjs"), {
  workerData: { repoId: `local-${name}`, gitUrl: SRC, baseRef, headRef, workdir },
});

w.once("message", (msg) => {
  if (msg.error) {
    console.error("WORKER ERROR:\n" + msg.error);
    process.exit(1);
  }
  const { result } = msg;
  const outFile = `/tmp/cg-scan-${name}.json`;
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));

  const s = result.summary;
  console.log(`=== ${name}  ${baseRef}..${headRef} ===`);
  console.log(
    `  文件 ${s.totalFiles} | 符号 ${s.totalSymbols} | 变更文件 ${s.changedFileCount} | 变更符号 ${s.changedSymbolCount}`
  );
  console.log(`  定级: high ${s.high} / medium ${s.medium} / low ${s.low}`);

  const bySev = { high: [], medium: [], low: [] };
  for (const c of result.impactChain) bySev[c.severity].push(c);
  const defs = result.impactChain.filter((c) => c.symbol === "default");

  console.log(`\n=== default 导出专题（${defs.length} 条 / 全部 ${result.impactChain.length} 条）===`);
  if (!defs.length) console.log("  （无）");
  for (const c of defs) {
    console.log(
      `  ${c.file}#default | ${c.changeType} | ${c.severity} | ${c.confidence} | 引用 ${c.impactedFiles.length}`
    );
  }

  console.log("\n=== HIGH ===");
  if (!bySev.high.length) console.log("  （无）");
  for (const c of bySev.high) {
    console.log(`  ${c.file}#${c.symbol} | ${c.changeType} | ${c.confidence} | 引用 ${c.impactedFiles.length}`);
    if (c.impactedFiles.length) console.log(`      → ${c.impactedFiles.slice(0, 5).join(", ")}`);
  }

  console.log("\n=== MEDIUM ===");
  if (!bySev.medium.length) console.log("  （无）");
  for (const c of bySev.medium) {
    console.log(`  ${c.file}#${c.symbol} | ${c.changeType} | ${c.confidence} | 引用 ${c.impactedFiles.length}`);
  }

  console.log(`\n=== LOW 前 10 条（共 ${bySev.low.length}）===`);
  for (const c of bySev.low.slice(0, 10)) {
    console.log(`  ${c.file}#${c.symbol} | ${c.changeType} | ${c.confidence} | 引用 ${c.impactedFiles.length}`);
  }

  console.log(`\n完整结果: ${outFile}`);
  process.exit(0);
});

w.once("error", (e) => {
  console.error("WORKER THREAD ERROR:", e);
  process.exit(1);
});
