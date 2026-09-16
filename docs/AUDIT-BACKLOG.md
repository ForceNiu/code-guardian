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

### 2026-09-16 第四批（分支 `test/c-class-remaining` · PR #18 · squash merge · **main = `2e9b9ee2`**）

| # | 条目 | 关键点 |
|---|---|---|
| **C2** | `src/lib/persist.ts` | 10 条：事务内调用顺序、空表不进事务、3 条防御性解析（快照字段缺失/类型错乱时不炸） |
| **C3** | `src/lib/enqueue.ts` | 10 条：`deriveName` 边界、SSE publish、duplicate 不广播、缺省字段按 `??` 口径落库 |
| **C6** | `src/lib/ai/deepseek.ts` | 15 条：mock `node:https`/`node:http` 两条出网通路（代理 CONNECT / 直连）+ 请求形状 + 消息转换 + 限流退避 |
| **C5** | `src/worker/analyze.worker.cjs` | 8 条：**真实 git 仓库 + 真 Worker 线程**的集成测试（这层不能 mock，见 C5 验收证据） |
| **C1** | `src/lib/scheduler.ts` | 13 条（7 个 fake）：启停 / 卡死回收 / 原子认领 / 并发上限 / **两道 `ctrl.cancelled` 守卫**（各自可独立证伪） |
| — | 收口上一批的事故 | 删掉 `deepseek` / `scheduler` 两个无效测试；还原被砍坏的 `scheduler.ts` / `persist.ts`（与 main 一致） |

- 测试规模 **181 → 237 pass**；四道门禁（lint / typecheck / test / build）全绿；**`src/` 零改动**（只加测试 + 台账）。
- PR **#18**（https://github.com/ForceNiu/code-guardian/pull/18）2026-09-16 23:53 UTC squash merge，
  合并后 main = `2e9b9ee2`；`merge_commit_sha` 已用 `verification.payload + gpgsig` **逐字节复现并同步到本地**。
- ⚠️ 分支 `test/c-class-remaining`（head `3a75225`）在 squash 后**已「死」**（按约定保留未删）；
  后续改动一律从 main 开新分支。

---

## 二、🔜 待做（按执行顺序）

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
| ~~C4~~ | ~~`src/worker/run-analysis.ts`~~ | 54 | 三条 settle 路径（message / error / exit）+ 超时 `terminate()` | ✅ **已完成**（8 条断言，见下）；**并查出 N3** |
| ~~C2~~ | ~~`src/lib/persist.ts`~~ | 95 | 快照→缓存的防御性解析；事务内调用顺序 | ✅ **2026-09-16 已完成**（10 条断言，见下） |
| ~~C3~~ | ~~`src/lib/enqueue.ts`~~ | 71 | created / duplicate(P2002) / 其他错误 rethrow / SSE 广播 / `deriveName` | ✅ **2026-09-16 已完成**（10 条断言，见下） |
| ~~C6~~ | ~~`src/lib/ai/deepseek.ts`~~ | 263 | 三种降级分支（代理 CONNECT / httpDirect / 失败）+ 限流退避 | ✅ **2026-09-16 已完成**（15 条断言，见下）。上一版曾写过一版**假的**，已作废（见下方事故记录） |
| ~~C5~~ | ~~`src/worker/analyze.worker.cjs`~~ | 257 | git checkout/diff/show 的参数数组调用 | ✅ **2026-09-16 已完成**（8 条断言，真实 git 仓库 + 真 Worker 线程，见下） |
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

- 状态：范围早已锁定（功能 + 架构两层里的第一层，HTML 单页，全真口径），**未开工**。
- ⚠️ **交接时的坑**：原定开场白第一句是「读 `docs/HANDOVER.md` §8」——该文件已被删除（E3），
  **开场白已失效，开新对话前必须重写**（这次命中的是文档正文里的操作指令，不是链接）。
- 价值判断：**比本台账里任何一条待办都高**——它直接对应「能不能把这个项目讲清楚」。

### 5. ✅ 文档索引同步 —— 2026-09-17 已完成

- ✅ `README.md` 末尾「这份文档不够看怎么办」表补两行：**`docs/AUDIT-BACKLOG.md`**（审计清单唯一归属地）
  与 **`docs/reports/E2E-RERUN-2026-09-17.md`**（本轮复跑记录）。
- ✅ `README.md` 的 `tests/` 覆盖描述补上 **DeepSeek 客户端 / 安全门禁集成层 / 入队与持久化 / worker 生命周期 / 调度编排**。
- ✅ 顺手校验了 README 里 **8 个 md 链接全部存在**（0 个 404）—— 正是 E4 那条「写死的清单最容易过期」的实例。
- ⚠️ **这条是「习惯」不是待办，别再往回挂**：以后**改了就更新**，本行只作一次结清记录。

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
| 2 | **AI 语义引擎在真实仓库上的可达性**（2026-09-17 复跑查出） | 需要判断：这是「**符合预期**（A3 治好了 0参→有参 那类白烧 token 的形态）」还是「**规则兜底面收窄过头**」。事实：三个真实仓库 × 4 类窗口（`main~20`/`main~21`/`HEAD~10`/`HEAD~20`/`db04dd7~5`/`db04dd7~10`）**全部 0 uncertain**，AI 路径只由合成 fixture 触发。**证据**：`docs/reports/E2E-RERUN-2026-09-17.md` §3。缺的前置是**一条决策**：要不要为「真实仓库里规则兜不住的形态」补样本（进「形态矩阵登记表」）；不补则需在文档里明写「AI 引擎在当前真实语料上不触发」 |

---

## 五、维护规则

1. **状态一变就改这份文件**，不要留在对话里。
2. 新增条目必须写清**代码位置**（可 grep 到）与**为什么现在要做 / 不做**。
3. `won't fix` 不是「以后做」的委婉说法。若哪天要回头，先确认「回头条件」是否真的发生了。
4. 别把「习惯」（如 E4）写成待办 —— 它永远不会变成已完成。
