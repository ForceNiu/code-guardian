# 审计待办台账（Audit Backlog）

> **这份文件存在的唯一理由**：审计清单原本「没有家」——它先后住在一份不入库的交接文档里、
> 以及每次新对话的上下文里。结果是**每开一次新对话就要把整份清单重新判断一遍**（实测重复发生过 3 次，
> 其中一次还推出了一个错误的条目数）。
> 所以：**任何状态变更都就地改这份文件**，而不是留在对话里。
>
> 来源：2026-09-16 全项目审查（25 条）+ 同日新查出的 2 条静默漏报（原清单没有）。
> 口径：审计清单的职责是「**不漏**」，排序是另一件事 —— 所以下面只有三态：做 / 不做（附理由）/ 待定。

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

---

## 二、🔜 待做（按执行顺序）

### 0. 🔴 收口本分支 `fix/audit-tier1-3`（**等口头批准；当前已累积 21 处改动 + 4 个新文件**）

- 内容：commit（建议拆 3 组：引擎与样本集 / 端点与前端 / 测试与文档）→ push → PR → CI 绿 → squash merge。
- **为什么优先级标在 C 类之前**：改动长时间留在磁盘上，风险随体量线性上升（且本轮已有一次「编辑疑似未落盘」的虚惊）。
  引擎与端点改动混在一起不提交，也会让「哪一版被验证过」变得不可考。
- ⚠️ 提交前必做：PII 门禁（新增行扫 `/Users/`、内网 IP、`localhost:端口`、`/tmp/`）—— 本批已经抓到过一次
  （`next.config.ts` 注释里写了本机绝对路径）。

### 1. C 类测试缺口 · 7 个模块（**用户 2026-09-16 定为「都做」**）

| # | 模块 | 行数 | 测什么 | 难度 |
|---|---|---|---|---|
| ~~C7~~ | ~~`src/lib/security/index.ts`~~ | 40 | 「失败不阻断主链路」兜底语义 | ✅ **2026-09-16 已完成**（6 条断言，见下） |
| ~~C4~~ | ~~`src/worker/run-analysis.ts`~~ | 54 | 三条 settle 路径（message / error / exit）+ 超时 `terminate()` | ✅ **2026-09-16 已完成**（8 条断言，见下）；**并查出 N3** |
| C2 | `src/lib/persist.ts` | 95 | 快照→缓存的防御性解析；积批删范围；符号行展开 | ⏭️ **下一步**（mock `./prisma`） |
| C3 | `src/lib/enqueue.ts` | 71 | created / duplicate(P2002) / 其他错误 rethrow | 中 |
| C6 | `src/lib/ai/deepseek.ts` | 263 | 三种降级分支（代理 CONNECT / httpDirect / 失败） | 中（需 mock fetch 与环境变量） |
| C5 | `src/worker/analyze.worker.cjs` | 257 | git checkout/diff/show 的参数数组调用 | **最难**（CJS + worker 方式运行；需 tmp 仓库做集成测试）。⚠️ 但这层正是「路径引号」事故所在层 |
| C1 | `src/lib/scheduler.ts` | 197 | 编排层：原子认领 / 超时置 failed / 取消后不覆盖 done | 价值最高，fake 最多（7 个） |

**开工顺序**：~~先立测试基建 → C7 打通范式~~ ✅ **已打通** → ~~C4~~ ✅ → C2 → C3 → C6 → C5 → C1。

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

### 3. 全链路重跑（**红线要求，不可跳**）

- 引擎在本批改了 3 处（A3 / N1 / N2）→ 按项目红线，引擎大改后必须重跑一次全链路（含真实 AI 调用）。
- 成本口径：**AI 调用数 = 2 × 触发 AI 的任务数**；跑之前先确认是否处于 DeepSeek 空闲档（半价）。

### 4. G1 · 零背景读者向 HTML 项目说明书

- 状态：范围早已锁定（功能 + 架构两层里的第一层，HTML 单页，全真口径），**未开工**。
- ⚠️ **交接时的坑**：原定开场白第一句是「读 `docs/HANDOVER.md` §8」——该文件已被删除（E3），
  **开场白已失效，开新对话前必须重写**（这次命中的是文档正文里的操作指令，不是链接）。
- 价值判断：**比本台账里任何一条待办都高**——它直接对应「能不能把这个项目讲清楚」。

### 5. 文档索引同步（小，1–2 行）

- `README.md` 末尾「这份文档不够看怎么办」表里**缺 `docs/AUDIT-BACKLOG.md`**（本文件）→ 补一行。
- `README.md:120` 对 `tests/` 的覆盖描述写的是「分析核心 / 规则引擎 / AI 图谱 / 安全门禁 / webhook 适配」，
  本批新增了 **worker 生命周期（`run-analysis`）** 与 **安全门禁集成层（`security/index`）** → 顺手补上。
- ⚠️ 这正是 E4 那条「写死的清单最容易过期」的实例 —— 所以**做了就更新，不要挂成待办**。

---

## 三、⛔ 明确不做（`won't fix` + 理由 + 回头条件）

| # | 条目 | 不做的理由 | 什么条件下回头 |
|---|---|---|---|
| **B1** | tsconfig `extends` 继承的 `paths` 读不到（`analyze-core.cjs:480 buildPathAliases`，代码里已自带注释承认） | 要解析 TS 配置继承链（`extends` 可指向 npm 包、可数组、可级联），成本远大于收益；两个被扫描的真实仓库都不吃 `extends` | 真要拿它扫 **monorepo** 时 |
| **B2** | barrel 文件自身被删时无法展开符号（`analyze.worker.cjs:152-170`） | 修法要把 base 侧已删文件并入可解析集 —— 动的是影响图核心数据结构，**有 B4 级回归风险**，而触发场景罕见 | 真碰到一次「删 barrel 静默漏报」的实例 → **先把样本加进「形态矩阵登记表」的 ❌ 区** |
| **E4** | README 常态化核对 | 这是**习惯**不是待办。挂在清单上只会永远显示「未完成」，且每次都要重新判断 | 若哪天希望自动化 → 做成一条 CI 检查（届时是独立决策） |
| **P2①** | 引擎被排除出 typecheck（`tsconfig.json:42`） | CJS + Babel AST 代码，开 TS 检查要大量 `any` 断言。**但代价是真实的**：引擎没有类型层保护 | 不需要回头 —— 替代措施是「样本集 + baseline 对比」双保险，属既定口径（见 `DEVELOPING.md`） |
| **P2②** | `noUncheckedIndexedAccess` 未开 | 开了数组下标全变 `T \| undefined` → **大面积改动换理论收益** | 大规模重构时顺带评估 |
| **P2④** | `docs/demo-ai-uncertain/` 占已跟踪 docs 的 83%（504K / 608K） | 完全不进构建产物，只影响 clone 体积（半兆以内） | clone 体积极度敏感时 |
| **P2⑤** | 生成器 `build-report.mjs` 放在 `docs/` 下 | 零功能影响。但**会误导人以为 `docs/` 是"只放产物"的目录** | 下次动该脚本时顺手挪到 `scripts/` |

**已执行的 P2 项**：

- **P2⑥** `.cache/`（62M，已 gitignore）→ **2026-09-16 已删除**。它不是待办，是「想省磁盘就删，会自动重建」。
- **P2③** `Feedback` 表只有读无写 → **不删表也不补 API**，改为**在文档里如实标注为「预留」**（理由：删表要迁移、补 API 要界面，两者成本都高于收益；而"说了没做"才是真问题）。

---

## 四、❓ 待定

| # | 条目 | 缺什么前置 |
|---|---|---|
| 1 | GitLab Commit Status 回写验证 | 需要 `GITLAB_TOKEN` + 一个真实 GitLab 项目。缺口只剩最后一跳（R2 已证明 `gitlabProjectId` 能正确落库） |

---

## 五、维护规则

1. **状态一变就改这份文件**，不要留在对话里。
2. 新增条目必须写清**代码位置**（可 grep 到）与**为什么现在要做 / 不做**。
3. `won't fix` 不是「以后做」的委婉说法。若哪天要回头，先确认「回头条件」是否真的发生了。
4. 别把「习惯」（如 E4）写成待办 —— 它永远不会变成已完成。
