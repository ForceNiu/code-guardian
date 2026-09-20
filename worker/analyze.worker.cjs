// Worker 线程：git 操作 + AST 解析 + 导出符号提取 + 反向索引 + 影响链路计算
// 纯 CPU/IO 密集计算放到 worker_threads，避免阻塞 Next.js 主线程事件循环。
// 说明：本文件用 CommonJS（.cjs）以便被 worker_threads 直接 require，不经过打包器。
// 纯函数（解析/符号提取/diff/严重度）已抽到 analyze-core.cjs，供单测复用。

const { parentPort, workerData } = require("node:worker_threads");
// P4：用 execFileSync + 参数数组，绝不做 shell 字符串拼接——
// ① gitUrl/ref/file 直接作参数，不经 shell 解析 → 消除命令注入；
// ② timeout 到点 kill → 防 git 挂起把任务卡死。
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  SOURCE_EXT,
  md5,
  parseFile,
  diffSymbols,
  resolveFileSymbols,
  resolveExportOrigin,
  buildPathAliases,
  resolveImportWithAlias,
} = require("./analyze-core.cjs");
const { runRules } = require("./rules.cjs");

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".cache", "coverage"]);

/** 执行 git 命令，失败/超时返回 null（不抛，交由调用方判断）。
 *  参数始终以数组传入（execFileSync），不经 shell，杜绝注入。 */
const GIT_TIMEOUT_MS = 120000;
function git(args, cwd) {
  try {
    // 🔴 关闭 quotepath：git 默认 core.quotepath=true，会把非 ASCII 路径（中文文件名）
    //    转义成 "src/\347\224\250...ts" 并加引号，与 listSourceFiles() 用 fs.readdirSync
    //    拿到的真实路径对不上 → 这些文件的变更会被静默丢弃（U11，漏报方向）。
    //    放在这里统一生效，覆盖 clone / fetch / checkout / diff / show 全部调用。
    return execFileSync("git", ["-c", "core.quotepath=false", ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: GIT_TIMEOUT_MS,
    });
  } catch {
    return null;
  }
}

/** 克隆 / 拉取仓库到本地缓存目录 */
function ensureRepo(gitUrl, workdir) {
  fs.mkdirSync(workdir, { recursive: true });
  const isCloned = fs.existsSync(path.join(workdir, ".git"));
  if (!isCloned) {
    git(["clone", "--quiet", gitUrl, workdir], process.cwd());
    if (!fs.existsSync(path.join(workdir, ".git"))) {
      throw new Error(`git clone 失败: ${gitUrl}`);
    }
  } else {
    // 🔴 原写法丢弃返回值：fetch 失败（网络 / 鉴权）时照常往下走，用上一次的缓存继续分析。
    //    fetch 失败 + 陈旧检出 = 双重静默错报，所以改成硬失败（P0-1 选项 A）。
    //    代价：弱网时任务落 failed，而不是出一份基于旧代码的报告 —— 按项目红线，
    //    「响的失败」优于「静默错报」。
    const out = git(["-C", workdir, "fetch", "--quiet", "--all", "--prune"], process.cwd());
    if (out == null) {
      throw new Error("git fetch 失败：拒绝用上一次的缓存继续分析（否则会产出基于旧代码的报告）");
    }
  }
}

/** 把 ref 解析成「fetch 之后最新」的那一个引用。
 *  🔴 根因（P0-1）：`git fetch` 只更新 refs/remotes/origin/*，**本地分支不动**。
 *     直接 checkout 本地分支名 → 检出上次 clone 时的旧位置 → 整份报告基于旧代码，
 *     且不报错、不失败（静默错报，正是「输出正常 ≠ 在工作」）。
 *     实测（2026-09-20）：源仓库推 v3 后，checkout main 得到 v2，checkout origin/main 得到 v3。
 *  策略：优先 `origin/<ref>`；远端没有再回退原 ref。已实测覆盖 5 种边界：
 *    分支名 → origin/main 命中；sha → origin/<sha> 不存在、回退（正确）；
 *    tag → origin/<tag> 不存在、回退（tag 名本就不带 origin/）；
 *    已带 origin/ 前缀 → origin/origin/main 不存在、回退（正确）；
 *    main~N → origin/main~N 命中（等价语义）。
 *  用 `rev-parse --verify --quiet`：ref 不存在时**退出码非 0 且不打印**，
 *  正好落进 git() 现有的 `catch { return null }` → 零新增错误处理分支。 */
function resolveRef(ref, workdir) {
  const remote = `origin/${ref}`;
  if (git(["-C", workdir, "rev-parse", "--verify", "--quiet", `${remote}^{commit}`], workdir) != null) {
    return remote;
  }
  return ref;
}

/** 切换到 headRef（detached HEAD），保证工作区文件 = head 状态，供读取新代码全文 */
function checkoutHead(headRef, workdir) {
  const out = git(["-C", workdir, "checkout", "--force", "--quiet", headRef], workdir);
  if (out == null) {
    throw new Error(`git checkout 失败：headRef ${headRef} 不可达`);
  }
}

/** 变更文件列表（git diff base...head --name-only） */
function changedFiles(baseRef, headRef, workdir) {
  const out = git(["-C", workdir, "diff", "--name-only", `${baseRef}...${headRef}`], workdir);
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
  const { gitUrl, baseRef, headRef, workdir, cache } = workerData;
  ensureRepo(gitUrl, workdir);
  // 🔴 P0-1：后续所有 git 读操作都必须用「已解析到远端」的 ref，不能用原始分支名
  //    （fetch 只更新 origin/*，本地分支还停在 clone 时的位置 → 检出旧代码）。
  //    只在开头解析一次：git show 在变更文件循环里跑，逐次解析会多起 N 个 git 进程。
  const resolvedBase = resolveRef(baseRef, workdir);
  const resolvedHead = resolveRef(headRef, workdir);
  checkoutHead(resolvedHead, workdir);

  const allFiles = new Set(listSourceFiles(workdir));
  const changed = changedFiles(resolvedBase, resolvedHead, workdir).filter((f) =>
    SOURCE_EXT.includes(path.extname(f)),
  );
  const changedSet = new Set(changed);

  // 已从 head 删除、但 base 里存在的文件。必须一并纳入 import 解析范围：
  // 否则「删掉一个被广泛引用的文件」时 resolveImport 解析不到目标 → 引用方注册不上
  // → impactedFiles 为空 → 规则引擎把 removed 从 high 误降为 medium（漏报破坏性变更）。
  const baseOnlyFiles = new Set(changed.filter((f) => !allFiles.has(f)));
  const resolvableFiles = baseOnlyFiles.size > 0 ? new Set([...allFiles, ...baseOnlyFiles]) : allFiles;

  // 读根 tsconfig.json 的路径别名（如 @/* -> ./src/*）。
  // 没有别名时 buildPathAliases 返回空数组，resolveImportWithAlias 退化为纯相对解析，行为不变。
  let aliases = [];
  try {
    aliases = buildPathAliases(fs.readFileSync(path.join(workdir, "tsconfig.json"), "utf8"));
  } catch {
    aliases = []; // 无 tsconfig / 读不到 → 按无别名处理
  }

  // 1) 解析：变更文件重解析；未变更文件命中增量缓存则复用，否则解析
  const exportsByFile = new Map();
  const importsByFile = new Map();
  const reexportsByFile = new Map(); // barrel 转发边：file -> [{ source, line }]
  const hashByFile = new Map();
  let cacheHits = 0;
  // U5（2026-09-19）：按原因累计解析失败数，最终进 summary.parseFailures。
  // 此前解析失败完全静默，"我们不支持"和"你代码有错"在报告上长得一模一样。
  const parseFailures = {};
  for (const file of allFiles) {
    const content = fs.readFileSync(path.join(workdir, file), "utf8");
    const hash = md5(content);
    hashByFile.set(file, hash);
    const { exports, imports, reexports, hitCache, parseError } = resolveFileSymbols(
      file,
      changedSet.has(file),
      content,
      hash,
      cache,
    );
    if (hitCache) cacheHits++;
    // "unsupported" = 我们的能力边界；"syntax" = 代码本身有语法错；"empty" = 空文件
    if (parseError) parseFailures[parseError] = (parseFailures[parseError] || 0) + 1;
    exportsByFile.set(file, exports);
    importsByFile.set(file, imports);
    reexportsByFile.set(file, reexports || []);
  }

  // 2) 穿透 barrel：把 import 的目标文件解析到「真正定义该符号的文件」。
  //    处理 `export * from "./real"` 转发——否则重命名/删除 real.ts 里的符号时，
  //    import 方注册在 barrel 上（barrel#name），而变更符号在 real.ts，影响链路查不到。
  //    实现见 analyze-core.cjs 的 resolveExportOrigin（纯函数，可单测）。
  const originOf = (targetFile, name) =>
    resolveExportOrigin(targetFile, name, exportsByFile, reexportsByFile, resolvableFiles, undefined, aliases);

  // 3) 反向索引：`${file}#${symbol}` -> 引用它的文件列表
  //    经 resolveExportOrigin 归一：barrel 转发的 import 记到定义文件上，
  //    这样「定义文件符号变更 → 找到跨 barrel 的引用方」链路才成立。
  const reverseIndex = new Map();
  for (const [importer, imports] of importsByFile) {
    for (const imp of imports) {
      const targetFile = resolveImportWithAlias(imp.source, importer, resolvableFiles, aliases);
      if (!targetFile) continue;
      const origin = originOf(targetFile, imp.name) || targetFile;
      const key = `${origin}#${imp.name}`;
      if (!reverseIndex.has(key)) reverseIndex.set(key, []);
      if (!reverseIndex.get(key).includes(importer)) reverseIndex.get(key).push(importer);
    }
  }

  // 3) 变更符号 diff：对比 base 与 head 的导出签名
  const changedSymbols = [];
  const changedFileStatus = [];
  const diffs = []; // M4 Monaco Diff：每个变更文件的 base/head 全文
  for (const file of changed) {
    const existsInHead = allFiles.has(file);
    const newExports = existsInHead ? exportsByFile.get(file) || [] : [];
    // ⚠️ 绝不能给路径加引号：`execFileSync` 不经 shell，引号会变成路径的一部分
    // （git 会去找名为 "src/x.ts" 带引号的文件 → 找不到 → 返回 null → 所有文件被误判 added）。
    // 无 shell 时路径含空格也是安全的，不需要引号。
    const oldContent = git(["-C", workdir, "show", `${resolvedBase}:${file}`], workdir);
    const oldExports = oldContent != null ? parseFile(oldContent).exports : [];

    let status = "modified";
    if (oldContent == null) status = "added";
    else if (!existsInHead) status = "deleted";
    changedFileStatus.push({ path: file, status });

    // M4：取 head 版本全文（deleted 文件在 head 不存在 → 空串），供 Monaco Diff 两侧渲染
    const newContent = existsInHead ? fs.readFileSync(path.join(workdir, file), "utf8") : "";
    diffs.push({ path: file, status, oldContent: oldContent ?? "", newContent });

    changedSymbols.push(...diffSymbols(file, oldExports, newExports));
  }

  // 4) 影响链路：每个变更符号 -> 反向查 importers -> 确定性规则引擎定级
  const impactChain = [];
  for (const cs of changedSymbols) {
    const impacted = reverseIndex.get(`${cs.file}#${cs.symbol}`) || [];
    const { severity, confidence } = runRules(cs, impacted.length);
    impactChain.push({
      file: cs.file,
      symbol: cs.symbol,
      changeType: cs.changeType,
      impactedFiles: impacted,
      severity,
      confidence,
    });
  }

  // 5) 汇总
  const summary = {
    totalFiles: allFiles.size,
    totalSymbols: [...exportsByFile.values()].reduce((a, s) => a + s.length, 0),
    changedFileCount: changed.length,
    changedSymbolCount: changedSymbols.length,
    cacheHits,
    // U5：解析失败按原因计数。全为 0 时该对象为空 {} —— 前端据此判断"有没有文件没被看懂"。
    parseFailures,
    high: impactChain.filter((i) => i.severity === "high").length,
    medium: impactChain.filter((i) => i.severity === "medium").length,
    low: impactChain.filter((i) => i.severity === "low").length,
  };

  // 7) 符号缓存表（供主线程持久化到 file_snapshots + export_symbols）
  const symbolTable = [];
  for (const [file, exports] of exportsByFile) {
    const hash = hashByFile.get(file);
    const symbols = exports.map((s) => ({
      name: s.name,
      type: s.type,
      line: s.line,
      importers: reverseIndex.get(`${file}#${s.name}`) || [],
    }));
    symbolTable.push({
      filePath: file,
      hash,
      symbols,
      exports,
      imports: importsByFile.get(file) || [],
      reexports: reexportsByFile.get(file) || [],
    });
  }

  parentPort.postMessage({
    result: { changedFiles: changedFileStatus, changedSymbols, impactChain, summary, diffs },
    symbolTable,
  });
}

try {
  main();
} catch (err) {
  // 把 Worker 内的异常回传给主线程，主线程据此把任务标记为 failed
  parentPort.postMessage({ error: err instanceof Error ? err.stack || err.message : String(err) });
}
