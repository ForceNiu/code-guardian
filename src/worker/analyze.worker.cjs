// Worker 线程：git 操作 + AST 解析 + 导出符号提取 + 反向索引 + 影响链路计算
// 纯 CPU/IO 密集计算放到 worker_threads，避免阻塞 Next.js 主线程事件循环。
// 说明：本文件用 CommonJS（.cjs）以便被 worker_threads 直接 require，不经过打包器。
// 纯函数（解析/符号提取/diff/严重度）已抽到 analyze-core.cjs，供单测复用。

const { parentPort, workerData } = require("node:worker_threads");
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  SOURCE_EXT,
  md5,
  parseFile,
  resolveImport,
  diffSymbols,
  severityFor,
} = require("./analyze-core.cjs");

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".cache", "coverage"]);

/** 执行 git 命令，失败返回 null（不抛，交由调用方判断） */
function git(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return null;
  }
}

/** 克隆 / 拉取仓库到本地缓存目录 */
function ensureRepo(gitUrl, workdir) {
  fs.mkdirSync(workdir, { recursive: true });
  const isCloned = fs.existsSync(path.join(workdir, ".git"));
  if (!isCloned) {
    git(`git clone --quiet "${gitUrl}" "${workdir}"`, process.cwd());
    if (!fs.existsSync(path.join(workdir, ".git"))) {
      throw new Error(`git clone 失败: ${gitUrl}`);
    }
  } else {
    git(`git -C "${workdir}" fetch --quiet --all --prune`, process.cwd());
  }
}

/** 变更文件列表（git diff base...head --name-only） */
function changedFiles(baseRef, headRef, workdir) {
  const out = git(`git -C "${workdir}" diff --name-only ${baseRef}...${headRef}`, workdir);
  if (out == null) {
    throw new Error(`git diff 失败：baseRef/headRef 不可达，请检查引用`);
  }
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 递归列出仓库内所有源码文件（相对仓库根的 posix 路径） */
function listSourceFiles(workdir) {
  const result = [];
  function walk(dir, rel) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(full, relPath);
      } else if (SOURCE_EXT.includes(path.extname(e.name))) {
        result.push(relPath);
      }
    }
  }
  walk(workdir, "");
  return result;
}

function main() {
  const { gitUrl, baseRef, headRef, workdir } = workerData;
  ensureRepo(gitUrl, workdir);

  const allFiles = new Set(listSourceFiles(workdir));
  const changed = changedFiles(baseRef, headRef, workdir).filter((f) =>
    SOURCE_EXT.includes(path.extname(f)),
  );

  // 1) 全量解析：导出符号表 + 各文件 import
  const exportsByFile = new Map();
  const importsByFile = new Map();
  for (const file of allFiles) {
    const content = fs.readFileSync(path.join(workdir, file), "utf8");
    const { exports, imports } = parseFile(content);
    exportsByFile.set(file, exports);
    importsByFile.set(file, imports);
  }

  // 2) 反向索引：`${file}#${symbol}` -> 引用它的文件列表
  const reverseIndex = new Map();
  for (const [importer, imports] of importsByFile) {
    for (const imp of imports) {
      const targetFile = resolveImport(imp.source, importer, allFiles);
      if (!targetFile) continue;
      const key = `${targetFile}#${imp.name}`;
      if (!reverseIndex.has(key)) reverseIndex.set(key, []);
      if (!reverseIndex.get(key).includes(importer)) reverseIndex.get(key).push(importer);
    }
  }

  // 3) 变更符号 diff：对比 base 与 head 的导出签名
  const changedSymbols = [];
  const changedFileStatus = [];
  for (const file of changed) {
    const existsInHead = allFiles.has(file);
    const newExports = existsInHead ? exportsByFile.get(file) || [] : [];
    const oldContent = git(`git -C "${workdir}" show ${baseRef}:"${file}"`, workdir);
    const oldExports = oldContent != null ? parseFile(oldContent).exports : [];

    let status = "modified";
    if (oldContent == null) status = "added";
    else if (!existsInHead) status = "deleted";
    changedFileStatus.push({ path: file, status });

    changedSymbols.push(...diffSymbols(file, oldExports, newExports));
  }

  // 4) 影响链路：每个变更符号 -> 反向查 importers（M3 会在此接入确定性规则引擎）
  const impactChain = [];
  for (const cs of changedSymbols) {
    const impacted = reverseIndex.get(`${cs.file}#${cs.symbol}`) || [];
    const severity = severityFor(cs.changeType, impacted.length);
    impactChain.push({
      file: cs.file,
      symbol: cs.symbol,
      changeType: cs.changeType,
      impactedFiles: impacted,
      severity,
    });
  }

  // 5) 汇总
  const summary = {
    totalFiles: allFiles.size,
    totalSymbols: [...exportsByFile.values()].reduce((a, s) => a + s.length, 0),
    changedFileCount: changed.length,
    changedSymbolCount: changedSymbols.length,
    high: impactChain.filter((i) => i.severity === "high").length,
    medium: impactChain.filter((i) => i.severity === "medium").length,
    low: impactChain.filter((i) => i.severity === "low").length,
  };

  // 6) 符号缓存表（供主线程持久化到 file_snapshots + export_symbols）
  const symbolTable = [];
  for (const [file, exports] of exportsByFile) {
    const content = fs.readFileSync(path.join(workdir, file), "utf8");
    const hash = md5(content);
    const symbols = exports.map((s) => ({
      name: s.name,
      type: s.type,
      line: s.line,
      importers: reverseIndex.get(`${file}#${s.name}`) || [],
    }));
    symbolTable.push({ filePath: file, hash, symbols });
  }

  parentPort.postMessage({
    result: { changedFiles: changedFileStatus, changedSymbols, impactChain, summary },
    symbolTable,
  });
}

try {
  main();
} catch (err) {
  // 把 Worker 内的异常回传给主线程，主线程据此把任务标记为 failed
  parentPort.postMessage({ error: err instanceof Error ? err.stack || err.message : String(err) });
}
