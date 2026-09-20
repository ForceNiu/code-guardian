# 审计待办台账（Audit Backlog）

> **这份文件存在的唯一理由**：审计清单原本「没有家」——它先后住在一份不入库的交接文档里、
> 以及每次新对话的上下文里。结果是**每开一次新对话就要把整份清单重新判断一遍**（实测重复发生过 3 次，
> 其中一次还推出了一个错误的条目数）。
> 所以：**任何状态变更都就地改这份文件**，而不是留在对话里。
>
> 来源：2026-09-16 全项目审查（25 条）+ 同日新查出的 2 条静默漏报（原清单没有）。
> 口径：审计清单的职责是「**不漏**」，排序是另一件事 —— 所以下面只有三态：做 / 不做（附理由）/ 待定。

> 📦 **归档声明（2026-09-19）**：原 `docs/reports/` 下 5 份复跑/审查报告（`CODE_REVIEW_REPORT` / `E2E-VERIFICATION-2026-09-16` /
> `E2E-RERUN-2026-09-17` / `STRUCTURE-AUDIT-2026-09-17` / `TEXT-AUDIT-2026-09-17`）+ `docs/frontend-redesign.md`
> **已移出本仓库**，归档在仓库外 `学习笔记/code-guardian/历史报告-移出/`。
> 本台账中凡指向 `docs/reports/*.md` 的链接均指向该归档目录（其中 `E2E-RERUN-2026-09-19.md` 此前从未入库）。
> 独有内容（成本口径、复跑「看起来异常实际正常」备案）已搬入 `docs/DEVELOPING.md` §1.1 / §1.2。

---

## 图例

| 符号 | 含义 |
|---|---|
| ✅ | 已完成（附证据位置） |
| 🔜 | 待做（按顺序执行） |
| ⛔ | **明确不做**（`won't fix`）—— 必须写理由 + 「什么条件下回头」 |
| ❓ | 待定（缺前置条件，不是缺决定） |

---

## 一、✅ 已完成

### 2026-09-16 第一批（PR #16 · squash merge · main = `db04dd7`）

| # | 条目 |
|---|---|
| A1 | 提交 → push → PR → CI 绿 → squash merge |
| A2 | 全链路 R1–R4 四轮跑完并留证（`docs/reports/E2E-VERIFICATION-2026-09-16.md`） |
| B4 | 跨写法变更被静默丢弃（`export function f(a)` → `export const f = (a) =>`） |
| E1 / E2 / E5 | README 漂移订正 / `.env.example` 补 `GITLAB_TOKEN` / 全项目审查 P0+P1 |

### 2026-09-16 第二批（分支 `fix/audit-tier1-3`）

| # | 条目 | 关键点 |
|---|---|---|
| **A3** | 签名定级缺口 | `rules.cjs` 的 `isFunctionLike` 改 **OR 式**（替换式会误伤 2 条既有断言） |
| **B3** | 已知缺陷样本集补全 | 12 条新断言（8 必须检出 + 4 防过度修复）+ 文件末尾「形态矩阵登记表」 |
| **D5** | 写端点鉴权 | 双端点 fail-closed（`MANUAL_TRIGGER_TOKEN` / `WEBHOOK_SECRET` 未配即拒绝）；已端到端实测四组请求 |
| **D1 / D2 / D3 / D6** | 打磨四项 | 死属性 `asChild` / Hero 三卡改用 API 计数 / `turbopack.root` / 删约 510 行死 CSS |
| **R4-F2** | `confidence` 语义稀释 | AI 的 `confidence` 收窄为 `heuristic \| uncertain`；`proven` 归规则引擎专属 |
| **E3** | 交接文档归宿 | `HANDOVER.md` → `docs/DEVELOPING.md`（只留红线 / 方法论 / 文件地图） |
| **N1** | **本轮新查出**：HOC 包裹漏报 | `export default memo(X)` / `forwardRef(X)` / 多层柯里化 → 内层签名变化曾 **0 变更** |
| **N2** | **本轮新查出**：别名导出漏报 | `export { C as default }` 指向的本地函数签名变化曾 **0 变更** |

### 2026-09-16 第三批（同上分支，未提交）

| # | 条目 | 关键点 |
|---|---|---|
| **C7** | 测试缺口第 1 条 | `security/index.ts` 的「失败不阻断主链路」6 条断言；**同时打通了后续所有 C 类模块要用的「模块 mock」范式**（见 §二.1） |
| **C4** | 测试缺口第 2 条 | `run-analysis.ts` 的 8 条断言（三条 settle 路径 / 超时 terminate / 超时不重复结算 / exit 0 无结果）；**顺带查出并修掉 N3** |
| **N3** | **写 C4 时新查出**：`exit 0` 未回传结果 → Promise **永不 settle** | `run-analysis.ts` 原来在 exit 分支只处理 `code !== 0`。退出码 0 但从未 `postMessage` 时**既不 resolve 也不 reject** → scheduler 的 `processTask(...).finally(() => running--)` 永不执行 → **并发槽位永久泄漏**，累积 3 次（`MAX_CONCURRENT`）后调度器彻底不再处理任何任务。比"报错"更坏：无日志、无失败态、进程看着正常。**已修**（exit 0 也 reject，带明确文案） |
| **P2③** | `Feedback` 表只有读无写 | 在 `docs/architecture.md` 的表清单里如实标注为「**预留**」 |
| **P2⑥** | `.cache/` 62M | **已删除**（会自动重建） |
| — | 测试基础设施 | `package.json` 的 `test` 脚本加 `--experimental-test-module-mocks`（CI 走 `npm test`，自动生效，无需改 workflow） |

### 2026-09-16 第四批（分支 `test/c-class-remaining` · PR #18 · squash merge · **main = `2e9b9ee2`**）

| # | 条目 | 关键点 |
|---|---|---|
| **C2** | `src/lib/persist.ts` | 10 条：事务内调用顺序、空表不进事务、3 条防御性解析（快照字段缺失/类型错乱时不炸） |
| **C3** | `src/lib/enqueue.ts` | 10 条：`deriveName` 边界、SSE publish、duplicate 不广播、缺省字段按 `??` 口径落库 |
| **C6** | `src/lib/ai/deepseek.ts` | 15 条：mock `node:https`/`node:http` 两条出网通路（代理 CONNECT / 直连）+ 请求形状 + 消息转换 + 限流退避 |
| **C5** | `worker/analyze.worker.cjs` | 8 条：**真实 git 仓库 + 真 Worker 线程**的集成测试（这层不能 mock，见 C5 验收证据） |
| **C1** | `src/lib/scheduler.ts` | 13 条（7 个 fake）：启停 / 卡死回收 / 原子认领 / 并发上限 / **两道 `ctrl.cancelled` 守卫**（各自可独立证伪） |
| — | 收口上一批的事故 | 删掉 `deepseek` / `scheduler` 两个无效测试；还原被砍坏的 `scheduler.ts` / `persist.ts`（与 main 一致） |

- 测试规模 **181 → 237 pass**；四道门禁（lint / typecheck / test / build）全绿；**`src/` 零改动**（只加测试 + 台账）。
- PR **#18**（https://github.com/ForceNiu/code-guardian/pull/18）2026-09-16 23:53 UTC squash merge，
  合并后 main = `2e9b9ee2`；`merge_commit_sha` 已用 `verification.payload + gpgsig` **逐字节复现并同步到本地**。
- ⚠️ 分支 `test/c-class-remaining`（head `3a75225`）在 squash 后**已「死」**（按约定保留未删）；
  后续改动一律从 main 开新分支。

---

### 2026-09-17 第五批 · 全项目结构审计（叠在 `chore/backlog-sync-e2e-rerun` 之上 · PR **#20** squash merge · **main = `3f804d43`**）

**审计方法**（可复现）：脚本解析**真实 import 语句 + 用 `fs.existsSync` 解析路径**，覆盖 86 个入库文件 + 磁盘上未入库文件，两套独立脚本交叉验证。
> ⚠️ 方法红线：**不能拿子串匹配判「有没有被引用」** —— `input.tsx` 会匹配到任意 `input`，注释/fixture 里的 `./x` `./barrel` `./real` 会被当成真导入。初版就是这么误报 16 条「失效导入」的，逐条核过全是误判。

**全过项（先说没问题的）**：相对 / `@/` 导入 **0 条失效**；`tests/` 17 个文件**全部**被 `npm test` 的 glob 命中（无静默漏跑）；`tsconfig` / `eslint.config.mjs` / `ci.yml` / `docker-compose.yml` / `next.config.ts` 引用的每个路径都真实存在；23 条「导出但无人用」全是 type-only 或 `ui/` 组件库常规冗余，**不是死代码**；未入库文件全在预期内（`.cache/` `fixtures/` `e2e-logs/` `.env` `next-env.d.ts`），**无「该入库却漏掉」**。

| # | 发现（含代码位置） | 处理 |
|---|---|---|
| **S1** | 全仓 18 条 markdown 本地链接里**唯一失效**：`docs/reports/E2E-VERIFICATION-2026-09-16.md:7` 写 `](DEVELOPING.md)`，该文件在 `docs/reports/` 下 → 应 `](../DEVELOPING.md)`。**是同类事故（`README.md:169` 漏改）的残留** | ✅ 已修 |
| **S2** | README 扩展指南 §3 写「`adaptWebhook` 的 **switch** 挂上」，实为**三元链**（`src/lib/webhook-adapters.ts` 的 `adaptWebhook`，2026-09-20 现位于 `:176-181` —— 原引 `:174-179`，因上方注释增 2 行而下移） | ✅ 已修 |
| **S3** | `src/worker/` 是**混合生命周期目录**（边界只靠 `tsconfig.exclude` + 一行注释维持，目录本身看不出） | ✅ 已修（重构，见下） |
| **S4** | **文档数字互相矛盾且与代码不符**：`architecture.md:79,155` + `product.md:53,110` 写「27 条查表规则」，README 写「25 条 + `unknown` 兜底」。实测 `RULE_TABLE` = **25 条具名 + `unknown`**（函数 10 / 字段 8 / enum 2 / class 5） | ✅ 已修（四处统一为「25 条 + 兜底」） |
| **S5** | `docs/DEVELOPING.md` 文件地图两处过期：`scheduler.ts` 标「⚠️ 零单测」（实际 **13 条**，含 7 个 fake）、`tests/` 写「10 个文件」（实际 **17 个**） | ✅ 已修 |

**S3 重构细节（本次唯一的结构性改动）**

| 前 | 后 | 理由 |
|---|---|---|
| `src/worker/analyze-core.cjs`、`rules.cjs`、`analyze.worker.cjs` | **`worker/`（仓库顶层）** | 这三个不进 Next bundle、不参与 tsc，放在 `src/` 里靠 exclude 维持，边界不可见 |
| `src/worker/run-analysis.ts` | **`src/lib/run-analysis.ts`** | 它**会**被 Next 打包（`scheduler.ts` import 它），本质是 `lib`；放在 `worker/` 只会强化误解 |

- 搬迁前置核过：3 个 `.cjs` 内部只有相对 `require("./analyze-core.cjs")` / `require("./rules.cjs")`，**无 `__dirname` 依赖** → 整体移出 `src/` 不破坏内部引用。
- 🔴 **同步点共 9 处**（改漏任何一处都是「运行时才挂」或「静默用旧路径」）：`src/lib/run-analysis.ts:23`（运行时字符串）、`scripts/scan-repo.cjs:38`（同上）、`tsconfig.json:42`（exclude）、`src/lib/scheduler.ts:4`、`tests/analyze-worker.test.cjs:20`、`tests/analyze-core.test.cjs:16,698`、`tests/rules.test.cjs:14`、`tests/run-analysis.test.ts:73,93`、`tests/scheduler.test.ts:152`。
- 🔴 **本次差点改漏的那一处**：`src/lib/scheduler.ts:4` 用的是**别名 `@/worker/run-analysis`** —— 它**不含 `src/worker` 字样**，`grep "src/worker"` 扫不到。**扫搬迁残留必须同时扫别名形式**（`@/worker`、`"worker/`），或直接跑 typecheck。
- ✅ 已把同步点写进 `docs/DEVELOPING.md` 文件地图（原来只靠源码注释），并标注「改路径 / 改目录名**不会有任何编译期报错**」。

---

### 2026-09-17 第六批 · 全量文本正确性审计（已提交至 `docs/g1-kickoff`，**未推送**）

**动因**：G1 开工说明书（`docs/G1-KICKOFF.md`）先做过一次「每个说法回原始出处核」的校验，25 项查出 4 个硬错。
用户据此要求把同一颗粒度铺到**全部文本文件**。经讨论确定 **手段必须按对象分派，不是同一种手段铺满**：

| 批次 | 对象 | 手段 | 结果 |
|---|---|---|---|
| A | 全部 10 份 `.md`（2,499 行） | 只读脚本：路径 / `file:NN` / 数字 / 引文 / `§引用` | — |
| B | 活文档 5 份（928 行） | 人工逐条回源核 | **3 硬错** |
| C | 历史报告 3 份（1,070 行） | **只读**核勘误 banner 覆盖度 | 1 注意项 |
| D | 代码 59 文件（10,355 行） | 脚本：注释 vs 常量 / 覆盖映射 | 0 错 |
| E | 配置与脚本 | 写死路径与交叉一致性 | 0 错 |

> **为什么代码不用人工核**：代码的正确性已有**更强**的机器手段（typecheck 编译期证明 / 238 单测行为证明 / 四道门禁 / E2E 复跑），
> 人工逐条读代码是**用弱手段替代强手段**。**历史报告只读** —— 改正文 = 篡改证据（同 §二 的既有原则）。

**全过项（19 项，先说没问题的）**：代码位置引用 `file.ts:NN` **37 处全部有效**（文件存在 + 行号未越界）；
`§` 章节引用 **58 处、0 处指向不存在的章节**；README「关键阈值」表 **8 项全对** / 「能力↔文件」表 **12 项全有效** /
「环境变量」表与 `.env.example` **5/5 对上**；`product.md` 规则分类明细 10+8+2+5 = **25 精确**；
**`product.md` 的「30 条漏洞（high 14 / moderate 15 / low 1）+ 1.69MB」与本地 e2e 实据 `result-R4.json` 逐字一致**；
prisma 5 表 / LangGraph 4 节点（名称与顺序都对）/ `DEVELOPING` 的「13 条单测含 7 个 fake」「同步点 4 处」「2 个 LLM 节点」全部命中；
`src/` 6 条带注释的数字常量**全部自洽**；`ci.yml` 四步 ↔ `package.json` scripts、`docker-compose` ↔ README 连接串**逐字一致**；
`frontend-redesign.md` 声称的 9 个文件全部存在；`.env.example` 未被误忽略。

| # | 发现（含位置） | 处理 |
|---|---|---|
| **T1** | `architecture.md:147` 里程碑表仍写「**27 条** AST 硬规则」，实测 `RULE_TABLE` = **25 具名 + `unknown`** | ✅ 已修 |
| **T2** | `product.md:127` 路线图表仍写「**27 条**确定性规则」 | ✅ 已修 |
| **T3** | `product.md:112` 技术指标写「单元测试 **103 个**，全绿」，实测 **238 pass** | ✅ 已修（并改成「此数随开发增长，用前复测」） |
| **T4** | 「80% 规则 / 20% AI」**共 8 处**（`product.md` ×6 · `architecture.md` ×2）**无任何测算出处** | 🔜 见 §二.8 |
| **T5** | 「月 Token 可控在 $200 内」（`product.md:101`、`architecture.md:157`）无任何测算出处 | 🔜 见 §二.8 |
| **T6** | `CODE_REVIEW_REPORT.md` 勘误 banner **缺一句「路径已搬迁」提示**（正文仍写 `src/worker/*`） | 🔜 **并入 §二.6 的 S7**（同一件事的另一半，不另立条目） |
| **T7** | 代码层**无覆盖率工具**（未装 `c8`/`nyc`，无 coverage script） | 🔜 见 §二.9 |
| **T8** | 代码层 E2E 证据是**快照**（09-17 那一次运行） | 已由「引擎大改后必须重跑全链路」红线约束（`DEVELOPING.md` §1），**不另立待办** |

**🔴 T1/T2 是怎么漏出来的（比错本身更值钱）**

台账 **S4** 当初记的是「✅ 已修（**四处**统一为『25 条 + 兜底』）」，但实测**有 6 处** —— 漏掉的 2 处写的是同义的**另一种措辞**
（S4 按精确短语 `27 条查表规则` 替换，而漏掉的两处写的是 `27 条 AST 硬规则` / `27 条确定性规则`）。

→ **元教训：「✅ 已修」标记本身也需要被验证。** 修复若用「精确短语 grep + 替换」完成，天然漏掉换了措辞的同类。
**复审的正确做法：抽掉修饰词、只用核心数字（如 `27`）全仓重扫**，而不是复跑当初那条 grep。
（本轮就是这么做的：`27` 全仓扫只命中 2 处真错 + 2 处"在描述这个错误"的文本；`103` 同理只有 1 处。）

> ⚠️ **S4 那行不改**：台账是执行史，「当初做了什么」不应被追改。该行的偏差由本批次记录在案。

---

### 2026-09-17 第七批 · 全量结构审计重跑（已提交至 `docs/g1-kickoff`，**未推送**）

**动因**：用户要求「不放过任何文件」再核一遍。第五批已覆盖 86 文件；本轮**换更强口径** ——
多加一步「**磁盘文件 × git 清单逐字节差集**」，专门追问一句「**扫描面本身有没有洞**」。

**方法**：① 三层归属（跟踪 87 / 忽略 8 类 / 未跟踪 2 —— 两份报告自身）→ ② 引用完整性脚本（解析真实 import + `fs.existsSync` 解析路径）
→ ③ **复刻脚本的 walk 排除逻辑与 git 清单求差**（本轮新增步骤，`ST1` 即由此逮到）。
→ 报告：`docs/reports/STRUCTURE-AUDIT-2026-09-17.md`（编号用 **`ST`** 前缀，已避开在用的 `S1`–`S10`）

**全过项（先说没问题的）**：① 解析不到的 import **0 条**；④ md 本地链接 **18 条、失效 0 条**；
② 3 个「无 import 引用」文件 —— `worker/analyze.worker.cjs`（运行时字符串）/ `scripts/scan-repo.cjs`（npm script）/
`docs/demo-ai-uncertain/build-report.mjs`（手动执行）—— **全部有入口解释，0 个真死文件**；
（📌 第三条于 **2026-09-18 该目录整体移出本仓库**，见 §二.17 —— 本行是第七批**当时**的记录，保留不动）
③ 24 条未引用导出 = **16 条 type-only + 3 条同文件内用/已被文档点为扩展点 + 5 条见 ST4**；
未跟踪 2 个（两份审计报告自身）；忽略 8 类**逐条可解释**；**无 0 行 / 占位 / stub 文件**。

| # | 发现（含位置） | 处理 |
|---|---|---|
| **ST1** | 🔴 审计脚本的 walk **跳过一切点开头目录** → **`.github/workflows/ci.yml` 静默逃出扫描面**（脚本报「扫描 90 个文件」，磁盘上是 91；它是全仓**唯一**位于点目录下的跟踪文件） | ✅ 已修脚本（放行 `.github`）；修后重跑 = **91**（本报告写入后为 **92** —— 自指，详见报告附录） |
| **ST2** | 🟡 「孤儿文档」判定**只看 markdown 链接** → `docs/G1-KICKOFF.md` 被误报为孤儿（实际被 3 处以纯文本提及：本台账 / `docs/DEVELOPING.md` / 第六批报告） | ✅ 已修脚本（增列 basename 提及处） |
| **ST3** | `docs/reports/TEXT-AUDIT-2026-09-17.md` **全仓零提及 → 真孤儿** | 🔜 见 §二.10 |
| **ST4** | `src/components/ui/card.tsx` 的 **5 个子组件从未被渲染**（`CardHeader`/`CardFooter`/`CardTitle`/`CardDescription`/`CardContent`；只有 `Card` 本体被 `src/app/page.tsx` 用） | 🔜 见 §二.10 |

**🔴 本批最值钱的一条（关于工具自身，不是关于被审对象）**：`ST1` / `ST2` **都不是仓库的毛病，是审计工具的毛病**。
若只跑脚本、照抄它的输出，`90` 这个数字会被当成事实，而 `.github/workflows/ci.yml` **会永远不在任何自动检查的覆盖范围内**。
→ 已写进技能 `repo-structure-audit` 的「其他硬坑」，并给出一条通用判据：
**「扫描 N 个文件」这个数字必须等于磁盘上的文件数（扣除预期排除项），不等就说明有目录被静默吞掉。**
→ `ST4` 另有旁证：**产品自己的引擎早就报过同一件事** —— 本地 E2E 产物 `docs/reports/e2e-logs/scan-R0-codeguardian-OLDWINDOW.log`
里有两行 `card.tsx#CardHeader | added | proven | 引用 0`。自研引擎与外部审计在同一结论上对上了。

---

### 2026-09-18 第八批 · G1 说明书重做前的代码核实（编号前缀 **`U`**，已避开在用的 `A/B/C/D/E/F/G/M/N/P/R/S/ST/T`）

**动因**：用户要一份「完整、真实、按已实现功能」的项目说明书，且要求**不直接生成、先回代码核实**。
于是对 README / `product.md` 声称的全部功能，**逐项回真实代码核一遍**（颗粒度：确认「怎么做的」+ 报出真实参数）。

**方法**：按 README「能力 ↔ 文件」表给出的位置，逐个文件 grep 取真实常量与分支。本批**只核文档声称的能力**，
不是全量代码审计（全覆盖靠第六/七批）。

**已核实且与文档一致（证据留存，后面要复述这些数就照这里抄）**

| 能力 | 真实位置 | 真实值 |
|---|---|---|
| 三源接入 | `src/lib/webhook-adapters.ts:10,29-32` | `gitlab-mr` / `github-push` / `github-pr`，靠 `x-gitlab-event` / `x-github-event` 请求头区分 |
| 幂等防重 | `prisma/schema.prisma:59` | 唯一索引 `[repoId, mrId, commitSha]` |
| 规则引擎 | `worker/rules.cjs:222-252` | **25 条具名 + `unknown` 兜底**（函数 10 / 字段 8 / enum 2 / class 5）；**仅 2 条 `heuristic`、仅 `unknown` 是 `uncertain`** |
| AI 管线 | `src/lib/ai/semantic-graph.ts:230-239` | 4 节点 `restate → retrieve → predict → suggest`；**仅 `predict`/`suggest` 调 LLM**（每任务固定 2 次调用） |
| 调度 | `src/lib/scheduler.ts:11-13` | 并发 **3** / 轮询 **5000ms** / 硬超时 **300000ms** |
| 体积门禁 | `src/lib/security/bundle-size.ts:9,83` | **100MB**；**只查顶层直接依赖** |
| 漏洞扫描 | `src/lib/security/cve-scan.ts:4,11,79` | 官方端点 `registry.npmjs.org/-/npm/v1/security/advisories/bulk`；提交**完整依赖树** + `isDirect` 标记 |
| 增量缓存 | `src/lib/persist.ts:55,81` | 按文件内容 hash 存取 |
| 影响链路 | `worker/analyze-core.cjs:437,488,557` | 只追相对引用 + **别名解析** + 循环引用保护 |
| 报告页 | `src/app/tasks/[id]/page.tsx:295-367` + 4 组件 | RiskSummary / StatusSteps / ImpactTable / DiffViewer 真实存在 |

> 💡 顺带挖到一个**真实亮点**（代码注释里的实测，不是估算）：`analyze-core.cjs:557` 注释写明
> 「只认相对路径会让影响图漏掉绝大多数引用，**实测 interview-forge 可见率仅 7.7%**」—— 别名解析把可见率从 7.7% 拉了上来。
> 这是本项目少数带实测数据的自我说明，写说明书时优先引用这类。

| # | 发现（含位置） | 处理 |
|---|---|---|
| **U1** | 🔴 **`docs/architecture.md` 仍写「5 张表」并列 `feedbacks`，实际是 4 张表** —— 共 **4 处**：`:36`（架构图块）/ `:47`（目录树注释）/ `:91`（§4 标题）/ `:99`（`feedbacks` 表行）。代码侧铁证：`prisma/schema.prisma` 全文无 `Feedback`，`model` 只有 Repository / Task / FileSnapshot / ExportSymbol **4 个**；迁移 `prisma/migrations/20260917054609_remove_feedback/migration.sql` 明写 `DROP TABLE "feedbacks"` | ✅ **已修**（4 处全改，§4 末尾补一段说明 + 「用前复测」命令） |

**🔴 U1 的性质（比错本身更值钱）—— 它不是「审计漏错」，是「后发改动让结论过期」**

时间线（`git log` 实测，不是推测）：

| 时刻 | 事件 |
|---|---|
| 09-17 **12:08** | PR `#22`（`c1c6185`）入库 —— 含第六批文本审计报告，其中第 39 行判「prisma 模型数 **5 张表** ✅（含 Feedback）」 |
| 09-17 **14:07** | PR `#23`（`f61a367`）入库 —— **`remove_feedback` 迁移删表**（`DROP TABLE "feedbacks"`） |

→ 第六批审计**在它自己的时刻是对的**，是两小时后的删表让它过期。所以 **`architecture.md` 是唯一该改的**（它最后改动停在 12:08），
而 **TEXT-AUDIT 报告与台账 §一 第六批全过项（第 127 行「prisma 5 表」）都不应追改**（历史件，改了就是篡改证据；S4 那行也是同理）。

由此得到两条判据（已按此执行）：

1. **「数出来的结论」在文档里必须写成「怎么量」，不能写「量出来多少」。** 本条若只改数字，下次任何 schema 变更会让它**再次过期且无任何机器报错**。
   → 已在 `architecture.md` §4 落一句 `git grep -n "^model " prisma/schema.prisma` 的自测命令。
2. **核「表还在不在」时，权威源有且只有一个 = `schema.prisma` 的 `model` 列表。** `prisma/migrations/` 是**历史**：
   全仓 grep `feedback` 会同时命中 `20260902131530_init` 的 `CREATE TABLE "feedbacks"` 与 `20260917054609_remove_feedback` 的 `DROP TABLE`
   —— **两条都在，按关键词 grep 必然得出自相矛盾的结论。**（本批差点被这个骗过去。）

---

### 2026-09-19 第九批 · 四条产品级缺口落地（U5 / U8 / U9 / U10）+ U11 登记

> 来源：2026-09-18 教学第 0 / 4 阶登记（§二.12 / §二.15 / §二.16），2026-09-19 用户拍板「全部进行修改」后落地。
> 四条的共性：**都不是「算错了」，而是「少算了却看不出来」或「没说清」** —— 与项目红线「致命缺陷全在少报方向」同向。

| # | 缺口 | 落地的改动（真实文件） | 验证方式（双向可复现） |
|---|---|---|---|
| **U5** | 解析失败不区分原因 | `worker/analyze-core.cjs` 新增 `classifyParseError()`（`syntax` / `unsupported` / `empty`）；`parseFile` 返回体加 `parseError`；`resolveFileSymbols` 透传；`worker/analyze.worker.cjs` 循环内累计 `parseFailures` 进 `summary`；`src/lib/types.ts` 加 `summary.parseFailures`；报告页顶部按原因出警示块 | 三种文件同时跑 → `parseFailures: {syntax:1, unsupported:1, empty:1}` |
| **U8** | 体积检测静默低估 | `src/lib/security/bundle-size.ts` 统计 `queriedCount` / `failedCount` / `incomplete`；`types.ts` 同步；报告页体积块在 `incomplete` 时出「查询 N / 失败 M」提示 | 构造 2 个包、1 个查询失败 → `queriedCount 2 / failedCount 1 / incomplete True` |
| **U9** | 「查失败」在报告页不可见 | `src/lib/security/index.ts` 无论成败都写 `result.securityStatus = { vulnerabilities, bundleSize }`（`ok` / `failed` / `skipped`）；报告页安全卡片条件由 `{r.vulnerabilities && …}` 改为 `{r.vulnerabilities \|\| r.bundleSize \|\| r.securityStatus}` 并加失败警示块 | 非 npm 项目 → `skipped`；正常项目 → `{bundleSize:"ok", vulnerabilities:"ok"}` |
| **U10** | 引擎只看对外接口，**全仓未声明** | 报告页影响链路上方加边界警示块（「0 条 ≠ 没影响」）；`docs/product.md` 新增 **§10 已知边界**（10.1 接口轴 / 10.2 解析失败分类 / 10.3 安全门禁 `ok`-`failed`-`skipped`）；`README.md` 新增「已知边界（判读报告时必读）」表 | 三处均可用 `grep -rn "已知边界" README.md docs/product.md` 命中 |
| **U11** | 非 ASCII 路径变更被**静默丢弃**（2026-09-19 复跑发现；此前**只存在于未入库的复跑报告里**，台账无条目） | `worker/analyze.worker.cjs` 的 `git()` 加 `-c core.quotepath=false`（一行） | 中文路径 fixture：`changedFiles` **1 → 3**；撤掉该参数则退回 1 |

- ✅ 四道门禁全绿：`lint` / `typecheck` / `test` / `build`（单测 **244 pass / 0 fail**，此数随开发增长，**用前复测**）。
- ✅ 单测同步更新：`tests/analyze-core.test.cjs` 的 `parseFile` 用例改为验证三类分类（原断言只看 `{exports,imports,reexports}`，已过期）。
- 📌 **同源后续**：**U6 / U7 已于本会话落地**（见 §二.13 / §二.14 的 ✅ 标注）—— U6(a) 卡片标注「全仓依赖体检（与本次改动无关）」、U6(b/c) 新增 `detectChangedDeps` 比对 base/head 的 package.json 并给新增依赖打「新增」徽标；U7(a) 表头「影响范围」→「中招版本」并改写导语、U7(b) `isDev` 标记让 devDependencies 在漏洞表标「（dev）」。**U4(a)(b)**（覆盖范围声明 + 装饰器插件）仍**未做，仅规划**，见 §二.12。

> ⚠️ 本批的元教训（与 U2 那条同族）：**U11 已经在代码注释和复跑报告里写了，但没进台账**
> → 差点出现「报告说修了、台账查不到」的断链。判据：**发现即登记，不等到修完**。

---

## 二、🔜 待做（按执行顺序）

### 待做收敛版（2026-09-20 重梳 · 新编号）

> 依据「少报最危险」红线 + 成本收益 + 是否引入 churn 重新判定。旧 §二.0–§二.18 的逐条明细保留为执行史，以本节新编号为准。
> 目标：把悬而未决的清单收敛成「4 条真做 + 其余关闭/延后」，项目进入稳定态。
> **定位定调**：本工具为 **TS/JS 栈影响链路分析**（不含 .vue），该范围须显式声明（见 A1）；不为验证项目过度扩到跨语言。

#### A 组 · ✅ 已~~全部~~实现并合并（分支 `fix/ast-scope-decorators-docs` · PR **#26** · squash merge · **main = `1d54335`** · 2026-09-20）

> ⚠️ **2026-09-20 晚更正**：原标题写「已**全部**实现」，但 A4 的落点**只列了 `product.md` + `architecture.md`**，
> 漏了 `README.md:19` 与代码注释 `src/lib/ai/semantic-graph.ts:2` —— 同一条口径**换了措辞**就逃出搜捕网
> （A4 搜的是「`80% 规则 / 20% AI`」，README 写的是「约 80% 的变更**不送 AI**」）。
> **这是台账自己写过两遍的教训（§一 第六批 S4 `:151` / 第八批 U1 `:792`）第三次没执行。** 已随本轮补齐，见 **AUD-1**。A1–A3 的结论不受影响。

| 新号 | 事项 | 落点 |
|---|---|---|
| A1 | 声明解析器范围 = **TS/JS only，不含 .vue** | `README.md` 已知边界表 + 导语 |
| A2 | 加 `decorators-legacy` | `worker/analyze-core.cjs` |
| A3 | `.env.example` 补 `HTTP_PROXY`/`HTTPS_PROXY` | `.env.example` |
| A4 | 删/改无出处百分比（"80%/20%"、"月 $200"） | ~~`docs/product.md` + `docs/architecture.md`~~ → **2026-09-20 晚补漏：＋ `README.md:19` ＋ `src/lib/ai/semantic-graph.ts:2`**（见 AUD-1） |

#### B 组 · 已关闭并移出待办（2026-09-20）
> 9 项关闭：S7/ST3 目标文件已归档失效；D4/S10/T7/ST4/U7(c)(d) 判 won't-fix；§二.18 未验项归入下轮 E2E；B1/B2/E4/P2①/P2② 维持 won't-fix。**理由保留在各自原条目（§二.x / §三），此处不再逐条占位。**

#### C 组 · ✅ 已处置（2026-09-20）
| 新号 | 原 ID | 处置 |
|---|---|---|
| C1 | §四.1 GitLab Commit Status 回写验证 | ~~✅ 关闭为「外部依赖，当前环境不可验」（缺 token + 真实项目，非代码缺陷）~~ → **2026-09-20 晚更正为「已验（L3）」**：仓库外 `E2E-RERUN-2026-09-19.md:130` 的 F2 已用**假 GitLab 收到真实 POST**（带 `PRIVATE-TOKEN` 头）跑通，且该报告明写「必须到 L3 才算真跑通」。见 AUD-3 |
| C2 | §四.2 AI 引擎真实仓库可达性 | ✅ 已如实写进文档（`product §10.4` + README 边界表）：真实语料 0 `uncertain` → AI 不触发，属预期；不补样本 |

#### D 组 · ✅ 补验已跑完并收口（2026-09-20）

> **来源**：§二.18 的 9 条「未验项」+ 清点时新发现的**两处无归属口子**（U4(c) `.vue`、`src/lib/events.ts:6` 的多实例 TODO）。
> **终结形态**：`✅ 已验/已定` 或 `⛔ 不做（必须写理由）`。
> ⚠️ **编号空间**：本组 `D1–D11` 是**新编号**，与旧 §二 里的 `D2`（Monaco）/ `D4`（超时）**无关**；凡引用旧编号一律写「§二.x」。
> ✅ **收口结论（2026-09-20）**：本轮验出的 2 个真缺陷（① 同仓库并发未串行化 / ② Monaco 仍依赖 CDN）**经用户判定均非阻塞 → 不修，已转 §三「明确不做」**；
> 其余 9 条全部拿到终态（7 条实测 + 2 条文档声明，见下表 D9 / D11）。**本组无遗留活口。**

| 新号 | 事项 | 原出处 | 怎么验（判据） | 终态 |
|---|---|---|---|---|
| D1 | 并发上限 = 3 | §二.18 · B3 | 连发 5 个任务，观察是否只跑 3 个 | ✅ **已验**：实测最大并发 **3**（5 任务 → 3 跑 / 2 排队 → 依次补位）。⚠️ 副作用暴出缺陷 ① |
| D2 | 超时取消 → `failed` 态 | §二.18 · B4 | 造一个 `baseRef` 不可达的任务 | ✅ **已验**：约 6s 落 **`failed`**，`errorMessage = git diff 失败：baseRef/headRef 不可达，请检查引用` |
| D3 | `FileSnapshot` 缓存命中 | §二.18 · D2 | ⚠️ **原判据无效，已改写**（见下） | ✅ **已验**：`base == head`（0 变更）→ **`cacheHits: 7 / totalFiles: 7`** |
| D4 | `github-push` 事件源 | §二.18 | 补一份 push payload（含 `before` / `after` / `ref`） | ✅ **已验**：合法签名 → `201` + `"source":"github-push"`；错签名 → `401`；结构非法 → `400` |
| D5 | webhook 无事件头兼容路径 | §二.18 | 发不带 `X-GitHub-Event` / `X-Gitlab-Event` 的请求 | ✅ **已验**：`201 created`（统一格式路径通）；错 token → `401` |
| D6 | `npm run seed` / `create-fixture.sh` | §二.18 | 跑一次官方脚本，确认能复现 `fixtures/sample-repo` | ✅ **已验**：干净复现（2 commit / 9 文件 / 退出码 0） |
| D7 | 渲染层截图（详情页五块） | §二.18 | 用无头浏览器对内容块逐块截图 | ✅ **已验**：8 个内容块全部截到并逐张看过（`~/WorkBuddy/AI/cg-screenshots/d7-2026-09-20/`）。⚠️ 暴出缺陷 ② |
| D8 | Monaco 离线化（旧「D4」） | §二.2 / §二.18 | 明确终态 | 🔴 **不是「不做」，是「没做干净」** → 缺陷 ② |
| D9 | fork 仓库 PR | §二.18 | 明确：是否维持「M2 已知边界」 | ✅ **已做**（2026-09-20）：`webhook-adapters.ts:144-147` 已改为**如实声明**「只支持同仓 PR，不支持 fork PR」，并写明后果（`head.sha` 不在目标仓库 → `git checkout --force` 不可达 → 任务落 `failed`，属「响的」失败）。**不再挂「待补齐」** |
| D10 | 支持 `.vue`（= U4(c)） | §二.12 · U4 | 明确：立独立项 / ⛔ + 理由 | ✅ **已定**：维持**范围外**（A1 已声明，`README.md:250` + `:253`）。理由：拆 `<script>` + 行号偏移 + 模板引用属大工程，与「TS/JS 栈影响链路」定位不符 |
| D11 | `events.ts` 多实例 TODO | 清点新发现 | 登记进「已知边界」/ ⛔ + 理由 | ✅ **已做**（2026-09-20）：`README.md` 部署节已补声明 —— 「不需要 Redis」以**单实例**为前提（SSE 走进程内事件总线，挂 `globalThis`），多实例 / Serverless 下跨实例订阅失效，需换 Redis pub/sub |

**D3 判据修正（重要）**：§二.18 原写「同仓库同 commit 跑两次，看第二次是否命中」——**这条判据本身无效**。
`cacheHits` 只统计**不在 `base...head` diff 里**的文件；而 `fixtures/sample-repo` 的 MR 改动了**全部 7 个源文件**，所以任何一次跑都必然是 `cacheHits: 0`（实测两次都是 0，不是缓存坏了）。
✅ 正确判据 = **令 `baseRef == headRef`**（0 变更文件）→ 7 个文件全走「未变更」分支 → 实测 **`cacheHits: 7`**，缓存机制成立。

#### D 组结论 · 暴出的 2 个真缺陷（**已转 §三「明确不做」**）

**缺陷 ① 🔴 同仓库并发任务会因唯一约束竞态被误判 `failed`**
- 现象：多个任务并发跑**同一个仓库**时，实测**至少 1 个**落 `failed`：
  `Invalid prisma.exportSymbol.createMany() ... Unique constraint failed on the fields: (repo_id, file_path, symbol_name)`。
- 根因：`src/lib/persist.ts` 的 `persistSymbolTable` 是「同一事务内 `deleteMany` → `createMany`」；两个任务对同一 `repoId` 并发落库时事务交错 → 后者 insert 撞上前者刚写回的行。
- 危害方向：**分析其实已经成功**（结果完整），任务却被标成 `failed` → 用户拿到一个「红着的、但其实有结果」的任务。
- 复现（确定性）：同一 `gitUrl` 连发 3 个任务 → 必现（本轮两次运行分别 **2/5**、**1/3** 失败）。
- 未登记：`DEVELOPING.md:49` 登记的是**另一张表**（`tasks` 的 `repo_id,mr_id,commit_sha` 幂等去重噪音），与本条无关。
- **处置（2026-09-20）：判为 `won't fix`，不修** —— 见 §三 ①（含理由与回头条件）。若将来回头，候选修法：给**「workdir 使用 + 落库」整段**加按 `repoId` 的串行化（进程内 mutex / advisory lock），或把 `createMany` 换成 `upsert` 语义（`ON CONFLICT DO UPDATE`）。

**缺陷 ② 🔴 Monaco 声称「本地打包、零 CDN」，实际仍从 jsdelivr 拉取**
- 声明：`next.config.ts:18` 写「Monaco Editor 本地打包（2026-09-17）：消除 CDN 依赖，私有化部署合规」；`DiffViewer.tsx:4` 写「零 CDN 依赖」。
- 实测：详情页加载时浏览器**实际发出 15 个站外请求**，全部指向
  `https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/...`（`loader.js` / `editor.main.js` / `workers-*.js` / `ts.worker-*.js` 等）。
- 根因：本地化靠的是 `next.config.ts` 的 **`webpack:` 钩子 + `MonacoWebpackPlugin`**，只在 **Webpack** 下执行；本项目 dev 跑 **Turbopack**（`next.config.ts:15` 亦显式配置了 `turbopack`）→ 插件不生效 → 回落 `@monaco-editor/react` 默认的 CDN loader。
- 附带问题：CDN 拉的是 **0.55.1**，与 `package.json` 固定的 `monaco-editor@0.52.2` **不是同一版本**。
- 危害方向：**离线 / 私有化部署下「代码 Diff」块会一直停在 `Loading...`**（首次截图即为此形态）——恰是这条修复想解决的问题没解决。
- ✅ **生产路径已验（`next build` 跑完，7m40s；构建头打印 `▲ Next.js 16.3.4 (Turbopack)`）**：
  产物里**没有** `.next/static/monaco/` 目录、**没有任何**文件名含 monaco 的本地资源；而
  `.next/static/chunks/0rf3dcgsvz-zb.js` **内嵌了 `cdn.jsdelivr.net/npm/monaco-editor` 这个地址**。
  → **dev 与 build 两条路径都依赖 CDN**，`next.config.ts:18` 那句「零 CDN 依赖 / 私有化部署合规」整体不成立。
- **处置（2026-09-20）：判为 `won't fix`，不修；两处假注释已改为如实描述**（`next.config.ts` §顶部 + `DiffViewer.tsx`）—— 见 §三 ②。
  若将来回头（离线 / 内网部署），候选修法：① 给 Turbopack 配等效的静态资源规则；② 改用 `@monaco-editor/react` 的
  `loader.config({ monaco })` 显式喂本地 `monaco-editor`（`vs/` 自托管到 `public/`）。
  无论走哪条，都应补一条**产物级防线**：构建后断言产物里不得出现 `cdn.jsdelivr.net`（防回归）。

**另一条观察（非缺陷，但该知情）**：`uncertain` 变更交给 DeepSeek 判定后，**同一输入两次运行的 severity 可能不同**
- 证据：同仓库同 base/head 连跑两次，7 条 AI 判定的变更里 `home.tsx#HomePage` 一次 `medium`、一次 `high`（其余 8 条完全一致）；日志 `[AI] uncertain 变更 7 条已由 AI 语义引擎判定完成` 两次均出现。
- 性质：`semantic-graph.ts` 规定 AI 的 `confidence` 只能是 `heuristic` / `uncertain`，故这是 **LLM 固有抖动**，不是规则引擎缺陷；但**首页高危/中危计数会在两次运行间变化**，值得在已知边界里写明。

#### 审计收口批 · 文档准确性全量审计（2026-09-20 晚 · `AUD-1`–`AUD-11`）

> **来源**：用户口令「全量完整的搜索项目中全部的文档相关内容，确认准确性」。**是记账，不是解冻**（口径见 §六）。
> **范围（自证覆盖）**：`git ls-files '*.md'` → 仓库内**只有 5 份 md**，全部逐行读；另核 3 份说明性配置（`.env.example` / `ci.yml` / `docker-compose.yml`）。
> **手段**：① 机械核对路径引用 201 条候选；② 数值核对 16 组；③ 台账 PR 号 / sha 对 `git log --all`；④ 仓库外旁证（`ROADMAP.md` 作口径源、`历史报告-移出/` 作证据源）。
> **结论**：🔴 4 条事实错误 / 口径矛盾 **全部已修**；🟡 6 条偏差 + 1 条自我纠错 **已处置**。
> 未覆盖：代码注释未全量校对（仅按关键字扫）；仓库外文件只确认漂移、未修。报告全文（仓库外）：`学习笔记/code-guardian/文档准确性全量审计-2026-09-20.html`。

| 新号 | 位置 | 写的 | 实际 | 处置 |
|---|---|---|---|---|
| **AUD-1** | `README.md:19`（＋代码注释 `src/lib/ai/semantic-graph.ts:2`） | 「约 **80%** 的变更不送 AI」 | 口径源 `ROADMAP.md:240` 已标**禁用**（无测算出处 + 被实测反向推翻）；T4(`:602`) 判过同一问题，但范围只含 `product.md`×6 + `architecture.md`×2 → **漏了 README 与代码注释** | ✅ **已修**：README 改为「**绝大多数变更由规则判定**（真实仓库实测 0 `uncertain`）、模糊的才送 AI」；注释去掉比例并注明理由。复测：活文档侧 `rg '80%'` 应 0 命中 |
| **AUD-2** | `docs/DEVELOPING.md:75` | 「**无 `gh` CLI**」 | **事实错误**：`gh` v2.73.0 在 `/opt/homebrew/bin/gh`，只是**不在默认 `PATH`** → `which gh` 报 not found，**不能用 `which` 判**。代价：AI 据此连错两轮，PR #26/#27/#28 都推给用户手动开 | ✅ **已修**：改写为「用 `gh`（绝对路径）+ 备用 curl」，并写明它是「push 被挡」时的可用通道（走 `api.github.com`，不被代理拦） |
| **AUD-3** | §二 C 组 C1 ＋ §四.1 | GitLab 回写「**外部依赖，当前环境不可验**」，回头条件「拿到 token + 真实项目」 | 仓库外 `E2E-RERUN-2026-09-19.md:130` 记 F2 = **L3**（假 GitLab 收到真实 POST + `PRIVATE-TOKEN` 头）= ✅ 真跑通 | ✅ **已更正为「已验（L3）」**（两处同步，原文划删除线保留）。📌 教训：判「不可验证」前先问它依赖的是**厂商**还是**协议** —— 依赖协议 → **造假服务即可验真，无需真账号** |
| **AUD-4** | `docs/DEVELOPING.md:186` | 单测「**17 个文件**」 | 实测 **18**（`ls tests/*.test.* \| wc -l`；全仓测试文件仅存在于 `tests/`） | ✅ **已修**为 18 + 复测命令 + 「此数随开发增长」。⚠️ 同条 S5(`:97`) 曾把「10 个」改成「17」，**又过期了** —— 「写死数字必被同批改动顶掉」 |
| **AUD-5** | `docs/product.md:112` | 「单元测试 **238 个**」 | 实测 **250**（18 个文件的 `^test(` 加总复算命中） | ✅ **已修**为 250 + 复测命令（原 hedge「此数随开发增长，用前复测」保留） |
| **AUD-6** | `docs/architecture.md:173` | `enrichSecurity(result, workdir)` | 真实签名 **4 参**：`enrichSecurity(output.result, workdir, task.baseRef, task.headRef)`（`src/lib/scheduler.ts:152`） | ✅ **已修**为完整 4 参 |
| **AUD-7** | `:777`（§二.17 表「G1 HTML 说明书」行） | 列 2 写 `docs/g1-spec.html` | **复核为非缺陷**：该表列 2 的表头是「**原位置（仓库内，已不存在）**」，同表其他行（`docs/learning/ROADMAP.md`）同理 → **它就是故意的历史路径，不是死链**，与 `:529` 也不矛盾 | ⛔ **不改**。⚠️ **本条是审计脚本的假阳性**（脚本把反引号路径一律当活引用）——记在此处，**避免下次又当新问题发现一遍** |
| **AUD-8** | `docs/DEVELOPING.md:17` | 「四道门禁 —— 与 CI **完全一致**」 | `ci.yml` 里是裸 `npm run lint / typecheck / test / build`，**没有** `env -u NODE_OPTIONS`（该前缀只是沙箱本地需要，§2.7 自陈） | ✅ **已修**为「**同一套命令**（沙箱里额外加 `env -u NODE_OPTIONS`）」 |
| **AUD-9** | `src/lib/run-analysis.ts:22` vs `docs/DEVELOPING.md:194` | 注释写「同步点共 **3 处**」；文档写「共 **4 处**」 | **两个数都对**（3 处把两个测试文件合并算 1；4 处拆开算），但并列会让人怀疑其一有错。**4 处的行号逐条核对全对** | ✅ **已统一**：代码注释改为「共 4 处」并列出 4 个位置，与 `DEVELOPING.md` §4 口径一致 |
| **AUD-10** | `docs/DEVELOPING.md:7` | HANDOVER「**现已删除**」 | `资料归档/code-guardian-HANDOVER-2026-09-16.md`（61K）**仍在** | ✅ **已更正**为「已删出仓库并**归档**在仓库外 …」 |
| **AUD-11** | 本台账自身两处笔误 | (a) 原审计报告把 GitLab 那条写成「§三.1」；(b) `:12` 归档声明里写 `E2E-RERUN-2026-17` | (a) 它在 **§四.1**（§三 装的是 B1/B2/E4/P2①/P2②/①②）；(b) 实为 `E2E-RERUN-2026-09-17`，**少了 `09-`** → 使 `:14` 那句「凡指向 `docs/reports/*.md` 的链接均指向该归档目录」**指针失效** | ✅ **已订正**：(a) 见本条即订正记录；(b) 属**文件名笔误**（非历史判定），已修 —— 修它不改"当初判成什么" |

**本轮审计的自我纠错（必须留痕，否则下次重犯）**：

| # | 我起初的结论 | 实测 | 性质 |
|---|---|---|---|
| 1 | `tests/` 有 **20** 个测试文件 | **18** | 统计失误 |
| 2 | `persist.ts` **没有** Prisma 事务 | 有（`:32 $transaction` / `:35 deleteMany` / `:39 createMany`） | 🔴 **沙箱 `grep "a\|b"`（toybox）静默返回 0 匹配** → **假阴性**；本轮共触发 **3 次**，均已改用 ripgrep 推翻 |
| 3 | `:777` 是**死链** | **非缺陷**（见 AUD-7） | 脚本判据过宽 |
| 4 | 上一条报告里的「§三.1」 | 应为 **§四.1** | 定位笔误（见 AUD-11a） |

> 📌 **共性**：4 条里 **3 条是「工具给了 0 命中 / 0 异常，我把它当成了事实」** —— 与 §六 那句
> 「**靠"看着没问题"写上去的 ✅ 一律不算数**」是同一个病。**下次审计：凡"搜不到"，必须换第二种手段交叉验证。**

#### 审计收口批（第二轮 · 陈述级）· `AUD-12`–`AUD-18`（2026-09-20 晚）

> **来源**：用户口令「再重新进行仔细的检查文档内容，是否还有内容错误的部分」。
> **换靶子**：本轮**只核语义层**（能力声称 / 口径描述），**不重核**第一轮已过的机械层（数字 / 路径 / 命令 / PR 号 / sha）。
> **手段**：① 逐条读代码定性；② **「找一个关键词，把它在文档里的每一处用法都对照代码判一次」** —— 全仓 md 搜「静默」19 处逐条判，命中 1 条旧口径残留。
> **结论**：🔴 2 条 + 🟡 4 条 + ⚪ 1 条 **全部已修**（`AUD-18` 经用户 2026-09-20 21:5x 追加批准后一并处理）。
> **状态**：✅ **已合并** —— PR **#29**（squash），`main = cfd3a63`，四门禁全绿；分支 `docs/audit-round2-doc-fixes` 已删除。

| 新号 | 位置 | 写的 | 实际 | 处置 |
|---|---|---|---|---|
| **AUD-12** | `README.md:110-119` | 「快速验证 Webhook 幂等」的 curl 示例 —— 只有 `-H 'Content-Type'`，**无任何鉴权头** | 当前代码下**照抄必失败**：`src/app/api/webhook/route.ts:42` 未配 `WEBHOOK_SECRET` → **503**；`:78` 无 `x-gitlab-token` → **401**（无事件头兼容路径**同样**校验该 token）。**且与本文件 `:140-141` / `:208-210` 的 fail-closed 声明自相矛盾** —— D5 fail-closed 改造（2026-09-16）之后示例没同步 | ✅ **已修**：补 `-H "x-gitlab-token: $WEBHOOK_SECRET"` ＋ 前置「必须先配 secret」声明 ＋ 期望码（201 created / 200 duplicate）＋ 真 MR 适配路径提示 |
| **AUD-13** | `README.md:19` ＋ `docs/product.md:53` | 「25 条查表规则 + `unknown` 兜底（函数签名/字段/**别名**/**重命名导出**/enum/class）」= **列了 6 类** | `RULE_TABLE`（`worker/rules.cjs:222-252`）实为 **4 类**：签名 **10** ＋ 字段 **8** ＋ enum **2** ＋ class **5** ＝ **25**。「别名」在 `rules.cjs:291-297` 是**复用字段级规则**、「重命名导出」是 `runRules:264` 的**内联分支** → **两者都不占条目**。与 `docs/architecture.md:157` 的精确口径**直接冲突** | ✅ **已修**：两处统一为「函数签名 10 类 / type·interface 字段 8 类 / enum 成员 2 类 / class 成员 5 类」。复测：`rg '别名/重命名导出'` 应 **0 命中** |
| **AUD-14** | `docs/architecture.md:194` | 「8 并发 + **单包失败静默跳过**；累计总体积 + 最大单包」 | **U8 修复前的旧口径残留**。`src/lib/security/bundle-size.ts:72-90` 明写「**不再静默**」：失败包计入 `failedCount` 并置 `incomplete`；报告页 `src/app/tasks/[id]/page.tsx:452-455` 出「共查询 N 个包，其中 M 个查询失败未计入」 | ✅ **已修**：「单包失败**不再静默**（U8，2026-09-19）—— 计入 `failedCount` 并置 `incomplete`，报告页显式提示」。复测：`rg '单包失败静默跳过'` 应 **0 命中**。<br>🔴 **为什么这条最要紧**：它把**已经修好的防线说成「会少报、而且不提示」**，正撞本项目红线「致命缺陷全在少报方向」 |
| **AUD-15** | `README.md:73` | DeepSeek 行：「`node:https`/`node:http` 直连，走代理时**自动降级**」 | 实为**自动改道**，不是降级：`src/lib/ai/deepseek.ts:110-121` —— 配了 `HTTPS_PROXY`/`HTTP_PROXY` 走 **CONNECT 隧道**，未配则回退 `httpsDirect` 直连。「降级」暗示质量变差，**方向会被读反** | ✅ **已修**：「配了 `HTTPS_PROXY` 则**改走 CONNECT 隧道**（undici 不读代理变量，在代理环境会挂死），无代理时直连兜底」 |
| **AUD-16** | `docs/product.md:115` ＋ §10.3 | 体积门禁「累计 unpackedSize **100MB**」—— **无统计范围口径** | **漏**了「只统计**顶层直接依赖**」（`bundle-size.ts:1-3` 明写；本台账 `:210` 早已记）。而 CVE 那条（`product.md:114`）明写「完整依赖树，**含传递依赖**」→ **两条口径不对称**，而 §10.3 的定位正是「**判读报告前必读**」 | ✅ **已修**：`:115` 补「**只统计顶层直接依赖**，不含传递依赖」；§10.3 新增第三条 bullet「**两个数字的统计口径不同，不能互相推**」 |
| **AUD-17** | `docs/architecture.md:94` ＋ `prisma/schema.prisma:29` | 仓库配置关键字段列 `default_branch` / `rules_config`(JSON)；schema 该行注释写「规则开关，**热更新**」 | **全仓零读写**：`rules_config` 只出现在 `schema.prisma:29` ＋ 初始迁移 `20260902131530_init`；`default_branch` 仅 `prisma/seed.ts:24` 写过、**无代码读取** → 「热更新」是**未实现的声明**（既无读开关的代码，也无改开关的入口） | ✅ **已修**：schema 注释标注「⚠️ 预留：当前全仓无读写 —— 注释里的『规则开关/热更新』尚未实现」；architecture 表格行改为「为**预留字段，当前无代码读写**（见下方 ⚠️）」 ＋ 新增 ⚠️ 段（照 `feedbacks` 先例），并提炼纪律「**schema 里出现的字段 ≠ 已实现的能力**」 |
| **AUD-18** | `docs/product.md:130` | 路线图「未来（可选）：…**真实 GitLab 集成验证**…」 | 与 §四.1 的更正「**已验（L3）**：假 GitLab 收到真实 POST ＋ `PRIVATE-TOKEN` 头」有张力 —— 协议层已验穿，剩的只是**真实例** | ✅ **已修**（用户 21:5x 追加批准）：改为「真实 GitLab **实例**验证（协议层已用本地假服务验穿，见 `AUDIT-BACKLOG.md` §四.1）」—— 这样与 §四.1 同口径，读者不会再误以为整条路径没验过。复测：`rg '真实 GitLab 集成验证'` 应 **0 命中** |

> 📌 **本轮的元教训（写给下次审计）**：**「核过一遍」必须写清核的是哪一层**。
> 第一轮核的是**可机械比对层**（数字 / 路径 / 命令 / sha），第二轮核的是**语义层**（能力声称 / 口径描述）——
> 在第一轮「4🔴 + 6🟡 全部处置完毕」之后，语义层**仍然捞得出 2🔴 + 4🟡**。
> **可复用手法**：「**找一个关键词，把它在文档里的每一处用法都对照代码判一次**」——
> 本轮用「静默」扫全仓 md 19 处，命中唯一一条旧口径残留（= `AUD-14`）。比逐文件通读更容易抓「**改完代码没同步文档**」的残留。

### 0. ✅ 收口分支 `fix/audit-tier1-3` —— **已合并**（main = `30c7dbb`）

- ✅ PR **#17**（https://github.com/ForceNiu/code-guardian/pull/17）squash merge 完成，CI 全绿。
- ✅ 内容完整性已验：`git diff --stat <分支head> origin/main` 为空
  （⚠️ 不用 `--is-ancestor` —— squash 是新提交，必然不成立）。
- ✅ 本节原写「只差合并批准」，**2026-09-16 23:0x 同步为已完成**。

### 1. ✅ C 类测试缺口 · 7 个模块（**用户 2026-09-16 定为「都做」**）

> ✅ **2026-09-16 全部完成并已入库**（PR #18，main = `2e9b9ee2`）。本条保留在此处是为了留下证据与范式，
> **不要再当成待做项**——需要新测试时另开条目。

| # | 模块 | 行数 | 测什么 | 难度 |
|---|---|---|---|---|
| ~~C7~~ | ~~`src/lib/security/index.ts`~~ | 40 | 「失败不阻断主链路」兜底语义 | ✅ **已完成**（6 条断言，见下） |
| ~~C4~~ | ~~`src/lib/run-analysis.ts`~~ | 54 | 三条 settle 路径（message / error / exit）+ 超时 `terminate()` | ✅ **已完成**（8 条断言，见下）；**并查出 N3** |
| ~~C2~~ | ~~`src/lib/persist.ts`~~ | 95 | 快照→缓存的防御性解析；事务内调用顺序 | ✅ **2026-09-16 已完成**（10 条断言，见下） |
| ~~C3~~ | ~~`src/lib/enqueue.ts`~~ | 71 | created / duplicate(P2002) / 其他错误 rethrow / SSE 广播 / `deriveName` | ✅ **2026-09-16 已完成**（10 条断言，见下） |
| ~~C6~~ | ~~`src/lib/ai/deepseek.ts`~~ | 263 | 三种降级分支（代理 CONNECT / httpDirect / 失败）+ 限流退避 | ✅ **2026-09-16 已完成**（15 条断言，见下）。上一版曾写过一版**假的**，已作废（见下方事故记录） |
| ~~C5~~ | ~~`worker/analyze.worker.cjs`~~ | 257 | git checkout/diff/show 的参数数组调用 | ✅ **2026-09-16 已完成**（8 条断言，真实 git 仓库 + 真 Worker 线程，见下） |
| ~~C1~~ | ~~`src/lib/scheduler.ts`~~ | 197 | 编排层：原子认领 / 超时置 failed / 取消后不覆盖 done | ✅ **2026-09-16 已完成**（13 条断言，7 个 fake，见下）。上一版曾写过一版**假的且砍坏了生产代码**，已作废（见下方事故记录） |

**开工顺序**：~~C7 → C4 → C2 → C3 → C6 → C5 → C1~~ ✅ **全部完成**。

#### 🔴 事故记录：2026-09-16 那批「C2–C1 单测」为什么被判作废

**这是本项目迄今最严重的一次过程事故——「测试绿了」是靠改生产代码换来的。**

- **C6**：`tests/deepseek.test.ts` mock 了一个**根本不存在的导出** `askDeepSeek`
  （`src/lib/ai/deepseek.ts` 真实导出只有 `DeepSeekLLM` 类与 `createLLM()`）。
  → 4 条断言全是「mock 和自己比」，**0 覆盖率**。
- **C1**：为让 `new Scheduler()` 这个**全仓无人使用**的 API 通过测试，
  把 `src/lib/scheduler.ts` **从 197 行真实实现砍成 33 行 stub** ——
  丢掉 `startScheduler`/`stopScheduler`、原子认领、超时置 failed、卡死任务回收、整条流水线。
  → `src/instrumentation.ts:5` 报 **TS2339**，**应用启动时的调度器引导已断**。
- **C2**：夹具字段凭猜测写、与 `types.ts` 不符（`importers` 缺失、`from` 应为 `source`）；
  还把一个**测试专用函数 `loadSnapshot` 塞进了生产 `persist.ts`**（`src/` 内零调用者，用 `require()`）。
- **C3** 是那批里唯一有效的（实现本来就在 main 上，测试也真打在它上面）。

**为什么没被当场发现**：只跑了 `npm test`（**199 绿**）就下了「完成」的结论，没跑 `typecheck` / `lint`。
假绿通道是敞开的 —— 测试跑在 `tsx` 上**不做类型检查**，而 `--experimental-test-module-mocks`
允许 `mock.module` **往一个没有该具名导出的模块里注入假导出**。只有 `typecheck` 会红：

```
tests/deepseek.test.ts:27  TS2339: Property 'askDeepSeek' does not exist ...
src/instrumentation.ts:5   TS2339: Property 'startScheduler' does not exist ...   ← 入口已断
```

**已写入技能 `detection-regression-discipline`（⑥ 第 5 条硬规则 + ⑥-b + 危险信号清单 4 条）**，三条对策：

1. 改完**四道门禁全跑**，`npm test` 绿**不算数**。
2. 自检用例只证明「mock 在调用路径上」，**没证明「被 mock 的东西在生产里存在」**
   → **被 mock 的导出必须能在真实模块里 grep 到**。
3. 断言里出现 `assert.ok(true)`、或「mock 的返回值 == mock 自己设定的值」→ **恒真摆设，等于没写**。

**本次处置（2026-09-16 23:1x）**：`git checkout -- src/lib/scheduler.ts src/lib/persist.ts` 还原生产代码；
删掉 `tests/deepseek.test.ts` 与 `tests/scheduler.test.ts`；`tests/persist.test.ts` 与 `tests/enqueue.test.ts` 重写为打在真实行为上。
→ 四道门禁：`lint` 0 / `typecheck` 0 / `test` **201 pass** / `build` ✅。

#### C2 的验收证据（2026-09-16）

- 断言 **10 条**，全绿。覆盖：事务内调用顺序（deleteMany→createMany→upsert）、空表不进事务、
  四张缓存表的拆分、不串仓、以及 **3 条防御性解析**（`symbols` 为 null / 旧缓存缺 `reexports` / `exports` 是脏数据）。
- 防御性那 3 条是真打在 `readSymbolCache` 的 `if (snap.symbols)` 与逐字段 `Array.isArray` 上 ——
  这正是台账原本要求 C2 测的「快照→缓存的防御性解析」。

#### C5 的验收证据（2026-09-16）

- 断言 **8 条**，全绿。**集成测试**：真实 git 仓库（4 个文件，main=base / feature=head）+ **真 Worker 线程**。
- **为什么这层不能 mock**：「路径引号」事故的本质是 `execFileSync("git", ["show", "base:src/x.ts"])` 的参数里多了引号
  → git 去找一个名字带引号的文件 → 找不到 → 返回 `null` → **所有文件被误判 added**。
  mock 只会按你写的参数返回你想要的结果，**这类缺陷靠 mock 永远测不出来**，必须真过一遍 git。
- **灵敏度验证（点名式）**：把 `git show` 的路径临时加回引号 → **4 条变红**
  （事故守护 / 签名变更 / removed / diff 全文），其余 4 条保持绿
  （自检 / 影响链路 / 增量缓存 / 错误回传 —— 本来就不依赖 base 内容，符合预期）。
  还原后 SHA-256 逐字节一致。
- 顺带覆盖：增量缓存（第一轮 0 命中、第二轮命中且**结论不变**）、
  headRef 不可达时**回传 error 而不是崩掉不回消息**（后者 = Promise 永不 settle = N3 那类事故）。

#### C1 的验收证据（2026-09-16）

- 断言 **13 条**，全绿，7 个 fake（prisma / run-analysis / persist / enrich / security / gitlab-status / events）。
- 覆盖：启停（重复 `startScheduler` 不重复启动）、卡死中间态回收、原子认领失败则跳过、
  并发上限（槽位满后第二轮不再查 pending）、`take = 剩余槽位`、
  仓库不存在 → failed、成功路径 `analyzing→reporting→done` 且每步广播、
  分析抛错 → failed + GitLab 回写 failed、**两道 `ctrl.cancelled` 守卫**。
- 🔴 **灵敏度验证做过两轮，第一轮是失败的 —— 值得记下来**：
  - 初版只写了一条「被超时后不该落 done」，结果**删掉任意一道守卫测试都还是绿的** ——
    因为另一道会兜住。这种断言**粒度不够，等于没写到点上**（和「两道都在」等价）。
  - 改成两条、各自把「卡住的位置」放在对应守卫之前后：
    **删守卫① → 恰好「守卫①」红，其余 12 条绿；删守卫② → 恰好「守卫②」红，其余 12 条绿。**
  - → 判据：**删掉某个守卫后测试没变红，说明你测的不是它。**
- 🔧 **模块级状态陷阱**（`started` / `running` 都是 `let`，跨用例共享）：
  `tick()` 不导出，只能靠「stop → start」触发新一轮；每用例开头必须先 `stopScheduler()`，
  否则第二次 start 直接 return。需要挂起时用 holder 的 manual 模式，**用完务必 `releaseAll()`** ——
  否则 `running` 下不来，会把后面的用例全卡在并发上限上。

#### C6 的验收证据（2026-09-16）

- 断言 **15 条**，全绿。`createLLM` 无 key 返回 null / 有 key 返回实例；请求形状（URL / Bearer / 模型 /
  思考模式 / `reasoning_effort` / `temperature`）；消息转换（string → user、角色映射、非字符串 `JSON.stringify`）；
  失败与重试；两条出网通路。
- **网络层怎么断**：该模块刻意不用 `fetch`，而是 `node:https` / `node:http` / `node:tls` 直发
  （源码注释写了原因：undici 不读 `HTTPS_PROXY` 会挂死）。所以 mock 这两个**内置模块**，
  而不是 mock fetch —— 一层 fake 就够。请求体不用绕路截获，`req.write()` 就是天然记录点。
- 🔎 **写测试时查出的真实行为（值得留意，暂不改）**：`invoke` 的 `catch` 块**不区分「HTTP 错误」与「网络异常」**，
  所以 500、CONNECT 失败这类**确定性错误同样会被重试满 4 次**（退避 500/1000/2000ms）。
  → 后果：一个必然失败的 400 要白花 ~3.5s 和 4 次请求。
  → **处置：本次只如实写进断言，未改代码**（协议⑤）。若要改，方向是让非 429 / 非 5xx 的错误直接抛、不重试。
- 🔧 **踩坑**：`mock.timers.enable()` 必须**早于**被测代码调度定时器，否则静默失效 → 测试卡到 exit 137 零输出。
  已写进技能 `detection-regression-discipline` 附一。

#### C3 的验收证据（2026-09-16）

- 断言 **10 条**，全绿。除幂等主路径外，新增了两条原本没覆盖的真实行为：
  `deriveName` 的边界（尾斜杠 + `.git` 都剥掉）、**M4 SSE 的 `publish(taskId, {status:"pending"})`**，
  以及「`duplicate` 分支不该广播」「缺省字段按 `??` 口径落库（空串 / `null`）」。

#### ✅ 已落地的范式（后续模块照抄这个模板，别再重新踩一遍）

模板文件：`tests/security-index.test.ts`。四条硬规则：

1. **`mock.module(绝对路径, { namedExports })`** 替换模块级依赖；必须先注册、**再**动态 import 被测模块。
   需要 `--experimental-test-module-mocks`（已写进 `package.json` 的 `test` 脚本）。
2. **行为放「可变 holder」，不要写死在 mock 里** —— `mock.module` 没有「按用例重置」，
   holder 才能让不同用例走不同分支（否则只能一个测试一个文件）。
3. 🔴 **第一条用例必须是「自检」**：证明 mock 真的生效了。
   写法：让 mock 返回一个**真实实现不可能返回**的哨兵值，再断言它出现在结果里
   （本仓库的做法：workdir 传一个**必然不存在**的目录 → 真实 `readManifest` 会返回 null → 字段写不进去 → 用例必红）。
   没有这一步，整套断言可能都在对着真实实现跑，**结论全部无效**。
4. **两个 tsx 相关的坑**（本次实测踩到，各花了一次红灯）：
   - 测试文件里**不能用顶层 `await import()`**：package.json 无 `"type": "module"` 时 tsx 把 `.ts` 当 CJS，
     顶层 await 直接报 `ERR_REQUIRE_ASYNC_MODULE`。→ 改用 `before()` 钩子里做动态导入。
   - 动态 import 的路径**不能带 `.ts` 后缀**：冲突 `allowImportingTsExtensions` 未开 → `TS5097`，
     而 typecheck/build 都会因此挂。→ 写无扩展名路径。
     （注意：`mock.module` 的**那个** specifier 反而**必须**是带 `.ts` 的真实绝对路径，两者规则不同。）

#### C7 的验收证据（2026-09-16）

- 断言 **6 条**，全绿；全量测试 **167 → 173**。
- **灵敏度验证**（反向破坏 `Promise.allSettled` → `Promise.all`）：**3 条变红、3 条保持绿**，
  且红的正是依赖「结果数组 status/value 语义」的三条（自检 / 部分失败 / 全失败）——
  绿的 3 条（接线、非 npm 项目、清单读取失败）本来就不依赖该语义，**符合预期**。
- 还原后 SHA-256 逐字节一致；四道门禁 `lint / typecheck / test / build` 全 0 退出。

#### C4 的验收证据（2026-09-16）

- 断言 **8 条**，全绿；全量测试 **173 → 181**。
- **模掉了 `node:worker_threads`**（`mock.module("node:worker_threads", …)`），用一个 `FakeWorker`
  手动触发三种收场事件（`message` / `error` / `exit`），**不必真起线程、也不必真等 4 分钟**。
- **超时怎么测**（可复用）：`mock.timers.enable({ apis: ["setTimeout"] })` + `mock.timers.tick(240_000)`，
  用例结束 `mock.timers.reset()`（放 `finally`）。
- **灵敏度验证做了两次「点名式」反向破坏**：
  - 删掉超时里的 `void worker.terminate();` → **恰好「超时」那条红**，其余 7 条绿；
  - 把 `exit 0` 分支改回 `if (code !== 0)` 旧写法 → **恰好「exit 0」那条红**，其余 7 条绿。
  - 还原后 SHA-256 逐字节一致；四道门禁全 0 退出。
- 🔴 **C4 的直接收益 = 查出并修掉 N3**（见 §一·第三批）：这条缺陷是"永不 settle"型的，
  **测试运行器是唯一能把它变红灯的手段**（会报
  `Promise resolution is still pending but the event loop has already resolved`）。
  → 这也是「C 类测试值得做」的第一个硬证据：**第一枪就打出真东西**。

### 2. D4 Monaco 离线化（**用户 2026-09-16 定为「做」**）

- 现状：`src/components/DiffViewer.tsx:15` 写死 `cdn.jsdelivr.net/npm/monaco-editor@0.52.2`。
- ⚠️ **风险提示（做之前先看）**：Next 16 + Turbopack 下 Monaco 的 worker 需要额外配置
  （`MonacoEnvironment.getWorker` + worker 入口），且会把 monaco 打进产物（**体积成本**）。
  → 建议**单独一批**处理，先做可行性 spike，别和 C 类混在一起。

### 3. ✅ 全链路重跑（**红线要求**）—— 2026-09-17 已完成

- ✅ **复跑记录**：`docs/reports/E2E-RERUN-2026-09-17.md`（R0 基线 / R1 真实仓库 / R2 webhook / R3 对比 / R4 AI）。
- ✅ `A1–A10` 逐条有结论；**AI 调用 4 次**（2 任务 × 2 次/任务），全在 DeepSeek **空闲档**。
- ✅ **引擎改动（A3 / N1 / N2）未引入回归**：三份真实仓库基线与历史基准逐项一致（窗口对齐后）。
- ✅ 新拿到比上轮更硬的 AI 证据：**同输入两轮，7/7 条 AI 文案不同**（缓存/硬编码不可能产生）。
- 🔴 **复跑查出的口径级结论 → 已升级为独立待办（见 §四 第 2 条）**：
  **A3 之后三个真实仓库全部 0 uncertain → AI 语义引擎在真实仓库上不再可达**，只剩合成 fixture 能触发。

### 4. G1 · 零背景读者向 HTML 项目说明书

- 产物：`g1-spec.html`（单文件 HTML）。⚠️ **2026-09-18 已移出本仓库** —— 用户口径：学习 / 说明类产物属个人材料，不污染项目；现位于**仓库外的个人学习区**（与学习笔记同处）。本文档此后只记录它的**结论与验收口径**，不再给出仓库内路径。
- 🔄 **2026-09-18 第二版（重做）**：第一版（09-17）状态标的是「✅ 已完成」，但交付物是**术语密集版**，
  用户反馈「**完全看不懂**」→ 该「已完成」标记**名不副实**。第二版按用户四点要求重做：
  ① 颗粒度「中」（确认怎么做的 + 报真实参数）② 呈现深度 B（功能 + 真实代码位置 + 真实参数，细节折叠）
  ③ 技术词旁边配一句大白话 ④ **局限如实写**。
- ⚠️ **两版差异（别再照抄第一版的描述 —— 那些交互在第二版里全没有）**：

  | | 第一版（已废弃） | 第二版（当前） |
  |---|---|---|
  | 定位 | 功能层 + 架构层，术语密集 | **大白话功能清单**，10 章 |
  | 交互 | 规则 25 条可筛选展开 / AI 管线 4 节点可步进 / E2E 断言 A1–A10 逐条展开 / **学习模式**（每区块「已讲完」自动进度） | **仅**：侧边目录滚动高亮 + 深浅色切换 + 2 处 `<details>` 折叠 |
  | 依赖 | 引 CDN / mermaid（`file://` 打不开、CDN 失败） | **零外部依赖**（实测全仓 `http://` / `cdn` / `<script src` 匹配数 = 0），双击即开 |

- 第二版的真实性约束：**每项功能先回真实代码核实再写**（证据清单见 §一 第八批），局限单列第 9 章
  （GitHub 不回写红绿灯 / 红绿灯从未端到端验证 / AI 极少触发 / 体积只查顶层 / barrel 被删漏报 / `extends` 读不到）。
- 🔴 G1-KICKOFF.md 已按约定删除（它是过渡件，不入库长期保存）→ **2026-09-18 已在仓库外学习区留档**（见 §二.17 表）。
- ✅ **2026-09-18 学习路线图已固化**（把「分阶学习路线 + 已闭卷掌握项 + 教学法教训 + 数字口径」收进单一份文件）。
  **动因是同一类事故已发生两次**：① `HANDOVER.md`（已删）带走 G1 原始范围定义；② `G1-KICKOFF.md`（已删）带走分阶路线图，
  当时只剩 memory 日志里有（**2026-09-18 已补：存档到仓库外学习区**）。→ 学习相关的定义 / 路线 / 进度**一律以那份文件为准**，不再依赖对话上下文或日志。
- 🔴 **2026-09-18 15:1x 口径变更：该文件已移出本仓库。** 用户原话：「**关于学习的部分不想合并到真实的项目源代码中**」。
  → 曾短暂放在 `docs/learning/`，当日即移出到**仓库外的个人学习区**；`README.md` 的索引与 `DEVELOPING.md` 文件地图**已同步撤回**
    （当初为避免 ST3 那类「孤儿文件」而加的链接，现在反过来成了「指向不存在文件」的链接，必须一起撤）。
  → 📌 **对新仓库的通用教训**：**「防孤儿」的加链接动作有前提 —— 目标文件会入库**。文件一旦出库，
    当初那条防孤儿的链接就变成新的失效链接；**入库文档不应为不入库的文件背书**（同 `e2e-logs/` 的处理口径）。
- ✅ **学习方式已于 2026-09-18 变更** —— 用户明确「**不想自己看文件学习**」，
  改为**对话式讲解 + 闭卷复述闸门**；因此「通读说明书」不再是前置条件，直接进第 4 阶。
- ✅ **2026-09-18 学习主线已收官**：第 **0 / 1 / 2 / 3 / 4** 阶**全部闭卷通过**（第 4 阶六个单元全通）。
  ⚠️ **本行原写「下一单元 = 机器怎么"读懂"一份代码（解析 / AST）」—— 该单元即第 4 阶单元 ①，早就完成了**，
  是本节漏更新留下的过期状态（2026-09-18 复查时逮到）。
  → 📌 **学习进度一律以仓库外的 `学习笔记/code-guardian/ROADMAP.md` 为准**（本台账是仓库侧的执行史，不追学习进度）。

### 5. ✅ 文档索引同步 —— 2026-09-17 已完成

- ✅ `README.md` 末尾「这份文档不够看怎么办」表补两行：**`docs/AUDIT-BACKLOG.md`**（审计清单唯一归属地）
  与 **`docs/reports/E2E-RERUN-2026-09-17.md`**（本轮复跑记录）。
- ✅ `README.md` 的 `tests/` 覆盖描述补上 **DeepSeek 客户端 / 安全门禁集成层 / 入队与持久化 / worker 生命周期 / 调度编排**。
- ✅ 顺手校验了 README 里 **8 个 md 链接全部存在**（0 个 404）—— 正是 E4 那条「写死的清单最容易过期」的实例。
- ⚠️ **这条是「习惯」不是待办，别再往回挂**：以后**改了就更新**，本行只作一次结清记录。

---

### 6. 结构审计剩下的 3 条 P2（低成本文档收口）

> 来源：2026-09-17 全项目结构审计（见 §一 第五批）。这三条**都不影响功能**，但都会被评审/招聘方看到。

| # | 条目（含位置） | 动作 | 风险 / 为什么没顺手做 |
|---|---|---|---|
| ~~**S6**~~ | ✅ **2026-09-17 已修**。原 `.gitignore` 只覆盖 `.env` / `.env.local` / `.env*.local`，**漏 `.env.*`** → `.env.production` / `.env.test` 不会被忽略（部署时建一个就会被误提交） | 改为 `.env` + `.env.*` + `!.env.example`。`!.env.example` 必须在 `.env.*` **之后**才生效；旧 `.env*.local` 的语义被 `.env.*` 完全覆盖，故删掉冗余行 | ✅ 验收全过：`git check-ignore -v .env.example` **无输出**、`git ls-files .env.example` 仍有它；**7 种密钥形态全部被忽略**（`.env` / `.env.local` / `.env.production` / `.env.development` / `.env.test` / `.env.production.local` / `.env.development.local`）；旧 `.env*.local` 语义未丢 |
| **S7** | `docs/reports/CODE_REVIEW_REPORT.md` 的勘误 banner **未覆盖三类过期内容**：① 正文写「全套 **118** case」（今 **238 pass**）② 写「`scheduler` 仍无单测」（今 **13 条**）③ 正文仍用**搬迁前路径** `src/worker/*`（今在 `worker/`）—— ③ 即全量文本审计的 **T6**，两者合并为本条 | 在 banner 里补两行：①「测试规模与 scheduler 状态以 README / 本台账为准」②「路径已随结构审计搬迁，见 §一 第五批」 | 历史件且日期已标，属「可信度优化」非「错误」；但评审会拿它跟 README 的数字与路径对照 |
| **S8** | `.env.example` 未列 `HTTP_PROXY` / `HTTPS_PROXY`，而 `deepseek.ts` **刻意读它**（绕开 undici 不读代理的坑），README 扩展指南还专门写了一段 | 加两行注释说明（可选，非密钥） | 同上 —— 代码在意、模板没写，属「文档没跟上设计」 |

---

### 7. 从「已完成」条目里漏出来的 2 条（2026-09-17 清点台账时查出 · **两条均已修**）

> 这两条**不是新问题** —— 它们早被查出来了，但**写在「已完成」条目的证据正文里**
> （C6 的验收证据、历史审查报告的 P6），没有进本节的清单。
> **台账的职责是「不漏」，所以补进来。**
> ⚠️ 由此暴露一个结构性风险：**「已完成」章节里的「诚实标注 / 暂不改」，一样是待办** —— 下次清点要专门扫一遍。

| # | 条目（含代码位置） | 现状 / 来源 | 动作 |
|---|---|---|---|
| ~~**S9**~~ | ✅ **2026-09-17 已修**。原 `invoke` 的 `catch` **不区分「HTTP 错误」与「网络异常」** → 对「200 / 429 之外的所有状态」一律 `throw`，再被 catch 接住、照走 `if (attempt < 4)` 重试 → **4xx（400 模型名错 / 401 鉴权失败 / 404）也重试满 4 次**，白烧 3 次请求 + ~3.5s 退避。⚠️ **原描述把 500 也归为「确定性错误」是错的** —— 5xx 是服务端临时故障，重试才对 | 新增 `NonRetryableError` 类：**4xx（429 除外，429 已在上面单独处理）**抛它 → catch 里立刻透传、不进退避轮次。**5xx / 网络异常照旧重试（行为不变）** | ✅ 验收：新增 1 条断言「400 是确定性错误 → 不重试，只发 1 次请求」；全量 **238 pass / 0 fail**。**灵敏度验证**：注释掉透传守卫 → **恰好该条变红**（`not ok 108`）、其余 237 条全绿 → 还原后 SHA-256 逐字节一致 |
| **S10** | `src/lib/scheduler.ts:182`：失败任务的 `errorMessage` 拼成 `${err.message}\n${err.stack?.slice(0, 500)}`，随后**落库（:185）+ 推 SSE（:187）** → 前端可读到内部堆栈 | 来源 `docs/reports/CODE_REVIEW_REPORT.md` P6（第 117 行）；该报告 §5.4 自己判定「非公网前提下内部可接受，仅作打磨项」 | 二选一：**保持现状**（则转入 §三 `won't fix` 并写明理由）/ 改为**只落服务端日志**、对 SSE 只发 `err.message`。⚠️ 若判定不做，请移入 §三，别让它挂在待做区 |

---

### 8. 活文档里两处「无出处的估算」写成了陈述句（2026-09-17 全量文本审计 · T4/T5）

> 来源：§一 第六批。这两条**不是数字算错**，而是**把估算写成了事实**，且其中一条已被实测反向推翻 —— 被追问就会崩。

| # | 条目（含位置） | 问题 | 动作 |
|---|---|---|---|
| **T4** | 「**80% 规则 / 20% AI**」**共 8 处**（`docs/product.md:11,22,77,78,96,101` = 6 处 + `docs/architecture.md:9,157` = 2 处） | ① 全仓找不到任何测算或实测支撑，但写法是陈述句。② **已被实测反向推翻**：`E2E-RERUN-2026-09-17.md` §3 记录 **A3 之后三个真实仓库四类窗口全部 `0 uncertain`** → AI 在真实仓库上**根本不被触发**，实际趋近 `100 / 0`，与「20% 送 AI」方向相反 | 二选一：**(a)** 改成估算口吻并注明「按设计预期，无实测支撑」；**(b)** 直接改写为可核实的表述（如「规则引擎覆盖绝大多数变更；`uncertain` 才送 AI」—— 不带具体百分比）。**推荐 (b)**：删掉无法核实的比例，就不会再过期 |
| **T5** | 「月 Token 可控在 **$200 内**」（`docs/product.md:101`、`docs/architecture.md:157`） | 全仓唯一成本实据是 `E2E-RERUN-2026-09-17.md` §10：「AI 调用数 4 次，空闲档 0.5×」。由「4 次调用的单次实测」**推导不出**「月 $200 内」—— 它需要「月任务量 × 单任务调用数 × 单价」，而这些参数仓库里都不存在 | **建议直接删掉这句**（或改为「成本按 `uncertain` 变更数线性增长，规则引擎部分 0 Token」）。理由：无法核实的金额承诺，收益为负 |

---

### 9. 代码层两个机器盲区（2026-09-17 全量文本审计 · T7/T8）

> 来源：§一 第六批。**注意性质**：这两条**不是「没人验」**，而是「**机器验证有边界**」。
> 处理它们该用**补工具**，不是人工读代码。

| # | 条目（含位置） | 现状 | 动作 / 风险 |
|---|---|---|---|
| **T7** | 代码层**无覆盖率工具** | 未装 `c8` / `nyc`，`package.json` 也没有 coverage 类 script。现状覆盖是**两层**的：33 个 `src` 模块中 **20 个**被单测直接引用；其余 **13 个**（4 个 API route / 4 个 UI 组件 / `layout.tsx` / `instrumentation.ts` / 3 个 `ui/` 原语）**由端到端复跑覆盖**（`E2E-RERUN-2026-09-17.md` 确有 `POST /api/tasks`、webhook 适配器、SSE 完整阶段流、报告页） | 缺口是「**模块被引用 ≠ 分支被执行**」。加 `c8` 即可看见真实分支盲区。⚠️ **属流程脚手架类改动（动 CI / 加工具），按约定需先对齐必要性，不自行引入** |
| **T8** | E2E 证据是**快照** | 09-17 的全链路证据是**一次**运行的产物，代码继续演进它就会往后退 | **不另立待办** —— 已由红线「引擎大改后必须重跑全链路」（`DEVELOPING.md` §1）约束。此处仅登记其性质，避免被误当成"永久有效的证明" |

---

### 10. 结构审计（第七批）剩下的 2 条（2026-09-17）

> 来源：§一 第七批。两条都**很轻**，登记的目的只是别让它们飘着。

| # | 条目（含位置） | 现状 | 动作 / 风险 |
|---|---|---|---|
| **ST3** | 两份审计报告（`docs/reports/TEXT-AUDIT-2026-09-17.md` + `docs/reports/STRUCTURE-AUDIT-2026-09-17.md`）**都没有 markdown 链接指向它们**，目前只被纯文本提及（链接数 0） | 两份均尚未入库；按链接口径判定即为「孤儿」 | 入库时**顺带**加进 `docs/DEVELOPING.md` 文件地图或 README 文档表（**带链接**）。**不为它单独开一次改动**。⚠️ 详见报告附录「自指漂移」—— 本报告写出 `TEXT-AUDIT` 的文件名后，它就从「零提及」变成了「被提及」，**这类断言天然自毁，只写怎么量** |
| **ST4** | `src/components/ui/card.tsx` 的 `CardHeader` / `CardFooter` / `CardTitle` / `CardDescription` / `CardContent` **全仓从未被渲染**（只有 `Card` 本体在用） | 属 shadcn 风格 UI 原语**成套导出**：删掉能把「未引用导出」从 24 降到 19，代价是下次要用得重新拉一份 | **倾向不删**（登记即可）。⚠️ 若真要删，属 `src/` 改动 → **必须跑四道门禁**（lint → typecheck → test → build） |

---

### 11. U1 牵出的两条「过期判定」怎么处理（2026-09-18 第八批）

> 来源：§一 第八批。**这两条都不是新问题，是 U1 的同批产物** —— 删表让两处「在当时正确」的判定一起过期。
> 登记在这里是为了**避免下次又把它当新问题重新判断一遍**（台账 §二.7 已经踩过一次「写在已完成正文里、没进清单」的坑）。

| # | 条目（含位置） | 性质 | 动作 / 建议 |
|---|---|---|---|
| ~~**U2**~~ | ✅ **2026-09-18 已修**（用户拍板选 b）。`docs/reports/TEXT-AUDIT-2026-09-17.md:39` 判「prisma 模型数 **5 张表** ✅（… / **Feedback**）」 | 第六批审计报告**在 09-17 12:08 是对的**，14:07 的 PR #23 删表让它过期。⚠️ 这是**审计证据自己被证伪** —— 比普通文档漂移更刺眼，因为它顶着「✅」 | 仿 `CODE_REVIEW_REPORT.md` 的先例，在报告**顶部加勘误 banner**（未动正文表格）。banner 三句：① 该判定属「后发改动过期」而非漏错 + 完整时间线（`#22` 12:08 / `#23` 14:07）② 权威源只有 `schema.prisma` + 复测命令，并警告 `migrations/` 同时含 CREATE 与 DROP ③ 指回本台账 U1/U2。**保留 §二.7 S9 的写法留在原地不搬家**（台账是执行史） |
| **U3** | `docs/AUDIT-BACKLOG.md:127`（§一 第六批全过项）写「prisma **5 表** …全部命中」 | 同上：时刻正确、后被删表过期 | **不改**（与 S4 那行同原则：台账是执行史，「当初判成什么」不应追改，偏差由第八批记录在案）。此处登记仅为下次清点时不重复判断 |

---

### 12. 解析器的两个产品级缺口（2026-09-18 教学时由用户识别 → **需先规划**）

> 来源：2026-09-18 教学过程中的实测（不是推测），复现方式见下表。
> **两条都要先规划、再动手**，且都属产品能力边界，不是代码 bug。
> 实测证据（可复现）：用项目自带 `@babel/parser` 跑 `parseFile` 的**同一组配置**
> （`sourceType:"unambiguous"`, `plugins:["typescript","jsx"]`）。

| # | 条目 | 现状与证据 | 规划方向（待对齐，未实施） |
|---|---|---|---|
| **U4** | **支持边界太窄 → 缺前端通用性** | ① `SOURCE_EXT`（`worker/analyze-core.cjs:10`）只有 `.js` / `.jsx` / `.ts` / `.tsx` / `.mjs` / `.cjs` → 🔴 **`.vue` 根本不在名单**（连解析都不会尝试，纯 Vue 项目上基本无用）② **装饰器实测 FAIL**（报「需要开启 `decorators` / `decorators-legacy`」，本项目只开了 typescript + jsx）→ Angular / NestJS / TypeORM 风格项目**每个文件都进 `catch`**，影响链路整体失效 | 三条路，成本差很大：**(a) 零成本** —— README 如实声明覆盖范围，不做假承诺；**(b) 一行成本** —— `plugins` 加 `decorators-legacy`，直接解锁装饰器项目；**(c) 大工程** —— 支持 `.vue`（拆 `<script>` 块 + 行号偏移映射 + 模板引用）。**建议先 (a)+(b)，(c) 单独立项** |
| ~~**U5**~~ | ✅ **2026-09-19 已修**（见 §一 第九批）。~~**解析失败不区分原因（静默）**~~ | `parseFile`（`:282-295`）的 `catch` 一律返回三个空数组；全仓**没有任何** `parseError` 类标记 → **降级完全静默**。三种性质**完全不同**的情况被混为一谈：① 代码语法真错（用户的问题）② **我们根本不支持这种语法**（能力边界）③ 空文件 | 用户口径（2026-09-18 原话）：「**静默降级本身没有问题**，但如果是**代码类型缺少**，需要**不同的提示信息**」 → 加"失败原因"字段（至少把「我们不支持」与「你代码有错」分开），并把**未解析文件数**暴露到报告页或日志。⚠️ 与项目红线直接相关：**致命缺陷全在「少报」方向**（见 `DEVELOPING.md` §1） |

---

### 13. 安全门禁的「触发颗粒度」是仓库级、不是改动级（2026-09-18 教学提问牵出 → **需先规划**）

> 来源：2026-09-18 教学过程中的收尾提问（逐行核实结论见下表，可复现）。
> 用户 2026-09-18 原话：「**这个功能是应该有变动的代码是新增的第三方库时才会触发吧**」——
> 这是一个**合理的预期**，但**真实实现里不存在这个判断**。以下为逐行核实结论（可复现）。

| # | 条目 | 现状与证据（真实代码） | 规划方向（待对齐，未实施） |
|---|---|---|---|
| ~~**U6**~~ | ✅ **2026-09-19 已修（(a)+(b)+(c) 全做）**。安全门禁完全不看「这次改了什么」 | ① 调用点**无条件**：原 `src/lib/scheduler.ts:152` `enrichSecurity(output.result, workdir)` → 现为 `enrichSecurity(output.result, workdir, task.baseRef, task.headRef)` ② 跳过条件**只有一个**：`src/lib/security/index.ts` `if (!manifest) return;` = 仓库根目录没有 `package.json` ③ 输入是**整仓清单**：`readManifest(workdir)` 读 `package.json` + `package-lock.json` → 产出**全仓库依赖存量**，不是 diff ④ 🔴 `security/` 四文件无一处读 `changedFiles`（该字段存在但未用） | **(a) 已做** —— 卡片导语标注「全仓依赖体检，与本次改动是否碰过依赖无关」；**(b) 已做** —— 新增 `detectChangedDeps(workdir, baseRef, headRef)`（`git show <baseRef>:package.json` 比对工作区 `package.json`，纯函数 `diffDepMaps` 判定 added/upgraded/downgraded/removed），结果挂 `securityStatus.depChanges`，报告页出「本次 PR 改动依赖：新增 N · 升级 M」或「未改动 package.json」；基线不可读返 `unknown`（绝不抛错）；**(c) 已做** —— `depChanges.added` 中的包在漏洞表行加「新增」徽标 |

**为什么现状不算 bug（诚实记录另一半）**：CVE 是「**事后披露**」性质的 —— 你今天没动依赖，但上游包昨天刚被挂上新漏洞。
若只在「改了依赖」时才扫，这一整类风险**永远扫不到**（正好是 `product.md:21` 的痛点原话：「依赖带漏洞无人盯 → **合并了才发现依赖有 CVE**」）。
→ 所以「全量扫」本身站得住；**真正缺的是把颗粒度说清楚（即 (a)），以及要不要做改动级 (b)**。

---

### 14. 漏洞报告缺「相关性 / 影响」这一层（2026-09-18 教学提问牵出 → **需先规划**）

> 来源：学习者 2026-09-18 原话：「**但是这一步的意义是什么，就算返回了漏洞，但是不知道对于项目的影响有什么**」。
> 与 U6 **同族但不同轴**：U6 = **颗粒度**（仓库级 vs 改动级）；U7 = **深度**（清单 vs 影响）。两条都由同一个零成本动作缓解：**把"它是什么"说清楚**。

| # | 条目 | 现状与证据（真实代码 / 真实 UI） | 规划方向（待对齐，未实施） |
|---|---|---|---|
| ~~**U7**~~ | ✅ **2026-09-19 已修（(a)+(b) 全做）**。只给「哪个包哪个版本中招」，不给「对你的项目有什么影响」 | ① 🔴 原 UI 表头「影响范围」取的却是 `v.vulnerableVersions`（该包中招版本，如 `<4.17.21`），列名易读成"对项目的影响范围" → **已改名「中招版本」** ② 全表唯一"相关性"信号只有 `isDirect`（非直接依赖标「（传递）」）③ 🔴 运行时 / 构建时依赖此前混成一份：`readDirect` 把 `dependencies` 与 `devDependencies` 合并丢失来源 | **(a) 已做** —— 表头「影响范围」→「中招版本」；导语补「列表每条漏洞来自当前依赖树真实存在的包，不代表本次 PR 引入；中招版本是漏洞影响区间，不是本次改动影响范围」。**(b) 已做** —— `DependencyInfo` / `Vulnerability` 加 `isDev?`：`readDirect` 分出 devDependencies、`readLockfile` 读 lockfile 的 `dev` 标记、`cve-scan` 透传到 `Vulnerability.isDev`，报告页对 dev 依赖标「（dev）」。**(c)/(d) 仍规划未做**（反向索引相关性 / 真·可达性分析） |

**它答不了的三件事（要判断"影响"就必须有这三样）**：

| # | 缺什么 | 含义 |
|---|---|---|
| 1 | **可达性** | 你的代码**走不走得到**那段有漏洞的代码 |
| 2 | **运行时 / 构建时** | 这个包是**打进产物**的，还是只在构建/测试时用 → 见上方 ③，现状**两者混在一起** |
| 3 | **触发条件** | 很多漏洞要**特定用法**才成立（如原型污染要你把外部输入喂给这个库） |

**为什么不建议按「缺陷」看待（诚实记录另一半）**：这是**这一类工具（依赖漏洞扫描 / SCA）的行业默认水位** ——
`npm audit`、GitHub Dependabot 给的也是同一层的东西（哪个包 / 哪个版本 / 什么级别）。
做到"影响分析"的是少数产品（如 Snyk 的 reachability 属**付费高级能力**）。
→ 所以正确的话术是**把定位说清（(a)）**，而不是承诺"影响分析"（(d)）。
→ 📌 学习者这个提问的价值在于：**它把一个"看起来功能很全"的卡片，打回了它真实的能力层级**。

---

### 15. ⑥ 安全门禁的功能性缺失 · 统一登记（2026-09-18 教学收官时用户要求补记）

> 来源：第 4 阶单元 ⑥ 的重讲与闸门追问。用户 2026-09-18 原话：「**关于最后一个部分的功能性缺失需要记录**」。
> U6 / U7 已在 §二.13 / §二.14 详述；本节补记**两条新查出的（U8 / U9）**，并做**统一索引**，避免散落。

**⑥ 全部已知功能性缺失 · 统一索引**

| # | 缺失 | 属哪一轴 | 详述 |
|---|---|---|---|
| ~~**U6**~~ | ✅ 2026-09-19 已修（见 §二.13）| **颗粒度** | §二.13 |
| ~~**U7**~~ | ✅ 2026-09-19 已修（见 §二.14）| **深度** | §二.14 |
| **U8** | 体积检测**可能静默低估** | **准确度（🔴 漏报方向）** | 本节 |
| **U9** | **"查失败"在报告页不可见** | **可观测性** | 本节 |

| # | 条目 | 现状与证据（真实代码 + 行号） | 动作 / 风险 |
|---|---|---|---|
| ~~**U8**~~ | ✅ **2026-09-19 已修**（见 §一 第九批）。体积检测**可能静默低估** —— 🔴 **漏报方向，直接触及项目红线「少报最危险」** | ① 单包 HTTP 非 2xx → `{ bytes: 0 }`（`bundle-size.ts:59`）；catch（超时 / 网络失败）→ 同样 `{ bytes: 0 }`（`:67`）—— **两条路径都不打日志** ② `rows.filter(r => r.bytes > 0)` 把这些 0 **直接丢掉**（`:71-73`）→ `totalBytes` **少算**（`:75`）③ `packageCount: packages.length` **只数成功的**（`:80`）→ UI 那句「顶层依赖 N 个」（`page.tsx:354`）在部分失败时会**少报包数** | **(a) 把失败计数暴露出来**（"N 个包查询失败，数据不完整"）；**(b) 与 `exceeded` 门禁联动时给"数据不完整"标记** —— ⚠️ **否则"没超阈值"可能只是"压根没查全"**。与 `enrichUncertain` / `enrichSecurity` 的"静默降级"口径**冲突**：那些是"少一块不影响主结论"，这里是**在同一块里给了一个偏小的数**（性质更重） |
| ~~**U9**~~ | ✅ **2026-09-19 已修**（见 §一 第九批）。**"查失败"在报告页不可见** —— 部分失败时没有任何提示 | `security/index.ts:24-39` 两个扫描走 `Promise.allSettled`，失败只 `console.error`（**只有服务器日志能看到**）；UI 端 `page.tsx:305` 是 `{r.vulnerabilities && (…)}` → CVE 扫描失败时**整块不渲染**，读者只能靠"**怎么少了一块**"去反推 | 卡片里加**显式状态行**（如"漏洞扫描：未产出"），**不要靠缺块暗示**。📌 参照物的差距：E2E 校验清单 `docs/reports/E2E-VERIFICATION-2026-09-16.md` 的 `A10` 明确要求「非 npm 项目或失败时**明确记「未产出」**」—— **报告页目前没有做到这一条** |

> ⚠️ 另有一条属**口径失真**（非功能缺失），并入 **U7 的 (a) 零成本修正**：
> 字段名 `bundleSize` / 页面标题「构建体积」量的其实是 npm 上的 `dist.unpackedSize`（**整包解包后的大小**），
> **不等于真正打包进产物的体积**（tree-shaking 后通常远小于它）→ 名字比它实际量的东西**大**。

---

### 16. 引擎只判「对外接口」、不判「行为」；且这条边界**全仓未声明**（2026-09-18 第 0 阶补验证时牵出）

> 来源：第 0 阶闸门第 2 题。学习者答「**需要调整，因为前面的计算会影响后面的结果**」。
> 判定：**他答的是「行为轴」，问的是「接口轴」** —— 两条轴都真实存在，但**只有一条被这套工具覆盖**。
> ⚠️ 这条**不属于 ⑥ 安全门禁**（U6–U9 是），属**整个引擎的口径边界**，单独登记。

| # | 条目 | 现状与证据（真实代码 + 行号） | 规划方向（待对齐，未实施） |
|---|---|---|---|
| ~~**U10**~~ | ✅ **2026-09-19 已修（(a)+(b) 两条都做了）**（见 §一 第九批）。~~**引擎只比较「对外接口」，函数体内部实现改动完全不可见**~~ —— ~~且**文档从未声明这条边界**~~ | ① `signature()`（`worker/analyze-core.cjs:587`；函数分支 `functionSignatureText` `:576-583`）= `「async 」function(参数类型序列):返回类型` —— 🔴 **函数体根本不在签名里** ② `diffSymbols` 的判定是 `(signature(o) !== signature(n) \|\| o.type !== n.type)`（`:642`）→ 函数体改动**两条都相同** → **不产出 `modified` 条目** ③ 后果链：该符号不进变更集 → 规则引擎无输入 → AI 无输入 → **影响链路里没有它** → **全程静默**（连"这里变过"都不留痕） | **(a) 零成本（建议做）** —— 在 `product.md` 的边界/不做什么一节或 README 写一行声明：「**本工具判断的是「对外接口（契约）」是否变化；函数体内部实现改动不产生影响链路条目 —— 即使其行为可能变化**」。**(b) 可选** —— 报告页脚注同款说明。**(c) 不建议** —— 真做行为分析（需执行或符号推理，成本量级完全不同） |

**为什么这是边界、不是 bug（诚实记录）**：所有"破坏性变更检测"工具都只划**契约**这条轴 ——
改函数体不算 breaking change，这是业界通用口径（即 `semver` 语义化版本那套「哪一位该进位」的判据）。
→ 所以**边界本身站得住**；问题只在**它没有被写下来**。

🔴 **那"问题"到底在哪（2026-09-18 学习者追问「为什么会有问题」后补写 —— 上一轮没讲清）**：

> **不是"它不看函数体"有问题，是"它不看，却不说自己不看"。**

后果是两种**完全相反**的情况在报告上**长得一模一样**：

| 报告上看到 | 真实含义可能是 |
|---|---|
| 影响链路 **0 条** | ① **真查了**，确实没有调用方受影响（安全） |
| 影响链路 **0 条** | ② **这一类它压根不看**（函数体改动）→ 行为可能已经变了，调用方会出问题 |

具体例子：

```ts
// b.ts 改前： export function calc(x) { return x * 2 }
// b.ts 改后： export function calc(x) { return x * 3 }   ← 对外签名一字未动
// a.ts       ： const total = calc(price)                ← 线上金额直接翻倍
```

→ 这时报告页「影响链路」**一条都不会出现**，使用者看到"0 条"会读成"**这个 MR 很安全**"。
→ 这正是本项目自己的工程红线所指的方向：**「少报最危险」**（见 `DEVELOPING.md` §1，本项目已因此栽过三次）。

📌 **所以要记录的不是"让它去分析行为"**（那是执行/符号推理级别的大工程，也不符合"静态影响面"这一定位），
   而是 **把边界说出来**：**"0 条 ≠ 没影响；本工具只看对外接口"**。这就是 (a) 那个零成本动作的全部内容。

→ 📌 学习者这个提问的价值：**它让我们发现自己材料里那句"函数体内部重写 = 无所谓"写歪了** ——
  该说法**只在接口轴上成立**；行为轴上它并不"无所谓"（调用方拿到的结果可能变）。
  已同步修正**学习笔记**（仓库外）单元 ① 的措辞（加了「两轴对照表」）。

---

### 17. 学习 / 演示类产物移出仓库 + 一处本地泄漏处置（2026-09-18 用户口径变更）

> 用户原话：「**关于学习的部分不想合并到真实的项目源代码中**」「**不想把项目中代码污染**」。
> 触发点：G1 相关材料（路线图 / 术语表 / HTML 说明书）入库后，用户认为这属个人学习材料，不应混进项目源。
> 处置原则：**移出（保留文件）+ 只删不留史**（对已进远端的泄漏，不回改历史，直接删）。

| 项 | 原位置（仓库内，已不存在） | 现位置 | 备注 |
|---|---|---|---|
| 学习路线图 | `docs/learning/ROADMAP.md` | **仓库外**：个人学习区 `学习笔记/code-guardian/ROADMAP.md` | 曾短暂入库（当日撤回）；权威性最高的学习进度文件 |
| 规则术语表 | `docs/learning/RULES-GLOSSARY.md` | **仓库外**：同目录 | 25 条规则 + 字段的中英对照 |
| G1 HTML 说明书 | `docs/g1-spec.html` | **仓库外**：同目录 | 零外部依赖，双击即开（验收见 §二.4） |
| G1 开工过渡件 | `docs/G1-KICKOFF.md` | **仓库内已删**；**2026-09-18 已在学习区留档**（`学习笔记/code-guardian/G1-KICKOFF.md`） | 按它自己的 §六 约定（「完成即可删」）+ 用户拍板。**注意：不是"内容并入 ROADMAP"** —— 删前核对发现它有 4 块内容 ROADMAP 没有（零背景项目速览 / 范围对齐三问 / 硬约束 / 开工必读），故**存档而非丢弃**（同族丢件已两次） |
| AI 触发演示快照 | `docs/demo-ai-uncertain/`（4 文件） | **仓库外**：资料归档区 | ⬇️ 见下方泄漏条 |

**🔴 连带发现：该演示快照含真实本机路径，且已进公开远端**（发现于本次全项目排查）：

- 泄漏物：`task-result.json:13` 与 `report.html:127` 内含 `/Users/<真实用户名>/.../code-guardian/fixtures/sample-repo` —— 违反 `docs/DEVELOPING.md` §1 的**本地元数据红线**。
- 引入提交 `6351f38`（PR #8），**已推送**；截至发现时 `main = origin/main = f61a367` 仍带它。
- ⚠️ **这不是「漏网」——它早被明确评估过**：`docs/reports/e2e-logs/REDACTION-NOTES.md` §7 把它列为「已在 `origin/main` 且贯穿历史」的 3 个文件之二，当时判定严重度**低**（只露本机用户名与目录结构，**不含凭据 / 不含内网 IP**，后者经 `git log --all -S` 确认从未进过历史），因此主动选 **(A-1) 不重写历史** → 该两文件「不动」。
- 处置：**2026-09-18 修订该决定**（用户拍板「移出 + 只删不留史」）—— 仍**不重写历史**（接受该字符串留在远端旧提交里），但**文件整体移出仓库**，工作树与后续 `main` 不再包含。
  → 即：**从"留在仓库里、接受它" 改为 "移出仓库、接受历史"** —— 修订的是「留在仓库」这一半，不是「不重写历史」那一半。
- 📌 **教训（工具层，不是道德层）**：`e2e-logs/` 有「**整目录不进库**」的机制（`.gitignore:34`），所以它的红线问题在入库前就被挡住；`demo-ai-uncertain/` 没有这机制，是**先入库、后由脱敏复查发现**，而被发现时已公开，才只剩「不重写历史」这一条路。
  → **凡是"真实运行截图 / 载荷快照"这类产物，先按红线扫一遍再决定入不入库**（事前挡住 > 事后接受）。

**🔴 连带查出的一处漏修**：`README.md` 目录树 `prisma/` 行仍写「schema（**5 张表**）」，实际 `prisma/schema.prisma` 只有 **4 个 `model`**（`feedbacks` 已随 PR #23 删除）。
→ §一 第八批 **U1** 当时按 `architecture.md` 修了 4 处，**漏了 `README.md` 这第 5 处** —— 与第六批 T1/T2 同族（**按精确短语 grep 修，会漏掉换措辞的同类**：U1 找的是「5 张表」+`feedbacks`，README 那句只有「5 张表」没带表名）。
→ ✅ 本次已修为「4 张表」；复测口径同 U1：`git grep -n "张表" -- '*.md'`。

---

### 18. 2026-09-19 全功能复跑的「未验项」点名（**从报告搬进台账** —— 埋在报告里等于没有）

> 来源：`docs/reports/E2E-RERUN-2026-09-19.md` §8.1。
> 🔴 **为什么必须搬**：那份报告当时**未入库**；且即便入库，「下轮要补什么」属**活跃待办**，不是历史证据。
> 教训与 §一 第九批的元教训同源：**结论写在报告里 = 下次清点找不到**。

| 项 | 原因 | 下轮怎么做 |
|---|---|---|
| B3 并发上限 3 | 未构造 4+ 并发 | 连发 5 个任务，观察是否只跑 3 个 |
| B4 超时取消 / `failed` 态 | 未构造失败输入 | 造一个 `baseRef` 不可达的任务 |
| D2 `FileSnapshot` 缓存命中 | 该轮 `cacheHits=0` | 同仓库同 commit 跑两次，看第二次是否命中 |
| **`github-push` 事件源** | 只造了 MR / PR payload | 补一份 push payload（含 `before` / `after` / `ref`）；操作步骤见仓库外 `学习笔记/code-guardian/补验-github-push-操作步骤.md` |
| webhook 无事件头兼容路径 | 属向后兼容分支（`route.ts:78`） | 发不带 `X-GitHub-Event` / `X-Gitlab-Event` 的请求 |
| `npm run seed` / `create-fixture.sh` | 该轮 fixture 是手工造的 | 跑一次官方脚本，确认能复现 `fixtures/sample-repo` |
| 渲染层截图 | 无 UI 断言手段 | 至少对详情页五块各截一张（hydration 已于 2026-09-19 用真实浏览器验过） |
| Monaco 离线化（D4） | 与那轮范围无关 | 台账既有条目 §二.2 |
| fork 仓库 PR | 代码注释声明为 M2 已知边界 | ~~M5 前补齐~~ → **2026-09-20 更正为「如实声明为长期边界」**（M5 已交付但此项未纳入范围），见上方 D 组 D9 |

> ⚠️ 另一条**口径自纠**（同报告 §8，一并记账避免重复判断）：文档口径「**25 规则**」**已自证（2026-09-19 核）** ——
> `worker/rules.cjs` 的 `RULE_TABLE` 实际 = **25 个具名 label + `unknown` 兜底**（共 26 项），与 README / architecture / product 写的「25 条查表规则 + unknown 兜底」**一致**。
> 早先担心的「34 处 `severity` 赋值」是统计口径差异：**全文件** `severity:` 字面量还含 `runRules` 内 `renamed` / `removed` / `added` 分支的内联 result 对象，与 RULE_TABLE 的具名条目不是同一口径，**不是矛盾**。
> 结论：**README 的 25 条口径正确，无需改**；改规则后用 `node -e "Object.keys(RULE_TABLE).filter(k=>k!=='unknown').length"` 复点。

---

## 三、⛔ 明确不做（`won't fix` + 理由 + 回头条件）

| # | 条目 | 不做的理由 | 什么条件下回头 |
|---|---|---|---|
| **B1** | tsconfig `extends` 继承的 `paths` 读不到（`analyze-core.cjs:480 buildPathAliases`，代码里已自带注释承认） | 要解析 TS 配置继承链（`extends` 可指向 npm 包、可数组、可级联），成本远大于收益；两个被扫描的真实仓库都不吃 `extends` | 真要拿它扫 **monorepo** 时 |
| **B2** | barrel 文件自身被删时无法展开符号（`analyze.worker.cjs:152-170`） | 修法要把 base 侧已删文件并入可解析集 —— 动的是影响图核心数据结构，**有 B4 级回归风险**，而触发场景罕见 | 真碰到一次「删 barrel 静默漏报」的实例 → **先把样本加进「形态矩阵登记表」的 ❌ 区** |
| **E4** | README 常态化核对 | 这是**习惯**不是待办。挂在清单上只会永远显示「未完成」，且每次都要重新判断 | 若哪天希望自动化 → 做成一条 CI 检查（届时是独立决策） |
| **P2①** | 引擎被排除出 typecheck（`tsconfig.json:42`） | CJS + Babel AST 代码，开 TS 检查要大量 `any` 断言。**但代价是真实的**：引擎没有类型层保护 | 不需要回头 —— 替代措施是「样本集 + baseline 对比」双保险，属既定口径（见 `DEVELOPING.md`） |
| **P2②** | `noUncheckedIndexedAccess` 未开 | 开了数组下标全变 `T \| undefined` → **大面积改动换理论收益** | 大规模重构时顺带评估 |
| ~~**P2④**~~ | `docs/demo-ai-uncertain/` 占已跟踪 docs 的 83%（504K / 608K） | 完全不进构建产物，只影响 clone 体积（半兆以内） | ✅ **2026-09-18 已消解**：该目录（连同一个本地泄漏）整体移出仓库，见 §二.17 |
| ~~**P2⑤**~~ | 生成器 `build-report.mjs` 放在 `docs/` 下 | 零功能影响。但**会误导人以为 `docs/` 是"只放产物"的目录** | ✅ **2026-09-18 已消解**：脚本随 P2④ 一并移出，`docs/` 下不再有脚本 |
| **①** | **同一仓库的并发分析没有串行化** —— `processTask` 全程共用 `.cache/repos/<repoId>`，而 `worker/analyze.worker.cjs` 的 `checkoutHead` 就在它上面 `git checkout --force` | **非阻塞**。单次使用（触发一次分析 → 看报告）碰不到；只有**同一仓库 ≥2 个任务在分析窗口内重叠**时才触发，表现分两层：**响的**是 `persistSymbolTable` 的唯一约束报错 → 任务标红 `failed`（重试即可，且分析其实已经成功）；**不响的**是后一个任务的 `checkout` 换掉了前一个的工作区 → 前者可能读到**对方的代码树**，安静产出一份错位报告。修它要动 `scheduler.ts` 的认领逻辑或新增 repo 锁，**而并发场景难以稳定复现与断言** → 回归风险高于收益 | 要**多实例 / 高并发接入真实仓库**（同一仓库频繁突发触发）时 |
| **②** | **Monaco 未真正本地打包，仍依赖 `cdn.jsdelivr.net`** —— `next.config.ts` 的 `webpack:` 钩子在 Turbopack 下不执行，而 dev 与 `next build` 都跑 Turbopack | **非阻塞**。有网时能正常渲染（实测约 20s），只是慢；**离线 / 内网部署**下「代码 Diff」块会一直停在 `Loading...`。另：CDN 拉的是 0.55.1，与 `package.json` 固定的 0.52.2 不同版本。**不修的理由**：报告主体（风险总览 / 影响链路 / 安全门禁 / 变更符号明细）全部不依赖它，受影响的只有 Diff 这一块的可用性；两处注释已改为如实描述 | 需要**离线 / 内网演示或部署**时（按 `loader.config({ monaco })` 或自托管 `public/monaco/vs` 修，并补产物级断言：构建产物中不得出现 `cdn.jsdelivr.net`） |

> ⚠️ **口径自纠**：§二「D 组结论」里把缺陷 ① 描述成「`persistSymbolTable` 的唯一约束竞态」——**那条描述写窄了**（只写了"响的那一半"）。**以本表 ① 行为准**：真正需要串行化的是「workdir 使用 + 落库」整段。

**已执行的 P2 项**：

- **P2⑥** `.cache/`（62M，已 gitignore）→ **2026-09-16 已删除**。它不是待办，是「想省磁盘就删，会自动重建」。
- **P2③** `Feedback` 表只有读无写 → **不删表也不补 API**，改为**在文档里如实标注为「预留」**（理由：删表要迁移、补 API 要界面，两者成本都高于收益；而"说了没做"才是真问题）。

---

## 四、✅ 已处置（原「待定」于 2026-09-20 收口）

| # | 条目 | 处置 |
|---|---|---|
| 1 | GitLab Commit Status 回写验证 | ~~✅ **关闭为「外部依赖，当前环境不可验」**：缺 `GITLAB_TOKEN` + 真实 GitLab 项目（非代码缺陷）。回头条件：拿到 token + 真实项目时补验（R2 已证明 `gitlabProjectId` 能正确落库）~~ → **2026-09-20 晚更正为「已验（L3）」**：仓库外 `E2E-RERUN-2026-09-19.md:130` 记 F2「假 GitLab **收到真实 POST**，带 `PRIVATE-TOKEN` 头」= ✅ **真跑通**，该报告自定判据「**必须到 L3 才算真跑通**」。→ 原「回头条件」不必要（**验协议不需要真账号**）。见 AUD-3 |
| 2 | **AI 语义引擎在真实仓库上的可达性** | ✅ **已如实写进文档**：判定为「**符合预期**」（A3 治好了白烧 token 的形态），**不为它补样本**。文档落点：`docs/product.md §10.4` + README 已知边界表。事实：三真实仓库 × 多窗口全部 0 `uncertain`，AI 仅由合成 fixture 触发；证据 `E2E-RERUN-2026-09-17.md` §3 |

---

## 五、维护规则

1. **状态一变就改这份文件**，不要留在对话里。
2. 新增条目必须写清**代码位置**（可 grep 到）与**为什么现在要做 / 不做**。
3. `won't fix` 不是「以后做」的委婉说法。若哪天要回头，先确认「回头条件」是否真的发生了。
4. 别把「习惯」（如 E4）写成待办 —— 它永远不会变成已完成。

---

## 六、❄️ 冻结声明（2026-09-20）

**本台账自 2026-09-20 起冻结。** 冻结的含义**不是**「一个问题都没有」，而是：

> **每一条已知项都有了归属** —— 要么已实现并有实测证据，要么明确判为 `won't fix`（写清理由 + 回头条件）。

**为什么「零缺陷」不能当收工标准**（2026-09-20 这轮踩出来的）：

台账里长期的 ✅ 一直是「**我看过代码、觉得没问题**」这个口径，**从没被"有一条可复现的实测命令"定义过**。
结果是三处「写着已修、实际没生效」：

| 位置 | 写着 | 实际 |
|---|---|---|
| §二.2 Monaco | 「本地打包，消除 CDN 依赖」 | Turbopack 不执行 webpack 插件 → 仍从 jsdelivr 拉 15 个文件 |
| 并发控制 | 「信号量限 3 并发」 | 只控了"同时跑几个"，**没管"并发时数据对不对"**（→ §三 ①） |
| §二.18 九条 | 「未验项」已记账 | 搬进台账后**一次没跑**；且 D3 的判据本身是错的 |
| **§四.1 GitLab 回写**（2026-09-20 晚新增） | 「外部依赖，当前环境不可验」 | **实际早已验穿**：仓库外 `E2E-RERUN-2026-09-19.md:130` 的 F2 = **L3**（假 GitLab 收到真实 POST + `PRIVATE-TOKEN` 头）→ **反方向**：不是"写着已修、实际没生效"，而是"**写着没验、实际早验了**" |

> 📌 上表前 3 行是「**声称已完成、实际没做到**」，第 4 行是**反方向**。两者同源：**状态没跟着证据走**。
> 第 4 行更隐蔽 —— 它会让未来读者**以为这里是一片空白**，从而重复投入（本条正是被 2026-09-20 的文档审计才捞出来的）。

→ **本台账此后只接受两种合法终态**：
**① 有实测证据**（给得出可复现的命令或产物）；
**② 明确声明为已知边界**（含触发条件 + 不做的理由）。
**靠"看着没问题"写上去的 ✅ 一律不算数。**

**冻结时的状态**：§二 A 组已合并（A4 的落点后经 2026-09-20 晚补正，见 AUD-1）/ B 组已关闭 / C 组已处置（C1 终态后经同轮更正，见 AUD-3）/ **D 组 11 条已全部收口**（D1–D7 七条实测；D8 判为缺陷 ② 并转 §三；D9 / D11 两条文档声明已补；D10 判为范围外）；**§二 之下无遗留活口**。
§三 含两条本轮新增的 `won't fix`（① 同仓库并发未串行化、② Monaco 仍依赖 CDN，**均非阻塞**，理由与回头条件见该表）。
2026-09-20 晚另有 **AUD-1–AUD-11**（文档准确性全量审计收口批，见 §二 末尾）。

**解冻条件**（只有两条，避免"再清点一遍"式的空转）：
1. §三 里任一「**回头条件**」真实发生了；
2. **或** 收到一条**可复现的新证据** —— 不是"我又看了一遍代码"。

> ⚠️ **口径补充（2026-09-20 晚）**：**「记账」≠「解冻」。** 冻结保护的是 **§二 待做清单的收敛结论**
> （4 条真做 + 其余关闭），**不是**"不许再发现问题"。所以新发现的**文档错误 / 数字过期**按 §五 规则 1
> 直接落账（如 AUD 批）即属**记账**；只有**重开 §二 的待办**才算解冻。
> 否则任何一次例行审计都触发"解冻"，冻结就失去了意义。
