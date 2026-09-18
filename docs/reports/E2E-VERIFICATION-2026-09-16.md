# 全链路端到端验证记录（2026-09-16）

> **目的**：把「完整链路 + 真实仓库数据 + AI 语义引擎」跑通一次，并**留下可复查的证据**。
> 背景见 `docs/HANDOVER.md` §4 A2（上次全链路跑于 2026-09-03，此后引擎改了 4 轮，结论已过期）。
>
> 📌 **关于本文档里的 `docs/HANDOVER.md` 引用**：那是当时的**本地交接件**（**有意不入库**，
> 因其含本机绝对路径）。它的长期有效部分已改写为仓库内的 [`docs/DEVELOPING.md`](../DEVELOPING.md)
> —— 而「当前进度 / 待办清单」那类内容本就该过期。下文出现的 §编号属该件的**历史编号**，
> 保留原样以维持这份记录的原始性，**不是死链**（它是行内代码引用，非超链接）。
>
> **状态：✅ 全部完成 —— R1 ✅（10/10）、R2 ✅（2/2）、R3 ✅（**查出并当天修复 1 个新回归，见 B4**）；R4 ✅（9 ✅ + 1 🟡，见 §4 R4）**
>
> 🔴 **R4 跑完后修正了两处口径（都在本文档里，都是错的）**：
> ① §1.1 的「每次 `uncertain` 变更 = 1 次 DeepSeek 调用」**是错的** —— 实际是**每条任务固定 2 次**，与条数无关（证据见 §4 R4「成本模型修正」）；
> ② 因此 **R1 行的 AI 调用数被低估**（实际 **4** 次，不是 2 次），**R4 行被高估**（实际 **2** 次，不是 7 次）。
> 原估算在**两个方向上都错了** —— 这正是「估算不能替代实测」的又一例。
>
> 📄 **关于证据文件**：`e2e-logs/` 是本地跑一次即生成的原始产物（日志 / 截图 / 结果 dump），**有意不入库**（见 `.gitignore`）。
> 理由：第三方无法独立复现它们（需要本机仓库与 AI 密钥），其价值是「确实跑过」而非「可供复验」。
> 本文档正文已**逐字引用**关键日志行与逐条断言结果；要自己复现，用 `npm run scan <仓库绝对路径> <baseRef> <headRef>`。
> 另外：本文档与 `CODE_REVIEW_REPORT.md` 里的本机路径已做替换（本机用户名 → `<user>`、内网 IP → `<host-ip>`）。

---

## 0. 为什么不能只看「任务成功」

本项目两次事故都是**「输出看起来正常，其实没在工作」**。本次验证专门防这几个坑：

| 坑 | 机制 | 应对 |
|---|---|---|
| 🔴 AI 静默降级 | `enrich.ts:59` AI 失败只 `console.error`，任务照样 `done` | 断言 `suggestion` 条数 + 抓服务端 stdout |
| 🔴 没东西可跑 vs 没跑 | `enrich.ts:18` 若 0 条 uncertain 直接 return，**连日志都没有** | 显式记录初始 uncertain 数（取 scan 基线） |
| 🔴 **AI 会改写 confidence** | `enrich.ts:48-51` 把 AI 的 `severity`/`confidence` 写回 edge | **最终结果的 confidence 分布 ≠ 初始 uncertain 数**，必须与 scan 基线和日志三方对齐 |

> **第 3 条最容易翻车**，且已被实测证实：
> 拿历史 `docs/demo-ai-uncertain/task-result.json` 里**原始**的 `changedSymbols` 重放规则引擎（`runRules`，不带 AI），
> 得到**初始 `uncertain 7 / proven 2`**；而该 JSON 最终**正好 7 条带 `suggestion`** —— 完全吻合。
> 但它的最终 `confidence` 分布显示的是 `uncertain 3 / heuristic 3 / proven 3`（AI 判定后的值）。
> **结论：只看最终分布会误判成「AI 只处理了 3 条」，实际处理了 7 条。**
>
> 📌 **数据来源已于 2026-09-18 移出本仓库**（`docs/demo-ai-uncertain/` 整体迁至仓库外，见 `docs/AUDIT-BACKLOG.md` §二.17）——
> 本节的**结论与数字不受影响**（当时实测），但**无法再按原路径复现**；复现请用同期 `e2e-logs/` 或其归档位置。

**反推手段**（日志意外丢失时用）：即使只剩落库的 `changedSymbols`，也能重放规则引擎算出「初始 uncertain 数」作为参照：

```bash
node -e "
const {runRules}=require('./src/worker/rules.cjs');
const d=require('<导出或落库的 result JSON>');
const c={}; for (const cs of d.changedSymbols) { const r=runRules(cs,0); c[r.confidence]=(c[r.confidence]||0)+1; }
console.log('初始 confidence 分布:', JSON.stringify(c));
"
```
> ⚠️ 注意它只能证明「**应该**有 N 条送 AI」，**不能**证明 AI 真跑了 —— 后者必须靠服务端日志 + `suggestion` 条数。

---

## 1. 环境快照

| 项 | 值 |
|---|---|
| 分支 / HEAD | `fix/export-signature-blindspot` / `71e7d92`（+ 未提交改动） |
| 运行模式 | `npm run build` + `npm start`（**不用 dev**，dev 的 SSE 曾被沙箱代理掐断） |
| Node | v22.22.2 |
| 数据库 | Neon 云库（Docker 不可用，无法本地隔离） |
| `DEEPSEEK_API_KEY` | ✅ 已配置 |
| `WEBHOOK_SECRET` | ⬜ 空 → curl 模拟 webhook 无需签名 |
| `GITLAB_TOKEN` | ⬜ 未配置 → **GitLab 状态回写本轮仍无法验证** |
| 服务端日志 | 重定向到 `docs/reports/e2e-logs/server-<runId>.log`（**AI 真跑过的唯一硬证据**） |

### 1.1 🔴 成本约束：DeepSeek 分时定价（**跑 AI 轮次前必读**）

DeepSeek API 按**北京时间**分时计价：**空闲时段单价 = 高峰时段的一半**。

| 时段 | 区间 | 单价 |
|---|---|---|
| 🔴 高峰 | 周一至周五 **9:00–12:00**、**14:00–18:00** | 1× |
| 🟢 空闲 | 周一至周五 **12:00–14:00**、**18:00–次日 9:00**；**周六周日全天** | **0.5×** |

**执行纪律**
1. ⚠️ **所有会触发 AI 的验证轮次，必须排在空闲时段**（高峰跑就是双倍成本）。
   🔴 **2026-09-16 R4 跑完后修正**：本文原写「每次 `uncertain` 变更 = 1 次 DeepSeek 调用」——**这是错的**。
   代码 + 既有单测 + 实测三方确认：**每条任务固定 2 次 LLM 调用**（节点③ `predict` 一次 + 节点④ `suggest` 一次），
   **与 `uncertain` 条数完全无关**（所有变更打包进同一个 prompt）。详见 §4 R4「成本模型修正」。
2. 📌 **日志/记录里的时间一律用北京时间**（DB 存 UTC，`createdAt` 是 UTC，换算后才看得出踩没踩高峰）。
3. 📌 判断方法：`TZ=Asia/Shanghai date`；判据——周一至周五 `9-12` / `14-18` 为高峰，其余为空闲。
4. 📌 **不需要 AI 的轮次可在任意时段跑**（如 R2 若选 0 `uncertain` 的输入，AI 调用数 = 0，随时可跑）。

**剩余轮次的 AI 调用量清点**（据此排期）

| 轮次 | 输入 | 初始 uncertain | **AI 调用数（实测口径）** | 排期结论 / 实际执行 |
|---|---|---|---|---|
| R1 | interview-forge `main~20..main` | 1 | **2** ×2 轮 = **4**（原报 2 ❌ 低估） | ✅ 已完成（10:15 / 10:18 北京时间，**踩在高峰**，⚠️ 实际付了双倍价 × 4 次） |
| R2 | failwatch `HEAD~10..HEAD`（13 符号 / 0 uncertain） | 0 | **0** ✅ | ✅ 已完成（高峰时段，**成本影响为零**） |
| R3 | interview-forge `main~20..main` × 2 引擎对比 | 1 | **0** ✅（改用 `scan`，不走 AI） | ✅ 已完成，**成本 0** |
| R4 | sample-repo（合成） | 7 | **2**（原报 7 ❌ 高估 3.5×） | ✅ 已完成（**12:07 北京时间，空闲时段**，26.9s） |

> 🔵 **优化点**：R2 原设计未指定仓库，默认沿用 interview-forge 会白烧调用（且踩高峰）。改为指向 **0 uncertain** 的输入后，R2 变成**零 AI 调用**，彻底不受分时定价影响。
>
> 🔴 **修正后的真实成本口径（R4 实测确立）**：**AI 调用数 = 2 ×（触发了 AI 的任务数）**，**与 `uncertain` 条数无关**。
> `uncertain` 条数只影响**单次调用的 prompt 大小与耗时**，不影响调用次数。
> → 「排空闲时段」的收益是 **2 倍价差 × 2 次/任务**，而不是原先以为的「2 倍 × N 条」。

---

## 2. 断言清单（每条必须给 ✅/❌，不允许「看起来没问题」）

| # | 断言 | 判据 |
|---|---|---|
| **A1** | 任务状态机走完 | `status === done` 且 `errorMessage === null` |
| **A2** | 影响链路非空 | `impactChain.length > 0` |
| **A3** | 引擎结果与 scan 基线一致 | `changedSymbols` 集合 / `summary` 与无 AI 的 `scan` 基线逐项对上 |
| **A4** | **AI 确实被调用了** | 服务端日志出现 `[AI] uncertain 变更 N 条已由 AI 语义引擎判定完成`，且 **N == scan 基线的初始 uncertain 数** |
| **A5** | **AI 产出了真实建议** | `suggestion` 条数 **== N**（逐条，不是「大于 0」）；至少摘录 1 条原文进报告 |
| **A6** | AI 未降级 | 日志**不得**出现 `[AI] ... 判定失败，降级` 或 `未配置 DEEPSEEK_API_KEY` |
| **A7** | persist 落库 | `file_snapshots` / `export_symbols` 行数有增量；`result` 字段非空 |
| **A8** | SSE 真实推送 | `curl -N` 原始事件流存盘且含 `analyzing`/`reporting`/`done` 阶段（**绑在 R1**：真实仓库 clone+分析耗时长，有充裕观察窗口；R4 太快可能只推 `done`） |
| **A9** | 前端真界面渲染 | `/tasks/<id>` 截图（**不是离线 HTML 快照**），页内可见 task id |
| **A10** | 安全门禁 | 记录 `vulnerabilities.length` / `bundleSize.exceeded`（非 npm 项目或失败时明确记「未产出」） |

> **A4 + A5 是本次的核心**。缺任何一条，这轮就等于没验证 AI。

**证据落盘约定**（跑之前先建目录，避免事后补不上）

```
docs/reports/e2e-logs/
  server-R1.log      服务端 stdout（AI 日志唯一来源）
  sse-R1.txt         curl -N 原始 SSE 流
  shot-R1.png        /tasks/<id> 界面截图
  result-R1.json     从 DB 导出的任务 result
  ...                R4 同理
```

> 🔴 **2026-09-16 补记（提交前必读）：本目录里带「本地元数据」的文件是 8 个，不是 2 个。**
> 跑完全部轮次后逐文件扫描「本机绝对路径 / 内网 IP / 端口」，实测命中：
>
> | 文件 | 命中内容 | 原排除计划 |
> |---|---|---|
> | `result-R1.json`（417K） | `/Users/<user>`、`localhost:3200`、`127.0.0.1:65487` | ✅ 已排除 |
> | `scan-R3-interviewforge-MAIN-engine.json`（405K） | 同上 | ✅ 已排除 |
> | **`form-R4.png`** | **`/Users/<user>/WorkBuddy/AI/…` 直接渲染在输入框里**（肉眼可见） | ❌ **漏** |
> | **`server-R4.log`** | `/Users/<user>` + **内网 IP `<host-ip>`** + `localhost:3000` | ❌ **漏** |
> | **`server-R1-a9.log`** | 同上（**唯二**含内网 IP 的文件） | ❌ **漏** |
> | `result-R4.json` | `gitUrl` = 本机绝对路径 | ❌ **漏** |
> | `scan-R1-baseline.log` | argv 里的本机绝对路径 | ❌ **漏** |
> | `build-R1.log` | Next.js 构建警告里的绝对路径 | ❌ **漏** |
> | `payload-R2.json` | `git_http_url` = 本机绝对路径 ×3 | ❌ 漏（但 R2 节已**明示**这是刻意的本地路径） |
>
> → **任何要入库的文件，先跑一遍「本机路径 / 内网 IP / 端口」扫描**（本仓库 `code-guardian` 与 `interview-forge`/`failwatch` **都是公开仓库**，
> 被分析项目的源码不算泄漏，但**本地元数据算**）。处理方式与决策见 `docs/HANDOVER.md` §4 A1 行末尾。

---

## 3. 预期基线（来自本次实测的 `scan`，**无 AI**）

`scan` 绕过 scheduler，因此**不会**调 AI → 得到的是「初始」confidence 分布，正好作为 A4/A5 的参照。

| 输入 | 变更文件 | 变更符号 | 初始 confidence | 初始 uncertain | 备注 |
|---|---|---|---|---|---|
| interview-forge `main~20..main` | 40 | 5 | 1 uncertain / 4 proven | **1** | 唯一能触发 AI 的真实仓库；uncertain 是 `src/app/page.tsx#default` |
| interview-forge `main~21..main` | 待测 | 待测 | 待测 | 待测 | 深度上限（first-parent 22） |
| failwatch `HEAD~10..HEAD` | 40 | 13 | 13 proven | **0** | ⚠️ **不会触发 AI**，只验非 AI 链路 |
| code-guardian `main~5..main` | 25 | 18 | 18 proven（high 1） | **0** | ⚠️ 同上 |
| fixtures/sample-repo（合成） | 7 | 9 | **high 1 / low 8**（**7 uncertain** + 2 proven） | **7** ✅ 实测 | AI 覆盖最充分；证据 `scan-R4-baseline.log` |

**已知边界**：interview-forge 只有 29 提交、first-parent 深度 **22**，`main~22` 起必然报 `ref 不可达`（引擎会明确报错，不是静默失败）。

---

## 4. 执行轮次

### R1 · 真实仓库 + 真实数据 + AI（interview-forge） ✅ 完成

| 项 | 值 |
|---|---|
| 输入 | `interview-forge` `main~20..main` |
| 触发 | HTTP 直发 `/api/tasks`（等价首页 UI，按 `repoUrl+baseRef+headRef` 建任务；DB 记录 `source: null`） |
| 运行服务 | `npm run build`（BUILD_ID `W97zFyHBLHVc9v_o9nen7`）+ `npm start`，pid 常驻 |
| task id | `cmu3gxfhp00f2usjvn93tf5l3`（r1）/ `cmu3h17oe00mkusjv7wpr4gym`（r1b） |
| 耗时 | **36.0s** / **29.0s**（createdAt → updatedAt；两轮均值 ≈ 32s） |
| summary | `{low:4, high:0, medium:1, cacheHits:39, totalFiles:79, totalSymbols:110, changedFileCount:40, changedSymbolCount:5}`（两轮完全一致） |
| 初始 uncertain（scan 基线） | **1** |
| 最终 confidence 分布 | `proven 4 / heuristic 1`（两轮一致） |
| **suggestion 条数** | **1**（两轮一致，落在 `page.tsx#default`） |
| A1–A10 | **10 / 10 ✅** |

**断言逐条**

| # | 结果 | 证据 |
|---|---|---|
| A1 | ✅ | 两条任务 `status=done`、`errorMessage=null`；`server-R1.log` 两行 `[scheduler] 任务 … 完成` |
| A2 | ✅ | `impactChain.length = 5 > 0` |
| A3 | ✅ | 符号集合 5 == scan 基线 5；4 条 severity+confidence+impact 逐项全等；第 5 条差异为 **AI 改写**（见下表，属预期） |
| A4 | ✅ | `server-R1.log`：`[AI] uncertain 变更 1 条已由 AI 语义引擎判定完成`（出现 **2 次**，两轮各一次）；**N=1 == 基线 uncertain 1** |
| A5 | ✅ | suggestion 条数 **1 == N**（不是「>0」）；原文见下方摘录 |
| A6 | ✅ | 全日志无 `判定失败，降级`、无 `未配置 DEEPSEEK_API_KEY` |
| A7 | ✅ | `persist` 落库：interview-forge 仓库 `file_snapshots=79` / `export_symbols=110`；`result` 字段非空（40 diffs / 5 impactChain） |
| A8 | ✅ | `sse-R1b.txt` 抓到完整阶段流 `parsing → analyzing → reporting → done`（见下方说明） |
| A9 | ✅ | `shot-R1.png`：**真前端页面**（非离线快照），页内可见 task `verify-r1b`，且「AI 语义判定明细」区块渲染出 AI 原文建议 |
| A10 | ✅ | `vulnerabilities.length=13`；`bundleSize.exceeded=true`（37 个包 / 360.0 MB／最大 `next` 148.2 MB） |

**A3 逐项对账（scan 无 AI vs 全链路含 AI）**

| 符号 | scan（初始） | 全链路（含 AI） | 判定 |
|---|---|---|---|
| `src/app/page.tsx#default` | `low` / `uncertain` / 引用 0 | `medium` / `heuristic` / impacted 0 | 🔵 **AI 改写**（uncertain→heuristic、low→medium） |
| `src/lib/ai/workflow.ts#WorkflowState` | `low` / `proven` / 引用 1 | `low` / `proven` / impacted 1 | ✅ 全等 |
| `src/lib/search-ui.tsx#stripMarkdown` | `low` / `proven` / 引用 1 | `low` / `proven` / impacted 1 | ✅ 全等 |
| `src/lib/search-ui.tsx#getSnippet` | `low` / `proven` / 引用 2 | `low` / `proven` / impacted 2 | ✅ 全等 |
| `src/lib/search-ui.tsx#highlight` | `low` / `proven` / 引用 2 | `low` / `proven` / impacted 2 | ✅ 全等 |

> 汇总口径也对得上：scan `low 5`；全链路 `low 4 / medium 1`，差异恰为 AI 把 `default` 从 low 提到 medium。
> **这正是 §0 第 3 条坑的正面实例**：只看最终 confidence 分布（`heuristic 1`）会误判成「AI 只处理了 1 条」，实际就是 1 条 —— 本轮巧合相等，但机制上必须靠日志 + suggestion 条数三方对齐才能确认。

**AI 建议原文摘录**（同一输入、两轮独立调用）

| 轮次 | 长度 | 原文 |
|---|---|---|
| verify-r1 | 77 字 | 请检查 src/app/page.tsx 中 default 导出的修改，确保其仍符合 Next.js 页面组件规范且导入/类型无误，并补充渲染测试验证。 |
| verify-r1b | 100 字 | 请检查 src/app/page.tsx 默认导出页面组件的本次修改，为新增逻辑补充空值/错误处理和 SSR 兼容判断，避免在服务端渲染阶段访问 window、document 等浏览器专属 API。 |

> 🔵 **两轮入参完全相同，AI 产出文案不同（77 字 vs 100 字）→ 正面证明 AI 是真调用，不是缓存/硬编码/mock。**
> 这是比「日志有一行」更硬的证据（日志也可能是代码写死的，文案差异不可能）。

**两个非缺陷的「看起来异常」，此处备案避免下次误判**

| 现象 | 结论 | 依据 |
|---|---|---|
| `summary.cacheHits = 39`（首轮为 0） | ✅ **正常**。增量缓存命中未变更文件 | `totalFiles 79 − changedFileCount 40 = 39`，算术精确闭合；interview-forge 仓库在库已有 79 条 `file_snapshot`，hash 匹配即命中。首轮 `e2e-r1-realdata` 的 `cacheHits` 正是 **0**，第二轮起变 39 |
| SSE 首次探测只抓到 `connected` 一行 | ✅ **操作失误，非产品缺陷**。已复测证实 | 首次用 `(curl -sN … &)` 子 shell，工具调用返回时 curl 被回收；改用长驻命令 + 实时 `while read` 后抓到完整 `parsing→analyzing→reporting→done`（`sse-R1b.txt`） |

**证据文件**：`docs/reports/e2e-logs/{server-R1.log, server-R1-a9.log, sse-R1b.txt, shot-R1.png, result-R1.json, scan-R1-baseline.log, post-R1.json, post-R1b.json}`

### R2 · webhook 适配器（补上唯一 0 覆盖入口） ✅ 完成

| 项 | 值 |
|---|---|
| 触发 | `curl -X POST /api/webhook` + `x-gitlab-event: Merge Request Hook` + 真实结构 MR payload |
| **输入（选定）** | **failwatch `HEAD~10..HEAD`**（13 符号 / **0 uncertain**）—— 理由见下 |
| **AI 调用数** | **0** → 🟢 **不受高峰/空闲定价影响，任意时段可跑** |
| payload 证据 | `docs/reports/e2e-logs/payload-R2.json`（真实 GitLab MR 事件结构，含哨兵值） |
| 执行时点（北京时间） | **2026-09-16 10:42–10:44** 🔴 **高峰**（但 AI 调用数=0，**成本影响为零**） |
| task id | `cmu3hxau90002usx9gtcumq5k`（**唯一一个**，两次 POST 复用同一 id） |
| 耗时 | **15.7s**（无 AI 调用，比 R1 的 36s 快一半以上） |
| summary | `{low:12, high:0, medium:1, cacheHits:0, totalFiles:52, totalSymbols:75, changedFileCount:40, changedSymbolCount:13}` |
| A 断言 | **2 / 2 ✅** |

**断言结果**

| # | 断言 | 结果 | 证据 |
|---|---|---|---|
| R2-1 | 适配器正确映射字段 | ✅ | 见下方逐字段对账表，**7 个字段全对** |
| R2-2 | 幂等（同 payload 二次 → `duplicate`） | ✅ | 首次 `HTTP 201 {"status":"created"}`；二次 `HTTP 200 {"status":"duplicate","taskId":"cmu3hxau90002usx9gtcumq5k"}` —— **taskId 完全一致，未新建任务** |

**字段逐项对账（payload 哨兵值 → DB 实际落库值）**

| payload 字段 | 期望 | DB 实际（`tasks` 行） | 结果 |
|---|---|---|---|
| `object_attributes.iid` | `4207` | `mrId = "4207"` | ✅ |
| `object_attributes.last_commit.id` | `59285ed…` | `commitSha = 59285edde5d79201e557e1e96bb4ebad6b6f619a` | ✅ |
| `object_attributes.target_branch` | `HEAD~10` | `baseRef = "HEAD~10"` | ✅ |
| `object_attributes.source_branch` | `HEAD` | `headRef = "HEAD"` | ✅ |
| `x-gitlab-event` 请求头 | `gitlab-mr` | `source = "gitlab-mr"` | ✅ |
| `project.id` | `990016` | `gitlabProjectId = "990016"` | ✅ 🔵 **首次非 null** |
| `project.git_http_url` | 本地绝对路径 | `repositories.gitUrl = "/Users/<user>/WorkBuddy/AI/failwatch"` | ✅ |

> 🔵🔵 **`gitlabProjectId` 首次写入成功**：`docs/HANDOVER.md` §4 曾把「`gitlabProjectId` 全 null」
> 列为**无法验证 GitLab 状态回写**的原因之一。R2 证明 **webhook → 适配器 → 落库这条链是通的**，
> 该字段能正确写入。剩余缺口**只剩最后一跳**：把 commit status 真正回写到 GitLab（需 `GITLAB_TOKEN` + 真实项目）。

**成本验证（本轮的核心目的之一）**

| 检查项 | 期望 | 实际 |
|---|---|---|
| 服务端 `[AI]` 日志行数 | **0** | **0** ✅（`server-R2.log`） |
| 结果中 `suggestion` 条数 | 0 | 0 ✅ |
| `impactChain` confidence 分布 | 13 proven / 0 uncertain | **13 proven / 0 uncertain** ✅ |
| 降级 / 未配置告警 | 无 | 无 ✅ |

> ✅ **结论：R2 在高峰时段执行，AI 调用数为 0，成本影响为零。** 这验证了 §1.1 的排期策略有效——
> 把「与 AI 无关的验证」挑出来用 0-uncertain 输入跑，就完全绕开了分时定价。
> 附带发现：无 AI 调用时耗时 15.7s，有 AI 时 36.0s，**AI 往返约占单次分析耗时的一半**。

**基线一致性**：`changedSymbolCount = 13`、`diffs = 40`，与 §3 的 failwatch scan 基线（13 符号 / 40 文件）**完全一致** ✅。

> 🔵 **为什么改用 failwatch 而不是 interview-forge**：R2 验的是 **webhook 适配器的字段映射与幂等**，
> 与 AI 语义引擎无关。用 interview-forge（1 uncertain）会额外触发 **1 次 DeepSeek 调用**——
> 既无验证价值，又可能踩高峰付双倍。改用 **0 uncertain** 的输入后 R2 变成零 AI 调用，
> **验证目标完全不受影响**（适配器映射出的 base/head 照样能验证正确性），成本归零。
> ⚠️ 副作用：R2 因此**不能**顺带验证「webhook 入口 → AI」这一段；该段已由 R1 覆盖，无需重复。

**执行要点（已于本轮逐条落实/核实）**
- ✅ payload 为**真实 GitLab MR 事件结构**（`object_kind` / `object_attributes.source_branch` / `target_branch` / `last_commit.id`、`project.id`、`project.git_http_url`、`user` / `repository` / `labels` 等）。
- ⚠️ **诚实标注（重要）**：`project.git_http_url` 填的是**本地绝对路径**（否则 worker 无法 clone），
  且 `source_branch` / `target_branch` 用的是 **git ref 表达式**（`HEAD` / `HEAD~10`）而非真实分支名
  （failwatch 的 feature 分支 `chore/ci-actions-and-docs` 合完即被删除，本地只剩 `main`）。
  → 所以这是「**真实结构的 payload + 本地仓库 + ref 表达式**」，**不是真实平台投递**，**也未经受真实平台签名/重试/乱序**。
- ✅ `WEBHOOK_SECRET` 为空 → 无需签名；**这也意味着没有验证鉴权路径**（风险已在 README 标注）。**本轮仍未验证鉴权**。
- ✅ 幂等验证：同一 payload 发两次，第二次返回 `status: "duplicate"`（命中 `@@unique([repoId, mrId, commitSha])`）。

**证据文件**：`docs/reports/e2e-logs/{payload-R2.json, webhook-R2-first.txt, webhook-R2-second.txt, server-R2.log}`

### R3 · 真实仓库 baseline 对比（验证签名盲区修复） ✅ 完成 —— **并查出 1 个新回归**

> **实测所用方法（比原计划更安全、且零 AI 成本）**：
> ① 用 **外科式 stash**（`git stash push -- <2 个引擎文件>`）代替 `git stash push -u`
> ——只回退 `src/worker/analyze-core.cjs` 与 `src/worker/rules.cjs`，**保留** `scripts/scan-repo.cjs` 与 `package.json` 的 `scan` 脚本
> → **绕开了原计划警告的「baseline 阶段 scan 不可用」那个坑**。
> ② 用 **`npm run scan`（不走 HTTP、不调 AI）** 代替跑全链路 → **AI 调用数 0，零成本**。

**核心结论：修复的预期收益成立 ✅**

| 输入 | baseline（main 引擎） | 修复后（当前） | 判定 |
|---|---|---|---|
| interview-forge `main~20..main` 变更符号数 | **4** | **5** | ✅ 修复多检出 1 个 |
| `src/app/page.tsx#default` 是否检出 | ❌ 无（4 条里没有它） | ✅ 有（`low/uncertain`） | ✅ **修复的预期收益确认** |
| 初始 uncertain | **0** | 1 | — |
| **AI 调用数** | **0**（无 uncertain → 不调 AI） | 1（R1 已花） | 🟢 **R3 实际成本 = 0** |

> 📌 原文档把 baseline 的 AI 调用数预填为 1，**实测是 0** —— 因为修复前 `page.tsx#default` 根本检不出来，
> 自然没有 uncertain 可送 AI。**这反过来也是「漏检」的一个旁证**。

**⚠️ 副产物：查出 1 个新回归（`sample-repo` fixture 对比）**

用同一个 fixture 对比两个引擎，差异远比预期大：

| 输入 | baseline（main 引擎） | 修复后（当前） | 差值 |
|---|---|---|---|
| `fixtures/sample-repo f10727a..45ea160` 变更符号数 | **9**（7 uncertain / 1 high / 1 low-proven） | **4**（2 uncertain / 1 high / 1 low-proven） | **−5** 🔴 |

**丢失的 5 个符号，规律极其整齐 —— 全都是「带参数的 `export function` → `export const` 箭头函数」转换：**

| 符号 | 参数个数 | main 引擎 | 修复后 | 原因 |
|---|---|---|---|---|
| `src/utils/math.ts#add` | 2 | ✅ `uncertain` | ❌ **漏** | 见下 |
| `src/utils/format.ts#formatPrice` | 1 | ✅ `uncertain` | ❌ **漏** | 同上 |
| `src/services/api.ts#fetchUser` | 1 | ✅ `uncertain` | ❌ **漏** | 同上 |
| `src/services/cart.ts#calcTotal` | 2 | ✅ `uncertain` | ❌ **漏** | 同上 |
| `src/pages/checkout.tsx#CheckoutPage` | 2 | ✅ `uncertain` | ❌ **漏** | 同上 |
| `src/pages/home.tsx#HomePage` | **0** | ✅ `uncertain` | ✅ 仍检出 | 见下（**碰巧**） |
| `src/utils/status.ts#OrderStatus` | — | ✅ `uncertain` | ✅ 仍检出 | enum 走独立分支 |
| `src/utils/math.ts#multiply` | 3（加可选参数） | ✅ `proven` | ✅ `proven` | 参数变化仍能检出 |
| `src/utils/format.ts#formatDate` | — | ✅ `high/proven` | ✅ `high/proven` | removed 分支不受影响 |

**根因（已定位到代码）**：`src/worker/analyze-core.cjs` 的 `signature()`（第 519–523 行）

```js
function signature(sym) {
  if (sym.type === "function") return functionSignatureText(sym);          // ← 老写法
  if (Array.isArray(sym.params) && sym.params.length) return functionSignatureText(sym);
  //                                                     ↑ 新写法（const 箭头函数）也走这里
  ...
  return sym.type;   // ← 只有 0 参数才会落到这里，返回 "variable"
}
```

- **带参数时**：`import function add(a,b)` 与 `export const add = (a,b) => …` 算出的签名**是同一个字符串** →
  `diffSymbols` 第 564 行的 `signature(o) !== signature(n)` 判为 **false** → **判定「无变化」，静默丢弃**
- **0 参数时**：老写法走函数签名（`function():string`）、新写法落到 `sym.type`（`"variable"`）→ 两者不同 → 才被检出
  → 所以 `HomePage` 是**碰巧**被检出的，不是因为逻辑正确

**为什么 139 个单测全绿却没拦住**：测试只覆盖了「**同一种写法内部**的参数变化」
（`const`→`const`、`default function`→`default function`，见 `tests/analyze-core.test.cjs:820,832`），
**没有任何一条断言「跨写法的导出种类变化」必须被检出**。
→ 又是「**少报方向 + 单测只验证『该报的报了』**」这个本项目已经栽过两次的坑，**第三次**。

**影响面评估**：React 项目里把 `export function C(){}` 改写成 `export const C = () => {}` 是**极常见的重构**，
所以这个漏检的覆盖面很大。注意它**不是纯粹的噪音削减**：
`function` 声明有提升（hoisting），`const` 箭头函数没有（存在 TDZ），且 `this` 绑定与可构造性都不同，
所以这**确实是一类语义变更** —— 原设计把它归为 `uncertain`（交 AI 判断）是合理的，**现在变成完全不可见**。

**修复方向（待批准，本轮未改代码）**：最小改动是在 `diffSymbols` 的判定里补上「导出种类变化」：
`signature(o) !== signature(n) || o.type !== n.type`。
⚠️ 按本项目方法论，**必须先补一条「已知缺陷样本集」式断言**（`export function` → `export const` 同参数**必须检出**），
否则改完仍可能再漏。**注意别破坏既有测试**：`tests/analyze-core.test.cjs:854`「纯语法重构不误报」依赖 `type` 相同，应不受影响（需实测确认）。

**执行要点 / 坑（已于本轮落实）**
- ✅ **改用外科式 stash + `scan`**，两个坑同时绕开：baseline 阶段 scan 可用、且**零 AI 调用**。
- ✅ 还原后校验：两个引擎文件 SHA-256 **逐字节与操作前一致**、`git stash list` 为空、`git status --short` 与操作前完全相同 → **零丢失**。
- 📌 未跑「修复后」的完整链路：R1 已经在同一输入（interview-forge `main~20..main`）上跑过修复后版本（5 符号 / 1 uncertain），直接复用，**不必重复烧 AI**。

**✅ B4 修复与复验（2026-09-16 当天完成）**

修法：`diffSymbols` 的判定从 `signature(o) !== signature(n)` 改为
`signature(o) !== signature(n) || o.type !== n.type`，并更新 `rules.cjs` 中「理论不会到」的过时注释。

**流程严格按「已知缺陷样本集」方法论走 —— 先补断言跑到红，再改代码：**

| 步骤 | 结果 |
|---|---|
| 1. 先补 4 条断言（含 1 条「同种类同签名纯重写不误报」的防过度修复断言） | 跑出 **`0 !== 1`** 🔴 —— `diffSymbols` 对该变更返回 0 条，**精确复现缺陷** |
| 2. 改代码 | — |
| 3. 复跑测试 | **101/101 → 全绿**（两个引擎测试文件） |
| 4. fixture 复验 | **4 → 9 个变更符号**，与 main 引擎 baseline **逐条逐级完全一致**（`formatDate` high/proven、`multiply` proven、7 条 `uncertain`） |
| 5. interview-forge 复验 | **仍为 5 个符号** —— **修复收益没有丢失** ✅ |
| 6. 四道门禁 | lint ✅ / typecheck ✅ / **test 143 全绿** / build ✅ |
| 7. 防回归确认 | `analyze-core.test.cjs:854`「纯语法重构不误报」**未被破坏**（`type` 相同的场景不触发新条件） |

> 🎯 **结论：无取舍（no trade-off）** —— 既拿回了被回归丢掉的 5 个符号，又保住了签名修复本身的收益。
> `0 参数` 形态（`export function tick()` → `export const tick = () => {}`）也补了断言，实测同样被检出。

**证据文件**：`docs/reports/e2e-logs/{scan-R3-interviewforge-MAIN-engine.json, scan-R3-fixture-MAIN-engine.json, scan-R1-baseline.log}`

### R4 · AI 批量处理能力（sample-repo） ✅ 完成 —— **9 ✅ + 1 🟡（口径瑕疵，非功能失败）**，并**修正了本文档的成本模型**

> ⚠️ 本条曾因 B4 回归「前置失效」。**B4 已修复并复验**（见上），fixture 实测回到 **7 条 uncertain** → 前置确认恢复。

| 项 | 值 |
|---|---|
| 输入 | `fixtures/sample-repo`（合成） |
| refs | **`f10727a`（base） / `45ea160`（head）** ✅ |
| 触发方式 | **真实浏览器填首页表单 → 点「开始分析」**（本次没走 HTTP 直发；UI 路径本身也是被验证对象） |
| task id | `cmu3ky30x0001usly5iocswwl` |
| 执行时点（北京时间） | **2026-09-16 12:07:41 → 12:08:08** 🟢 **空闲时段** |
| 耗时 | **26.9s**（createdAt → updatedAt） |
| 阶段时间线（浏览器实测） | `analyzing` +0.8s → `reporting` +22.8s → `done` +24.6s |
| 初始 uncertain（scan 基线） | **7** ✅（与预期完全一致） |
| summary | `{low:6, high:2, medium:1, cacheHits:0, totalFiles:7, totalSymbols:9, changedFileCount:7, changedSymbolCount:9}` |
| 最终 confidence 分布 | `proven 8 / heuristic 1`（AI 把 7 条 uncertain 全部改写了 confidence） |
| **suggestion 条数** | **7** ✅（== 初始 uncertain 7，逐条） |
| A1–A10 | **9 ✅ + 1 🟡**（未给 ✅ 的只有 A9 的严格字面口径 —— 见下，**不是功能失败**） |

**断言逐条**

| # | 结果 | 证据 |
|---|---|---|
| A1 | ✅ | `status=done`、`errorMessage=null`；`server-R4.log`：`[scheduler] 任务 cmu3ky30x0001usly5iocswwl 完成：9 个符号变更，2 高危 / 1 中危 / 6 低危` |
| A2 | ✅ | `impactChain.length = 9 > 0` |
| A3 | ✅ | 符号集合 **9 == scan 基线 9**；**AI 未触碰的 2 条逐项全等**（`formatDate` high/proven、`multiply` low/proven）；**7 条差异全部是 AI 改写**，且差异集合与「被送审集合」**精确一一对应，无游离差异** |
| A4 | ✅ | `server-R4.log`：`[AI] uncertain 变更 7 条已由 AI 语义引擎判定完成`，**N=7 == scan 基线 uncertain 7**（**精确相等**） |
| A5 | ✅ | `impactChain` 中带 `suggestion` 的 **7 == N**；7 条内容**各自贴合对应符号语义**（见摘录），非模板套话 |
| A6 | ✅ | 全日志无 `判定失败，降级`、无 `未配置 DEEPSEEK_API_KEY` |
| A7 | ✅ | `sample-repo` 落库 `file_snapshots=7` / `export_symbols=9`（**与 summary `totalFiles/totalSymbols` 精确相等**）；最新 snapshot `updatedAt=2026-09-16T04:08:07.872Z` = 北京 12:08:07 → **正是本次写入**；`result` 非空 |
| A8 | ✅ **超出预期** | `sse-R4.txt` 抓到**完整阶段流**：`connected → parsing → analyzing → heartbeat → reporting → done → heartbeat`。原文档预判「R4 太快可能只推 `done`」，**实测反而比 R1 更完整**（R1 是复测 R1b 才拿全） |
| A9 | 🟡 | **真前端**（非离线快照）✅：`shot-R4.png` + `shot-R4-top.png` + **文本级证据** `report-page-R4.txt`（渲染文本 6620 字，含 5 阶段步进条、风险总览 2/1/6、逐行 AI 建议）。**但严格按 A9 字面「页内可见 task id」——页内可见的是 MR 编号 `#verify-r4` 与 base/head ref，主键 cuid 本身不出现**（R1 也是靠 mrId 满足的，口径一直如此，此处如实标注，不凑 ✅） |
| A10 | ✅ | `vulnerabilities.length = 30`；`bundleSize.exceeded = false`（`totalBytes` 1,772,211／阈值 100MB；包仅 2 个：`lodash@4.17.15` 1.40MB、`axios@0.21.1` 0.37MB —— **正是 fixture 那个 commit 新引入的依赖**，检测到的是真实变化） |

**A3 逐条对账（scan 无 AI vs R4 全链路含 AI）**

| 符号 | scan（初始） | R4（含 AI） | 判定 |
|---|---|---|---|
| `src/utils/format.ts#formatDate` | `high` / `proven` | `high` / `proven` | ✅ 全等（规则引擎，**未送 AI**） |
| `src/utils/math.ts#multiply` | `low` / `proven` | `low` / `proven` | ✅ 全等（规则引擎，**未送 AI**） |
| `src/utils/status.ts#OrderStatus` | `low` / `uncertain` | **`high` / `proven`** | 🔵 AI 改写（**low→high 大幅升级**，见 Finding 2） |
| `src/pages/home.tsx#HomePage` | `low` / `uncertain` | `medium` / `heuristic` | 🔵 AI 改写 |
| `src/pages/checkout.tsx#CheckoutPage` | `low` / `uncertain` | `low` / `proven` | 🔵 AI 改写 |
| `src/services/api.ts#fetchUser` | `low` / `uncertain` | `low` / `proven` | 🔵 AI 改写 |
| `src/services/cart.ts#calcTotal` | `low` / `uncertain` | `low` / `proven` | 🔵 AI 改写 |
| `src/utils/format.ts#formatPrice` | `low` / `uncertain` | `low` / `proven` | 🔵 AI 改写 |
| `src/utils/math.ts#add` | `low` / `uncertain` | `low` / `proven` | 🔵 AI 改写 |

> 🔵 **7 条差异 == 7 条被送 AI 的边，且只有这 7 条差异** —— 这是比 R1 更强的 A3 证据。
> R1 只有 1 条 uncertain（恰好也是 1 条差异），「差异集合 == 送审集合」在 R1 里**是巧合**，在 R4 里是 **7 对 7 的结构性吻合**。
>
> 🔵 **一个正面发现：AI 补上了规则引擎漏判的真实破坏性变更。**
> `OrderStatus`（fixture 那个 commit 明确写了「enum 顺序」调整）被规则引擎判 `low/uncertain`，
> AI 判为 **`high`**，并给出「立即回滚或修正 OrderStatus 的枚举/映射，为未知状态设置安全默认值」。
> 枚举顺序调整会让**数值型持久化数据错位**，确实是 breaking change ——
> **这正说明「规则能定的不送 AI、定不了的才送 AI」这个分诊策略是有价值的，不是纯成本负担。**

**A5 七条建议原文（逐条贴合符号语义，非模板套话）**

| 符号 | 定级 | 建议原文 | 字数 |
|---|---|---|---|
| `src/pages/checkout.tsx#CheckoutPage` | low/proven | 在 CheckoutPage 中补充提交前校验与空购物车拦截，并为该分支添加回归测试。 | 43 |
| `src/pages/home.tsx#HomePage` | medium/heuristic | 人工复核 HomePage 的修改点，为新增渲染分支添加空数据兜底与错误边界后再合并。 | 43 |
| `src/services/api.ts#fetchUser` | low/proven | 在 fetchUser 中统一捕获网络异常和 HTTP 错误，返回明确错误对象并补充对应单测。 | 47 |
| `src/services/cart.ts#calcTotal` | low/proven | 修正 calcTotal 对空数组、NaN 和折扣计算的边界处理，并补充单元测试。 | 41 |
| `src/utils/format.ts#formatPrice` | low/proven | 在 formatPrice 中处理 null、NaN 和负数输入，并固定货币小数位精度后加测试。 | 48 |
| `src/utils/math.ts#add` | low/proven | 修复 add 的浮点精度或类型转换问题，并添加边界值单元测试。 | 31 |
| `src/utils/status.ts#OrderStatus` | high/proven | 立即回滚或修正 OrderStatus 的枚举/映射，为未知状态设置安全默认值并补充测试。 | 45 |

> ✅ **「逐条贴合」比「条数对」更硬**：7 条建议分别提到空购物车 / 渲染分支兜底 / HTTP 错误对象 / 空数组与折扣 /
> 货币精度与负数 / 浮点精度 / 枚举映射 —— 与各符号真实语义**一一对应**，且**长度各不相同**（31–48 字）。
> 这排除了「同一条建议复制 7 遍」与「缓存返回」两种伪造可能。

**🔴 成本模型修正（R4 的额外产出；与 AI 质量无关，但与所有后续排期有关）**

本文 §1.1 原写「每次 `uncertain` 变更 = 1 次 DeepSeek 调用」。**实测 + 代码 + 既有单测三方确认：这是错的。**

| 证据 | 内容 |
|---|---|
| 既有单测（**权威**） | `tests/semantic-graph.test.ts:90-91`：注释「管线应恰好调两次 LLM：一次 predict + 一次 suggest」，断言 `assert.equal(mock.calls.length, 2)`（输入是 2 条变更） |
| 代码 | `semantic-graph.ts:219-232` 建的图**只有 2 个 LLM 节点**（`predict` / `suggest`；另 2 个 `restate`/`retrieve` 是纯函数）；`analyzeUncertainChanges`（`:235-243`）是**一次** `graph.invoke({ changes })`，**没有任何按条循环** |
| 实测 | R4：**7** 条 uncertain → 服务端只有 **1** 行 `[AI] uncertain 变更 7 条已由 …判定完成`；总耗时 26.9s —— 若真按 7 次串行调用，不可能在 27s 内连同仓库分析一起跑完 |
| 交叉印证 | R1（1 条）与 R4（7 条）**都是 2 次调用** → 条数 1→7，调用次数**不变** |

**修正后的口径**：`AI 调用数 = 2 × 触发了 AI 的任务数`，与 `uncertain` 条数无关（条数只影响 prompt 大小与耗时）。

**连带修正**：本文原表把 R1 记为「1 次 ×2 轮 = 2」，实际是 **2 × 2 = 4**（**低估**）；把 R4 记为 7，实际是 **2**（**高估 3.5×**）。

**🟡 Finding 2：`confidence` 字段被 AI 判定「稀释」（设计观察，非 bug）**

- 现象：7 条 AI 判定里 **5 条拿到 `confidence: "proven"`**，其中 `OrderStatus` 是 `high/proven`。
- 机制：`enrich.ts:48-49` 把 AI 返回的 `severity` / `confidence` **无条件写回** edge；
  而 `semantic-graph.ts:72` 的 zod schema **显式允许** AI 输出 `"proven"`，提示词（`retrieve()`）也向 AI 定义了 `proven = 变更自身即证据，可直接作为门禁`。
- 所以这是**按设计发生的**（有单测覆盖，不是回归）。但后果是：
  **调用方无法再从 `confidence` 区分「规则引擎的确定性证明」与「AI 的自我评估」** —— 两者都写 `proven`。
  下游（报告页、以及任何拿 `proven` 当门禁判据的逻辑）会把它当成确定性结论。
- 建议（二选一，**均未实施，待决**）：
  ① **收窄 AI 侧取值域**：`judgmentSchema.confidence` 改为 `z.enum(["heuristic", "uncertain"])`
     —— 即「AI 只能表达经验判断，不能自称 proven」；
  ② 或**保留取值域但增加来源字段**：edge 上加 `judgedBy: "rule" | "ai"`，让下游按来源而非置信度做门禁决策。
- 定级依据：属**语义边界问题**，不是「输出看起来正常其实没在工作」那一类静默失效 →
  优先级低于 B4/A3，但**必须在有人拿 `proven` 当门禁之前解决**。

**证据文件**：`docs/reports/e2e-logs/{server-R4.log, sse-R4.txt, post-R4.json, result-R4.json, taskid-R4.txt, form-R4.png, shot-R4.png, shot-R4-top.png, report-page-R4.txt, ui-msg-R4.txt, scan-R4-baseline.log}`

**前置失效的成因（留档备查，已闭环）**

1. 🔴 **新回归（主因）**：R3 查出的「`export function` → `export const` 被静默丢弃」，把 fixture 里 7 条 uncertain 打掉了 5 条
   → 只剩 2 条。**已修并复验**（见 §4 R3 的 B4），R4 实测回到 **7** ✅。
2. ⚠️ **fixture 已被重新生成，历史 commit 失效**：原计划用的 `base=ad7db866…` / `head=e50fe3c4…` **在当前库里已不存在**
   （`git rev-parse` 报 `fatal: Needed a single revision`）。当前 fixture 的 ref 是 **`f10727a`（base）/ `45ea160`（head）**，R4 已实测确认有效。

> 附：历史残留标记 —— 本条原设计为**回归基线**（2026-09-03 同一输入跑过）。
> 该基线的价值**已由 R3 的 fixture 对比提前兑现**：它正是发现新回归的那把尺子。

---

## 5. 汇总

| Run | 输入 | 触发 | task id | 状态 | uncertain | suggestion | A 断言通过数 |
|---|---|---|---|---|---|---|---|
| **R1** | interview-forge `main~20..main` | HTTP `/api/tasks`（等价 UI） | `cmu3gxfhp00f2usjvn93tf5l3` / `cmu3h17oe00mkusjv7wpr4gym` | ✅ done | 1（基线） | **1** ✅ | **10/10** |
| R2 | failwatch `HEAD~10..HEAD` | webhook `POST /api/webhook`（GitLab MR 事件头） | `cmu3hxau90002usx9gtcumq5k` | ✅ done | 0 | **0**（无 AI）✅ | **2/2** |
| R3 | interview-forge `main~20..main` × 2 引擎 + sample-repo fixture × 2 引擎 | `npm run scan`（不调 AI） | — | ✅ 完成 | 0（main）/ 1（修复后，R1 已花） | — | **成本 0** ✅ |
| **R4** | sample-repo（合成，`f10727a..45ea160`） | **首页 UI 手动触发（真实浏览器）** | `cmu3ky30x0001usly5iocswwl` | ✅ done | **7**（基线） | **7** ✅ | **9 ✅ + 1 🟡** |

> 📌 **AI 调用数的真实口径（见 §1.1 修正）**：任务只要触发 AI 就固定 **2 次** LLM 调用，**与 `uncertain` 条数无关**。
> 本表「uncertain」列是**送审条数**，**不是调用次数**：R1 = 2×2 轮 = **4 次**；R4 = **2 次**；R2 / R3 = **0 次**。

---

## 6. 本轮明确**未**覆盖（写清边界，避免下次误当「全跑过」）

| 项 | 原因 |
|---|---|
| GitLab Commit Status **回写** | 无 `GITLAB_TOKEN`，且无真实 GitLab 项目。**注意**：R2 已证明 `gitlabProjectId` 能正确落库（见 R2 节），所以缺口**只剩最后一跳** |
| webhook **鉴权路径** | `WEBHOOK_SECRET` 为空 → 代码跳过校验，**401 分支从未被执行**（R2 也未能覆盖） |
| 真实平台**投递**行为 | R2 是「真实结构 payload + curl 直发」，未经过真实 GitLab 的签名头 / 重试 / 乱序 / 事件重复投递 |
| GitHub push / PR 适配器 | 本轮只覆盖 GitLab MR（可选补，需构造 `X-Hub-Signature-256` 签名） |
| 生产环境 SSE（Vercel 部署） | 只在本地 `npm start` 验证 |
| 大仓库性能 | 未选 interview-notes（35k 文件，clone 极慢） |

---

## 7. 裁决

### R1 + R2 + R3 各轮结论（留档）

**R1（真实仓库 + 真实数据 + AI）**

- **结论**：「完整链路 + 真实仓库 + AI 语义引擎」在 2026-09-16 **确实跑通了**，且 AI 是真调用（文案非确定性为硬证据）。
  `docs/HANDOVER.md` §4 A2 的旧口径「最近一次跑于 09-03、结论已过期」**现已刷新** —— 引擎经 #13/#14/#15 + 签名盲区四轮改动后，全链路依然可用。
- **AI 链路是否可信**：✅ 可信但不完美。N=1 送审、1 条建议产出、无降级；两轮独立调用产出不同文案。
  ⚠️ 局限：本轮只覆盖 **1 条 uncertain**（样本量极小），真正的批量能力要靠 R4（预期 7 条）。
- **发现的新缺陷**：无新增。但**确认了一条已知残留缺口**：
  `page.tsx#default`（old 侧 0 参数 → 加第一个参数）定级仍为 `low/uncertain`，需烧 AI Token 定级。
  这符合 `docs/HANDOVER.md` §4 A3 的描述（代码注释已写明为有意取舍），**不是本轮引入的回归**——
  修复前该符号**完全检测不到**（scan 仅 4 条），修复后**能检出但定级偏保守**（scan 5 条）。属净改善。

**R2（webhook 适配器）**

- **结论**：webhook 入口链路（事件头识别 → 适配器映射 → 落库 → 幂等）**全部正确**，7 个字段逐一实测对上。
- 🔵 **刷新了一条交接文档的口径**：`docs/HANDOVER.md` 把「`gitlabProjectId` 全 null」列为无法验证 GitLab 回写的原因。
  R2 实测该字段**能正确写入**（`990016`）。所以「GitLab 回写未验证」的缺口**只剩最后一跳**（真的调 GitLab API 回写 status），
  **不再是「连 projectId 都没落库」**。
- ✅ **成本目标达成**：高峰时段执行，**AI 调用数 = 0**，成本影响为零（见 §1.1 排期策略）。
  附带量化：无 AI 时 15.7s，有 AI 时 36.0s → **AI 往返约占单次分析耗时一半**。

**R3（签名修复 baseline 对比）**

- ✅ **修复的预期收益成立**：interview-forge `main~20..main` 从 **4** 个变更符号 → **5** 个，
  多检出的正是 `src/app/page.tsx#default`。**这次修复确实修好了一个真实漏检。**
- 🔴 **但同时引入了一个新回归**：`export function f(a)` → `export const f = (a) => …` 这类**导出种类变化**，
  从原来的「报为 `uncertain`（交 AI 判断）」退化成「**完全不报告**」。
  在 `sample-repo` fixture 上，变更符号数从 **9 掉到 4**（丢 5 个）。
- 📌 **成本 0**：用 `npm run scan`（不走 HTTP、不调 AI）完成对比，是本次方法论上的一个改进。

### 全轮次裁决（R1–R4 全部完成）

- 结论：🟢 **四轮全部完成。R3 查出的回归当天已修复并复验；R4 证明 AI 批量能力真实可用（7 条送审 / 7 条建议 / 0 降级）。**
- **R4（AI 批量能力）—— 本轮唯一真实验证了 AI 规模的轮次**
  - ✅ **核心断言 A4 + A5 双双精确命中**：送审 7 条、建议 7 条、无降级。这是「AI 真在按条工作」的直接证据（R1 只有 1 条，说服力不足）。
  - ✅ **7 条建议逐条贴合符号语义、长度 31–48 字各不相同** —— 排除复制 / 缓存 / mock 三种伪造可能。
  - ✅ **前端把「规则 vs AI」的来源标了出来**：报告页渲染「共 9 条影响链路 · 规则引擎 2 条 · AI 语义引擎 7 条」，与后端数据一致 → 数据层到视图层这条链是通的。
  - 🔵 **AI 补上了规则引擎漏判的一条真实 breaking change**（`OrderStatus` 枚举顺序：`low/uncertain` → **`high`**）。
  - 🔴 **顺带修正了本文档的成本模型**（原「每条 uncertain = 1 次调用」是错的，实际固定 **2 次/任务**）—— 详见 §4 R4。
  - 🟡 **新增一条设计观察（Finding 2）**：AI 可输出 `confidence: "proven"`，与规则引擎的「确定性证明」语义撞车，下游无法区分来源。**待决**，优先级低于 B4/A3。
- 是否可作为合并门禁的依据：🟢🟡 **可以了，但门禁范围要写清**。
  「全链路能跑通」「AI 真调用且批量可用」「webhook 入口正确」「签名修复收益成立」「回归已修且复验无取舍」**五项均已实测证明**。
  仍**未**覆盖的是 §6 那几条（鉴权路径、真实平台投递、GitLab 回写、生产 SSE、大仓库性能）——
  那些是**边界与集成缺口**，不再是「核心能力未验证」。
- 🎯 **本轮发现并已修复的缺陷（1 条）**：**未提交的签名修复导致「`export function` → `export const` 箭头函数」的变更被静默丢弃**（少报方向，fixture 9 → 4）。
  - 根因、证据、修法、复验结果见 §4 R3 与 `docs/HANDOVER.md` §4 B4
  - **为什么单测没拦住**：139 个测试只覆盖「同一写法内部的参数变化」，**没有一条覆盖跨写法变更** —— 本项目第三次同类事故
- 🔴 **仍未解决的根因（不是这条缺陷，而是它反复发生的原因）**：
  **`docs/HANDOVER.md` §4 B3 —— 项目至今没有完整的「已知缺陷样本集」。**
  三次事故（`git show` 引号 / 签名盲区 / 本次 B4）**全部发生在 100+ 单测全绿时**。
  本轮已补「跨写法种类变化」与「0 参→有参」两组样本，**但样本集仍未建成**。
- 🔵 **一条方法论级结论（本轮最值钱的东西）**：
  **AI 调用成本不能靠「条数 × 单价」估，必须核对代码里的实际调用点。**
  本文档 §1.1 的成本表**两个方向都估错了**（R1 低估、R4 高估 3.5×），而它原本正是用来做排期决策的依据。
  教训与「输出看起来正常 ≠ 在正常工作」同源：**估算看起来合理 ≠ 估对了**。
