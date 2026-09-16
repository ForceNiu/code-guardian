# Code Guardian 全量代码公平评价

> 评价范围：通读全部源码——38 个 `.ts/.tsx`（4234 行）+ 3 个 `.cjs` 引擎（931 行）+ 10 个测试文件（8 个 `.ts` + 2 个 `.cjs`）。
> 评价前提：**非公网部署**（内部 / 个人 / 演示）。据此，外部威胁模型（SSRF、公网滥用）不计入主要风险；内部可靠性、正确性、可维护性为主。
> 方法：逐文件阅读 + 跨模块一致性核验，结论均附代码位置佐证。
>
> ⚠️ **勘误与进展（2026-09-15 更新）**——本报告初版有一处**重大误判**，且初版列出的问题已随会话修复，一并说明以免误导：
> - **P1「核心引擎零测试」是错的**：`tests/rules.test.cjs`（17KB）与 `tests/analyze-core.test.cjs`（18KB）自 2026-09-03 即存在，实测全绿。误判根因：初版只统计了 `.ts` 测试文件，漏掉 2 个 `.cjs` 测试文件。经两轮补测，两个引擎测试文件现为 76 case。
> - **P2 全链路无超时** → ✅ 已修复。
> - **P3 崩溃中间态任务不回收** → ✅ 已修复。
> - **P4 git 命令注入** → ✅ 已修复。
> - **P5 规则引擎三项简化**（中间插参误判 / barrel `export *` 不追踪 / 直接重命名漏识 / 嵌套对象类型降级） → ✅ **已全部修复**（2026-09-15 第二轮）。

---

## 1. 总体结论

**评级：B+（良好，可内部使用）**

架构清晰、分层合理、核心分析引擎（规则 + AST）设计严谨、AI 集成与降级策略成熟、前端完成度高。核心引擎单测充分（两个引擎测试文件 76 case；全套 118 case 全绿）。

**勘误后重新定位的重点（2026-09-15 最终状态）**：

1. ~~核心引擎零测试~~ → **误判**（见顶部勘误）。核心引擎单测早已存在且充分。
2. **全链路无超时**（初版 P2）→ ✅ 已修复：调度器加单任务硬超时（300s）、Worker 自身软超时（240s，能真正 `terminate()` 回收线程）、`cve-scan`/`bundle-size` 加 `AbortSignal.timeout`、git 调用加 120s timeout。
3. **规则引擎三项简化**（初版 P5）→ ✅ 已全部修复：barrel `export *` 穿透追踪、直接符号重命名识别、嵌套对象类型展开。
4. **仍在的边界**：`scheduler.ts` 仍无单测（P1 唯一残留），P6 收尾打磨项未动。

---

## 2. 逐模块评价

| 文件 | 职责 | 评级 | 关键发现 |
|------|------|------|----------|
| `src/lib/prisma.ts` | Prisma 单例 | 🟢 | globalThis 缓存，规避 dev 热重载耗尽连接。规范。 |
| `src/lib/types.ts` | 共享类型契约 | 🟢 | 文档详尽，worker/主线程/前端共用契约清晰。 |
| `src/lib/persist.ts` | 符号表持久化 | 🟢 | **2026-09-15 已改**：三段写入收进 `prisma.$transaction`（消除「旧符号已删、新符号未写」中间态）；`deleteMany`/`createMany` 由「每文件各一次」改为整批一次往返（3N → 2）。 |
| `src/lib/enqueue.ts` | 任务入队（幂等） | 🟢 | 唯一索引 `(repoId,mrId,commitSha)` + P2002 捕获去重。设计正确。 |
| `src/lib/events.ts` | 进程内事件总线 | 🟢 | EventEmitter 单例，setMaxListeners(1000)，多实例局限已注明（预留 Redis）。 |
| `src/lib/scheduler.ts` | 调度编排 | 🟢 | 原子认领（`updateMany where pending`）+ 并发上限 3 正确；**单任务超时与崩溃中间态回收已于 2026-09-15 补上**。仍无单测。 |
| `src/instrumentation.ts` | 启动拉起调度器 | 🟢 | 仅 nodejs runtime 执行。规范。 |
| `src/lib/utils.ts` | `cn` 工具 | 🟢 | clsx+tailwind-merge。标准。 |
| `src/app/api/tasks/route.ts` | 列表/手动触发 | 🟢 | GET 分页带上下限；POST Zod 校验，commitSha 回退合理。手动触发无鉴权（内部可接受）。 |
| `src/app/api/tasks/[id]/route.ts` | 任务详情 | 🟢 | Next15 `params Promise` 模式，404 处理正确。 |
| `src/app/api/tasks/[id]/stream/route.ts` | SSE | 🟢 | ReadableStream+心跳+cleanup，`X-Accel-Buffering:no`。良好。 |
| `src/app/api/webhook/route.ts` | Webhook 入口 | 🟢 | 签名校验（GitLab token / GitHub HMAC），三源分发 + 统一格式兜底。 |
| `src/lib/ai/deepseek.ts` | LLM 客户端 | 🟢 | 手写 HTTPS-over-代理隧道规避 undici 挂死；4 次退避重试 + 429 处理 + AbortSignal + 300s 超时。**最见工程功力**。 |
| `src/lib/ai/enrich.ts` | AI 合并层 | 🟢 | 合并 severity/confidence/suggestion 并重算 summary；无 key/失败静默降级。 |
| `src/lib/ai/semantic-graph.ts` | LangGraph 4 节点 | 🟢 | restate/retrieve 纯函数；predict/suggest 调 LLM；JSON 校验失败回灌重试；`withTimeout` 包裹。严谨。 |
| `src/lib/security/index.ts` | 安全门禁入口 | 🟢 | CVE+体积 `Promise.allSettled` 尽力降级，不阻断主链路。 |
| `src/lib/security/cve-scan.ts` | CVE 扫描 | 🟢 | npm Bulk Advisory；`fetchImpl` 可注入；**fetch 超时已于 2026-09-15 加（15s）**。 |
| `src/lib/security/bundle-size.ts` | 体积检测 | 🟢 | registry unpackedSize + 有限并发；单包失败跳过；**fetch 超时已于 2026-09-15 加（10s）**。 |
| `src/lib/security/dependency-manifest.ts` | 依赖清单提取 | 🟢 | package.json+lockfile 解析，@types 过滤，精确版本覆盖。正确。 |
| `src/lib/status/gitlab-status.ts` | GitLab 回写 | 🟢 | 状态映射（done+high→failed）；非 gitlab/无 token/非法 gitUrl 静默跳过；`fetchImpl` 可注入。 |
| `src/lib/webhook-adapters.ts` | 多源适配 | 🟢 | detectEvent + HMAC `timingSafeEqual` 防时序侧信道 + 三适配器。纯函数可测。 |
| `src/worker/run-analysis.ts` | worker 封装 | 🟢 | worker_threads + `settled` 防双 resolve；**2026-09-15 加 Worker 自身软超时（240s）**——短于 scheduler 的 300s，超时主动 `terminate()` 真正回收线程（scheduler 超时只能改状态、杀不掉线程）。 |
| `src/worker/analyze.worker.cjs` | git/IO 编排 | 🟢 | **2026-09-15 已改**：git 调用从 `execSync` 拼串改为 `execFileSync` 参数数组 + 120s timeout → 注入点消除。**新增 barrel 穿透**：`resolveExportOrigin` 沿 `export *` 链解析到真正的定义文件，跨 barrel 的影响链路不再漏报。 |
| `src/worker/rules.cjs` | 规则引擎（核心） | 🟢 | semver 判定表严谨、置信度三档分流清晰；**单测充分（`tests/rules.test.cjs`）**；「中间插入必填参数」误判、直接重命名定级均已修复。 |
| `src/worker/analyze-core.cjs` | AST/影响图（核心） | 🟢 | Babel 解析、signature 稳定性（字段/class 成员排序）、re-export 重命名配对、**直接符号重命名配对**（保守：恰好一删一增 + 同类型同签名）、**嵌套对象类型递归展开**、`export *` 转发边采集、增量缓存；**单测充分（`tests/analyze-core.test.cjs`）**。 |
| `src/app/page.tsx` | 首页 | 🟢 | 骨架屏 + 3s 轮询 + 表单去重；Hero 统计用 `tasks.length`（受 size=50 限制，轻微不准）。 |
| `src/app/tasks/[id]/page.tsx` | 报告页 | 🟢 | SSE+轮询降级、各字段可选链容错旧任务、`text-success`/`engine-tag` 令牌已在 globals.css 定义。 |
| `src/components/*` | UI 组件 | 🟢 | RiskSummary/StatusSteps/DiffViewer/ImpactTable 均良好；**DiffViewer 的 `theme` 从 `options` 移到顶层 prop（Monaco DiffEditor 正确用法）**；**ImpactTable 恢复「规则 / AI」判定来源标记**（前端改版时曾丢失，`engineOf` 一度成死代码）；`Button` 声明 `asChild` 但未实现（死属性）。 |
| `src/components/ui/*` | 基础组件 | 🟢 | shadcn 风格 cva + forwardRef，可访问性到位。 |
| `tests/*.test.ts` (8) + `tests/*.test.cjs` (2) | 单元测试 | 🟢 | **实测 118 case 全绿**。核心引擎（rules/analyze-core）已覆盖（2 个 `.cjs` 测试，各 38 case）；`scheduler` 仍无单测。 |

---

## 3. 全局亮点（证据支撑）

- **分层与解耦到位**：API 路由薄控制器、lib 业务服务、worker_threads 跑 CPU 分析、Prisma 管数据；横切关注点（events/security/status/webhook）独立目录。
- **并发与幂等正确**：调度器 `updateMany where {id,status:'pending'}` 原子认领，双保险防重复处理；入队唯一索引 + P2002 去重。
- **AI 集成成熟**：DeepSeek 客户端绕过沙箱 undici 挂死（手写代理隧道）、退避重试、超时；LangGraph 纯函数节点 + JSON 校验回灌；无 key/失败全程静默降级。
- **规则引擎严谨**：删/收紧=breaking、增/放宽=兼容 的 semver 判据系统化为 `RULE_TABLE`；置信度 proven/heuristic/uncertain 三档实现「规则处理 80%、AI 只接 uncertain」的双轨设计。
- **AST 核心工程化好**：`signature` 对字段/class 成员排序保证重排不误报；`pairRenameExports` 识别 re-export 重命名降误报；增量缓存（md5 + DB）省重解析；纯函数导出便于单测。
- **前端完成度高**：骨架屏、SSE 失败降级轮询、AI 建议 sub-row、置信度徽章、Monaco Diff（CDN 固定版本）、色彩令牌齐全。
- **测试真实有效**：10 文件 118 case，覆盖事件总线、AI 合并、LangGraph 重试、webhook 签名、CVE/bundle/manifest/GitLab **及核心引擎**，mock 注入规范。

---

## 4. 全局风险（按「非公网」前提重排优先级）

### ✅ P1 — （勘误）核心引擎并非零测试
初版称 `rules.cjs` / `analyze-core.cjs` 无任何单测，**错误**。这两个核心模块自有单测：`tests/rules.test.cjs`（17KB）+ `tests/analyze-core.test.cjs`（18KB），覆盖 `classifyFunctionChange` / `classifyTypeFieldChange` / `classifyEnumChange` / `classifyClassChange` / `runRules` / `containsAny` / `signature` / `diffSymbols` / `parseFile` / `resolveImport` / `resolveExportOrigin` / `pairRenameExports` 等，2026-09-03 建、61 case 全绿，经两轮补测至 **76 case**（两文件各 38）。
**唯一仍缺的**：`scheduler.ts` 编排单测（可 mock prisma/runAnalysis/enrich*）。

### ✅ P2 — 全链路无超时（已修复 2026-09-15）
- `scheduler.ts`：✅ 加单任务硬超时（`TASK_TIMEOUT_MS = 300s`）+ `onTaskTimeout` 守卫，超时置 failed 且防占死并发槽。
- `cve-scan.ts` / `bundle-size.ts`：✅ `fetch` 加 `AbortSignal.timeout`（15s / 10s）。
- `analyze.worker.cjs`：✅ git 调用改用 `execFileSync` + `timeout: 120s`。
- `run-analysis.ts`：✅ 加 Worker 自身软超时（`WORKER_TIMEOUT_MS = 240s`）。**为什么必须两层**：scheduler 的超时只能改 DB 状态，杀不掉 `worker_threads` 线程；Worker 自超时才能 `terminate()` 真正回收，超时后不带病占 CPU。

### ✅ P3 — 崩溃遗留任务不回收（已修复 2026-09-15）
调度器 `tick()` 开头新增回收：把 `status ∈ {parsing, analyzing, reporting}` 且 `updatedAt` 超过 10 分钟的任务重置回 `pending` 重新入队。

### ✅ P4 — git 命令注入 / 健壮性（已修复 2026-09-15）
`analyze.worker.cjs` 的 5 处 git 调用（clone / fetch / checkout / diff / show）全部从 `execSync("git ... ${var}")` 字符串拼接改为 `execFileSync("git", [args], { timeout })` 参数数组，`gitUrl`/`ref`/`file` 不再经 shell 解析。注入点消除，含空格/引号的路径 bug 一并解决。

### ✅ P5 — 规则引擎三项简化（已全部修复 2026-09-15 第二轮）
- ✅ **中间插入必填参数**：`extractParams` 现提取参数名，`classifyFunctionChange` 改 name-aware 对齐，能识别中间插入/删除（补 3 个用例）。
- ✅ **直接符号重命名**（`export function foo` → `export function bar`）：原先识别为「删 + 增」→ 产生虚假高危、且漏掉 rename 语义。现在 `pairRenameExports` 末尾加**保守配对**——整份变更里「恰好 1 删 + 1 增」、同为非 reexport/default、符号类型与签名均相同才合并为 `changeType:"renamed"`（high/proven），避免多个同签名符号互相误配；补 4 个用例（含「两个同签名符号增删时不得误配」的反向用例）。
- ✅ **`export *` / barrel 重导出链不追踪**：原先 `import { foo } from "./barrel"` 会把引用方注册在 barrel 上，而变更符号在真实定义文件 → 影响链路查不到，直接削弱核心卖点。现在：
  - `parseFile` 采集 `ExportAllDeclaration` 为 `reexports`（转发边）；
  - worker 新增 `resolveExportOrigin()`，沿 `export *` 链递归解析到**真正定义该符号的文件**，反向索引据此归位；
  - `reexports` 随 `file_snapshots.symbols` 一起持久化，增量缓存命中时也能复用（旧缓存无此字段走容错分支）；
  - 循环引用用 `seen` 集合截断，不会无限递归。
- ✅ **嵌套对象字面量类型降级为 `{...}`**：`typeToString` 的 `TSTypeLiteral` 分支改为**递归展开**——成员按名排序、保留 `?` 可选标记，输出稳定文本（如 `{id:number,tag?:string}`），内部结构变化现在能被检测到。
- 🔎 **顺带修掉两个隐藏 bug**（修复 barrel 过程中发现）：
  1. `pairRenameExports` 原实现在「存在 reexport 重命名配对」时会**丢弃所有非 reexport 的 `removed` 变更**（第二个循环无条件 `continue` 掉了全部 removed）。重构为「配对的剔除、未配对的原样保留」，改用 `pairedAdded`/`pairedRemoved` 双集合精确排除。
  2. **删除文件的影响链被漏报**：`allFiles` 只列 head 存在的文件，`import { x } from "./将被删除的模块"` 会因 `resolveImport` 解析不到目标而被 `continue` 跳过 → `impactedFiles` 为空 → 规则引擎把 `removed` 从 `high` 误降为 `medium`。现把 base 侧已删除文件并入解析范围（`resolvableFiles`），删除被广泛引用的模块能正确报出全部引用方。
- 🧪 **可测性改进**：把 barrel 穿透逻辑从 worker 的 `main()` 内嵌函数下沉为 `analyze-core.cjs` 的纯函数 `resolveExportOrigin()` 并导出，补 6 个用例（直接命中 / 单级 / 多级链 / 循环转发不死循环 / 符号不存在 / 删除文件场景）。
- ⚪ **残余边界（诚实标注，未修）**：若被删除的正是 **barrel 文件本身**（`index.ts` 只写 `export *`），`export *` 不产生具名导出，base 侧 `parseFile(...).exports` 为空 → 该 barrel 的删除仍不会展开成具体符号。要彻底覆盖需在 base 侧也构建转发图并按链展开符号名，成本较高，留作后续。

### 🟢 P6 — 收尾打磨
- `Button` 声明 `asChild` 但未实现（死属性，调用方若依赖会出错）→ 删掉或接 `Slot`。
- 首页 Hero「最近任务数」用 `tasks.length`（受 `size=50` 限制）→ 改用 `total`。
- `next build` 会告警：`package-lock.json` 在父目录 `/Users/<user>/WorkBuddy/AI`、落在 git 仓库之外 → 建议在 `next.config.ts` 显式设 `turbopack.root`，否则构建根推断可能不稳。
- 错误信息含 stack 前 500 字落库 + SSE（内部可接受；若在乎可只存服务端日志）。
- Monaco 走 jsdelivr CDN：纯内网/离线部署时 Diff 视图不可用（运营依赖）。
- 手动触发 POST 无鉴权：仅当多用户互不信任时才需加（API-Key 最简）。

---

## 5. 对前几轮评价的更正（诚实说明）

1. **「测试覆盖不足」不准确** → 实测测试真实有效、覆盖边角模块良好。
2. **`code-review-analyzer` 不适用本 TS 项目** → 该 skill 是 Python 脚本、只处理 `.py`；此前指南里把它当主角写是错的，应换 ESLint + @typescript-eslint + eslint-plugin-security 在 pre-commit/CI 跑（质量门禁，非阻塞）。
3. **「前端改为骨架屏」建议已落地** → `page.tsx`/`tasks/[id]/page.tsx` 已有骨架屏 + SSE 失败降级轮询。
4. **「错误信息外泄」由阻塞降为低** → 非公网前提下内部可接受，仅作打磨项。
5. **「调度器无单测」只是冰山一角** → 当时判断有误；真正零测试的是核心引擎——但这条本身也是**误判**（见第 6 条）。
6. **【本次新增·最重要】「核心引擎零测试」是误判** → 初版只统计了 `.ts` 测试文件（8 个），**漏掉 2 个 `.cjs` 测试文件**（`tests/rules.test.cjs`、`tests/analyze-core.test.cjs`）。教训：审查任何项目时，**文件枚举不能只按主语言扩展名过滤**，`.cjs`/`.mjs`/`.cts` 等变体都要纳入（这与「工具包 eslint 漏配 `.cjs`」是同一类盲区）。

---

## 6. 建议执行顺序（含完成状态）

1. ~~P1 补核心引擎单测~~ → ✅ **本就完成**（76 case 全绿）；仅剩 `scheduler.ts` 编排单测待补。
2. ~~P2 全链路加超时~~ → ✅ 已完成（2026-09-15）：调度器 300s + Worker 自超时 240s + fetch/git 超时。
3. ~~P3 启动回收 stale 中间态任务~~ → ✅ 已完成（2026-09-15）。
4. ~~P4 git 调用改数组参数~~ → ✅ 已完成（2026-09-15）。
5. ~~P5 规则引擎三项简化~~ → ✅ **已全部完成**（2026-09-15 第二轮）：barrel 穿透 / 直接重命名 / 嵌套对象类型。
6. **P6 收尾打磨**（未动）：Button asChild、Hero 统计、`turbopack.root`、CDN 依赖评估。

**P2–P5 已全部闭环**，四道门禁（lint / typecheck / test / build）实测全绿；P1 纠偏后无阻塞项。项目可放心作为内部可用的代码副作用检测平台。剩余可选项为 P1 的 `scheduler` 单测与 P6 打磨。

---

## 7. 真实仓库验证发现的「签名盲区」（2026-09-15，已修）

P1–P5 闭环、125 个单测全绿之后，拿真实仓库（interview-forge / failwatch）与自建最小 fixture 复扫，
查出两个**单测完全拦不住的静默漏报**。这是本轮最重要的一次发现。

### 7.1 根因

`signature()` 对 `type === "default"` 和 `type === "variable"` 直接 `return sym.type`——
签名恒为常量字符串，于是 `diffSymbols` 里 `signature(o) !== signature(n)` 永远为假，
**任何破坏性变更都被判成「无变化」，输出看起来完全正常**。

两类受影响：

| 写法 | 说明 |
|---|---|
| `export default function Page(props) {}` | 此前记在「已知盲区」，但未量化 |
| `export const Comp = (props) => {}` | **此前未发现**，React / Next.js 里比 default 更常见 |

### 7.2 量化（实测）

| 仓库 | 导出总数 | 无签名 | 盲区占比 |
|---|---|---|---|
| interview-forge | 91 | 37 | **41%** |
| code-guardian（自检） | 84 | 13 | **15%** |

可修复覆盖度：default 导出中 **85%（interview-forge）～100%（code-guardian）** 是
`export default function`，可直接提取签名；剩余 `export default memo(X)` 一类仍降级（不误报）。

### 7.3 决定性验证（最小 fixture，同一处破坏性改动）

| 场景 | 修复前 | 修复后 |
|---|---|---|
| default 导出新增必填 prop | 变更符号 **0**，输出「完全安全」 | `modified` / medium / heuristic / 引用 1 |
| const 箭头函数新增必填 prop | 变更符号 **0** | `modified` / medium / heuristic / 引用 1 |
| 具名 `export function`（对照组） | `modified` / medium / heuristic | 同左（行为不变） |

### 7.4 修复

**`src/worker/analyze-core.cjs`**
- `nodeKind()` 支持 `ArrowFunctionExpression` / `FunctionExpression`；
- 新增 `attachKindInfo()` / `isSignatureBearing()`；
- `ExportDefaultDeclaration` 挂签名；**裸标识符**（`export default Page`）借顶层 local 声明的签名——
  否则 `export default function X` → `function X; export default X` 这种纯语法重构会被误报成 API 变更；
- `ExportNamedDeclaration` 的 variable 分支：init 为箭头/函数表达式时挂签名；
- `signature()`：带 `params` 的符号一律走函数签名（不再返回类型名），`classMembers` 同理放宽。

**`src/worker/rules.cjs`**
- 新增 `isFunctionLike()`；`runRules` 的 modified 分支改为函数型判定，
  让 default / const 箭头与具名函数**同级（heuristic，0 Token）**，而不是落 `uncertain` 去烧 AI。

### 7.5 真实仓库复扫（interview-forge `main~20..main`）

- 变更符号 4 → 5：新增检出 `src/app/page.tsx#default`
  （`export default async function Home()` → 带 `searchParams`，Next 16 语义，**真阳性**）；
- 同批**消除 4 条纯语法重构误报**；
- 自检（扫 code-guardian 自身 `main~5..main`）正确报出
  `src/lib/types.ts#SymbolTableEntry` 变更影响 `src/lib/persist.ts`（high / proven / 引用 1）。

### 7.6 配套工具

```bash
npm run scan <仓库绝对路径> [baseRef] [headRef]
# 例：npm run scan ../interview-forge main~20 main
```

`scripts/scan-repo.cjs` —— 绕过 DB/HTTP 直接驱动分析 worker。
**任何引擎改动都应重跑真实仓库核对**：这两次事故（git show 引号、签名盲区）都是 100+ 单测全绿时发生的。

测试 125 → **139**（新增 14 条覆盖两个盲区与误报抑制）。
