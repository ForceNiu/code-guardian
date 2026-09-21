# 审计待办台账（Audit Backlog）

> **存在理由**：审计清单原本「没有家」——散落在未入库交接文档和每次对话上下文里，导致每开新对话重判一遍（实测重复 3 次，一次还推出错误条目数）。**任何状态变更就地改这份文件**，不留在对话里。
> 来源：2026-09-16 全项目审查（25 条）+ 同日 2 条静默漏报。口径：职责是「不漏」，排序是另一件事。
> **历史结案不入库**：已完成批（第一~九批）、审计收口批（AUD-1~AUD-28）、D 组补验（D1~D11）均按「执行史不改」原则留痕于仓库外 `学习笔记/code-guardian/历史报告-移出/` 与各提交；本文件只留**当前还活着的**挂账 + 明确不做的决策。

> 📦 归档声明（2026-09-19）：原 `docs/reports/` 下 5 份报告 + `docs/frontend-redesign.md` 已移出本仓库，归档在仓库外 `学习笔记/code-guardian/历史报告-移出/`。本台账指向 `docs/reports/*.md` 的链接均指向该归档目录。`E2E-RERUN-2026-09-19.md` 此前从未入库。独有内容（成本口径、复跑备案）已搬入 `docs/DEVELOPING.md` §1.1/§1.2。

## 图例

| 符号 | 含义 |
|---|---|
| ✅ | 已完成（附证据位置） |
| 🔜 | 待做 |
| ⛔ | 明确不做（won't fix）—— 必须写理由 + 回头条件 |
| ❓ | 待定（缺前置条件，不是缺决定） |

> 📌 引用约定（2026-09-21）：本文件 `文件:行号` 是写下当时的位置，历次修订会漂移。**核验按引号内「原话 / 标识符」去 `grep`，不按行号定位**；要按行号读用 `git show <当时提交>:<文件>`。指「当时那句错话」的行号按本约定保留；指「今天还在的内容」写成章节名 / 表名 ＋ `grep -n` 命令。

---

## 一、开放挂账（状态一变就改这一节）

### 1. 仓库级
| # | 条目 | 状态 | 备注 |
|---|---|---|---|
| git 身份 | 本地 `git user.name/email` 未设（红线面③，推前必设） | 🔜 未获批 | 本地 commit 回落 global，踩红线面③；现靠 Git Data API 规避 |
| 24 分支 | ✅ **已删**（2026-09-22）：24 个历史分支全部删除，远端复测**只剩 `main`** | ✅ 已处置 | 删前已重备份 tip sha：`学习笔记/code-guardian/branch-tips-backup-2026-09-22.txt`（25 行含 main）；复测命令 `gh api --paginate repos/ForceNiu/code-guardian/branches --jq '.[].name'`。⚠️ 本地 `git branch -r` 会残留 stale 远端跟踪引用，**以 `gh api` 实时结果为准** |
| 30 引用 | 在库 0 可改（2 处 `.md:行号` 为历史证据保留见 L38；原「30 处」是瘦身 + reports 移出前的旧数） | ✅ 已复核 | 全仓 `grep -n '\.md:\d+'` 仅 1 行 2 处，均在 L38，指已删「月 Token $200」claim（T5）；按 L18 约定历史证据保留不动；`tsconfig.json:42`（L53）非 .md、仍准，未计入 |
| **CVE-自依赖** | 项目**自身依赖链**含 **3 个 high 漏洞**：`prisma` → `@prisma/config` → `deepmerge-ts <8.0.0`（栈耗尽 GHSA-ggr8-5vv4-36mx） | 🔜 待议 | 复测：`npm audit --registry=https://registry.npmjs.org`（⚠️ 默认源 npmmirror **不支持 audit 接口**，必须显式换官方源，否则报 NOT_IMPLEMENTED）。修复需 `npm audit fix --force` → prisma 降到 6.12.0（**破坏性**）→ **未做**。尴尬点：本项目 M5 特性就是扫依赖 CVE，自身却带 3 个 high |

### 2. 代码与文档收口（S / T 系列，保留位置 + 动作 + 风险）
| # | 条目（含位置） | 动作 / 风险 |
|---|---|---|
| **S7** | `docs/reports/CODE_REVIEW_REPORT.md` 勘误 banner 未覆盖三类过期：① 正文「118 case」（今 238 pass）②「scheduler 仍无单测」（今 13 条）③ 路径仍 `src/worker/*`（今 `worker/`）—— ③ 即全量文本审计的 T6 | ⛔ **不另立**：报告已于 2026-09-19 移出仓库归档（见顶部「📦 归档声明」），属历史快照，按「执行史不改」不回溯改 banner；其揭示的 3 处过期已在源文档（`README`/`product`/`architecture` 经 PR #38 对齐）与本台账以现行数字 / 路径为准 |
| **S8** | `.env.example` 未列 `HTTP_PROXY` / `HTTPS_PROXY`，而 `deepseek.ts` 刻意读它（绕 undici 不读代理的坑），README 扩展指南还专门写了一段 | ✅ **已处置**（2026-09-22 复核）：模板实测**已列** —— 见 `.env.example`「出网代理（可选）」段（`HTTP_PROXY=""` / `HTTPS_PROXY=""` + undici 注释），且该文件**未被修改**（HEAD 版本即有）。属**台账漂移**（源已改、台账未同步），与 S7 / ST3 /「30 引用」同族 |
| **S10** | `src/lib/scheduler.ts`（2026-09-20 晚因 P0-2 改动下移 36 行）失败任务 `errorMessage` 拼 `${err.message}\n${err.stack?.slice(0,500)}` → 落库 + 推 SSE → 前端可读到内部堆栈 | ✅ **已处置（方案 B）**：`scheduler.ts` 改 1 行 → `errorMessage` 只取 `err.message`；DB + SSE 两条前端路径同时堵住；完整堆栈仍由 `console.error` 落服务端日志。🔒 **回归锁已补**（2026-09-22）：`tests/scheduler.test.ts` 新增「回归锁：失败任务的 errorMessage 不得含内部堆栈」—— 反向断言堆栈帧与源码坐标，且落库与 SSE 同一份都查；**经变异测试验证**：把 `err.stack` 加回去该用例必红（补之前是 13/13 全绿、**无守卫**）。⚠️ **已落库的历史堆栈未清**（改代码只堵未来，历史数据需单独处理，**本次不处理，已记录待议**） |
| **T4** | 「80% 规则 / 20% AI」共 8 处（`product.md` ×6 + `architecture.md` ×2） | ✅ **已处置**：源文档实测已改写 (b) 版（无百分比，A4 / AUD-1 落地）；活文档侧 `rg '80%'` 应 0 命中 |
| **T5** | 「月 Token 可控 $200 内」（`product.md:101`、`architecture.md:157`） | ✅ **已处置**：源文档已删（A4 / AUD-1）；无测算支撑的金额承诺收益为负 |
| **T7** | 代码层无覆盖率工具（未装 `c8` / `nyc`，无 coverage script） | ✅ **已处置**（2026-09-22，用户批准 3a）：`c8` 已入 devDependencies + 新增 `coverage` script，**未动 CI**。盲区用 `npm run coverage` 量 —— **不写死百分比**（会漂移，见 §三 维护规则「写怎么量」）。⚠️ 附带发现：装后 `npm audit` 报 **3 个 high**，实为 **Prisma 依赖链自带**（`prisma`→`@prisma/config`→`deepmerge-ts <8.0.0`，栈耗尽 GHSA-ggr8-5vv4-36mx），**非 c8 引入**；修复需 `npm audit fix --force` 把 prisma 降到 6.12.0（**破坏性**）→ **未做，待议**（见下方新增条目 `CVE-自依赖`） |
| **T8** | E2E 证据是快照（09-17 一次运行） | **不另立待办** —— 已由红线「引擎大改后必须重跑全链路」（`DEVELOPING.md` §1）约束；仅登记性质，避免误当永久证明 |
| **ST3** | 两份审计报告（`TEXT-AUDIT-2026-09-17.md` + `STRUCTURE-AUDIT-2026-09-17.md`）无 markdown 链接指向，只被纯文本提及 | ⛔ **不另立**：两报告已于 2026-09-19 随 `docs/reports/` 移出仓库归档（见顶部「📦 归档声明」）；其独有内容（成本口径 / 复跑备案）已搬入 `docs/DEVELOPING.md` §1.1/§1.2，归档目录路径在台账 L7 已登记，不在仓库内维护链接 |
| **ST4** | `src/components/ui/card.tsx` 的 `CardHeader` / `CardFooter` / `CardTitle` / `CardDescription` / `CardContent` 全仓从未渲染（仅 `Card` 本体在用） | ⛔ **不删**（2026-09-22 定）：收益仅「未引用导出」24→19，代价是下次要用重新拉，**功能零影响**。若删属 `src/` 改动 → 须跑四道门禁，而 **build 在本地无法验真**（沙箱 safe-delete 守卫拦截 `.next` 清理，阈值 50 / 实际 233 个文件）。回头条件：真要做 UI 扩展、或集中清理未引用导出时 |

---

## 二、明确不做（won't fix + 回头条件）

| # | 条目 | 不做的理由 | 什么条件下回头 |
|---|---|---|---|
| **B1** | tsconfig `extends` 继承的 `paths` 读不到（`analyze-core.cjs:480 buildPathAliases`，代码里已自带注释承认） | 要解析 TS 配置继承链（`extends` 可指向 npm 包、可数组、可级联），成本远大于收益；两个被扫描的真实仓库都不吃 `extends` | 真要拿它扫 **monorepo** 时 |
| **B2** | barrel 文件自身被删时无法展开符号（`analyze.worker.cjs` 的 `originOf()` / `resolveExportOrigin` 穿透段；按 `grep -n "const originOf"` 定位） | 修法要把 base 侧已删文件并入可解析集 —— 动影响图核心数据结构，**有 B4 级回归风险**，而触发场景罕见 | 真碰到一次「删 barrel 静默漏报」的实例 → **先把样本加进「形态矩阵登记表」的 ❌ 区** |
| **E4** | README 常态化核对 | 这是**习惯**不是待办。挂在清单上只会永远显示「未完成」，且每次都要重新判断 | 若哪天希望自动化 → 做成一条 CI 检查（届时是独立决策） |
| **P2①** | 引擎被排除出 typecheck（`tsconfig.json:42`） | CJS + Babel AST 代码，开 TS 检查要大量 `any` 断言。**但代价是真实的**：引擎没有类型层保护 | 不需要回头 —— 替代措施是「样本集 + baseline 对比」双保险，属既定口径（见 `DEVELOPING.md`） |
| **P2②** | `noUncheckedIndexedAccess` 未开 | 开了数组下标全变 `T \| undefined` → **大面积改动换理论收益** | 大规模重构时顺带评估 |
| **①** | **同一仓库并发分析没串行化** —— `processTask` 全程共用 `.cache/repos/<repoId>`，而 `analyze.worker.cjs` 的 `checkoutHead` 就在它上面 `git checkout --force` | **非阻塞**。单次使用（触发一次分析 → 看报告）碰不到；只有**同一仓库 ≥2 个任务在分析窗口内重叠**时才触发，表现分两层：**响的**是 `persistSymbolTable` 的唯一约束报错 → 任务标红 `failed`（重试即可，且分析其实已经成功）；**不响的**是后一个任务的 `checkout` 换掉了前一个的工作区 → 前者可能读到**对方的代码树**，安静产出一份错位报告。修它要动 `scheduler.ts` 的认领逻辑或新增 repo 锁，**而并发场景难以稳定复现与断言** → 回归风险高于收益 | 要**多实例 / 高并发接入真实仓库**（同一仓库频繁突发触发）时。候选修法：给「workdir 使用 + 落库」整段加按 `repoId` 的串行化（进程内 mutex / advisory lock），或把 `createMany` 换 `upsert` 语义（`ON CONFLICT DO UPDATE`） |
| **②** | **Monaco 未真正本地打包，仍依赖 `cdn.jsdelivr.net`** —— `next.config.ts` 的 `webpack:` 钩子在 Turbopack 下不执行，而 dev 与 `next build` 都跑 Turbopack | **非阻塞**。有网时能正常渲染（实测约 20s），只是慢；**离线 / 内网部署**下「代码 Diff」块会一直停在 `Loading...`。另：CDN 拉的是 0.55.1，与 `package.json` 固定的 0.52.2 不同版本。**不修的理由**：报告主体（风险总览 / 影响链路 / 安全门禁 / 变更符号明细）全部不依赖它，受影响的只有 Diff 这一块的可用性；两处注释已改为如实描述 | 需要**离线 / 内网演示或部署**时（按 `loader.config({ monaco })` 或自托管 `public/monaco/vs` 修，并补产物级断言：构建产物中不得出现 `cdn.jsdelivr.net`） |
| **P2③** | `Feedback` 表（原「只有读无写 → 标预留」） | ✅ **已取代**：PR #23（`20260917054609_remove_feedback` 迁移）已 `DROP TABLE "feedbacks"`；`schema.prisma` 实测 **4 个 model**（Repository / Task / FileSnapshot / ExportSymbol），**无 Feedback**（U1 确认）。原 09-16「不删表、标预留」决定被两天后删表迁移推翻，前提不再成立 | —— 回头条件撤销 |

> 📌 **口径自纠**：① 描述成「`persistSymbolTable` 唯一约束竞态」写窄了（只写了"响的那一半"）。**以本表 ① 行为准**：真正需要串行化的是「workdir 使用 + 落库」整段。
> 📌 **LLM 抖动（该知情，非缺陷）**：`uncertain` 变更交 DeepSeek 判定后，**同一输入两次运行 severity 可能不同**（置信度只能是 `heuristic` / `uncertain`，LLM 固有抖动，非规则引擎缺陷）；首页高危 / 中危计数会在两次运行间变化，值得在已知边界里写明。

**已执行的 P2 项**：
- **P2⑥** `.cache/`（62M，已 gitignore）→ **已删除**。它不是待办，是「想省磁盘就删，会自动重建」。
- **P2③** 见上（已被 remove_feedback 迁移取代）。

---

## 三、维护规则

1. **状态一变就改这份文件**，不要留在对话里。
2. 新增条目必须写清**代码位置**（可 grep 到）与**为什么现在要做 / 不做**。
3. `won't fix` 不是「以后做」的委婉说法。若哪天要回头，先确认「回头条件」是否真的发生了。
4. 别把「习惯」（如 E4）写成待办 —— 它永远不会变成已完成。

### 审计纪律（从历次审计提炼，防止重犯）
- **凡「搜不到 / 0 命中」必须换第二种手段交叉验证**（沙箱 `grep` 是 toybox，BRE 交替 / `{n,m}` 静默返回 0 匹配 → 假阴性；本轮曾触发 3 次，均改 ripgrep 推翻）。
- **改任何说法前，先搜全仓该说法所有出现处；要么全改，要么一处不改**（AUD-19：同一行有两个数只删一个 = 用一个虚构换另一个虚构）。
- **加 / 删行后必须重算该文件之后的 `file:line`**（AUD-20）；治本：不写死行号，写标识符（`const workerPath`）或 `grep -rn` 命令。
- **写「怎么量」而非「量出来多少」**（U1 / U3：删表让「5 张表」过期；权威源只有 `schema.prisma` 的 `model` 列表，`migrations/` 是历史，按关键词 grep 必自相矛盾）。
- **判「不可验证」前先问它依赖的是「厂商」还是「协议」** —— 依赖协议 → 造假服务即可验真，无需真账号（AUD-3：GitLab 回写用假服务跑通 L3）。
- **红线「致命缺陷全在少报方向」** → 凡是「静默降级 / 0 条 / 未产出」都要显式提示，不能靠缺块暗示（AUD-14 / U8 / U9）。
- **「✅ 已修」标记本身也要验证**：修复若用「精确短语 grep + 替换」，天然漏掉换了措辞的同类（S4 / T1 / T2 同族）。复审抽掉修饰词、用核心数字全仓重扫。
