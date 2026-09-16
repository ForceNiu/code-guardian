# 开发须知（红线 · 方法论 · 文件地图）

> 本文件是**长期有效**的工程约定与环境知识，面向要动这个仓库的人（包括未来的我）。
> 它**刻意不包含**「当前进度 / 待办清单 / 本轮改了什么」—— 那类内容过期极快，写进来只会变成
> 一份需要同步维护的负债。想知道现状，看 `README.md`、`docs/architecture.md` 与 `git log`。
>
> 由来：2026-09-16 由一份**本地交接件**（`HANDOVER.md`，从未入库，现已删除）改写而来，
> 只保留其第 5 节（红线）、第 6 节（方法论）、第 7 节（文件地图），并补回一节「怎么验证」。
> 剔掉的部分（当时进度 / 待办清单 / 个人信息明细）**没有并入本文件** —— 它们要么已过期，
> 要么在 `git log`、`README.md`、`docs/architecture.md` 里有更好的出处。

---

## 1. 怎么验证（改动前后都该跑）

```bash
# 四道门禁 —— 与 CI（.github/workflows/ci.yml）完全一致
env -u NODE_OPTIONS npm run lint
env -u NODE_OPTIONS npm run typecheck
env -u NODE_OPTIONS npm test          # node:test，注意 tests/*.test.cjs 必须一起统计
env -u NODE_OPTIONS npm run build

# 真实仓库端到端核对（最重要的验证手段，理由见第 3 节）
npm run scan ../interview-forge main~20 main
npm run scan . main~5 main            # 扫自己
```

**注意**：`npm test` 里 `.cjs` 用例必须纳入（`tests/*.test.cjs`），只统计 `.ts` 会漏掉两个
引擎测试文件（历史上因此误判过「核心引擎零测试」）。

**三种粒度的验证不要混用**：
- `npm run scan` 验「**引擎**对不对」—— 绕开 DB / HTTP，**零 AI 成本**，走 worker；
- 全链路（起 dev + 真前端 + 真库）验「**接上 DB / HTTP / 前端**还跑不跑得动」。
- **引擎大改之后必须重跑全链路** —— 2026-09 曾出现「引擎单测与 scan 全绿，但全链路结论已过期 13 天」。

---

## 2. 项目红线（违反会出事）

1. **未经明确批准绝不 commit / push / 触发 CI。** 改动留在磁盘上等口头批准。
2. **`main` 是保护分支**，要求 PR + `lint → typecheck → test → build` 全绿。
   不能 `git push origin main`，必须 **feature 分支 → PR → CI 绿 → squash merge**。
3. **squash merge 后旧 feature 分支即「死」**（tree 相同、commit 不同），
   **新分支一律从同步后的 main 开**。历史错误就栽在这。
4. **切分支前先 `git branch -vv` 确认本地 `main` == `origin/main`**（本地 main 极易落后）。
5. **提交 `package.json` 前逐条比对 `git diff` 认领改动**（曾擅自加 husky/lint-staged 但没装）。
6. **改 `worker/*.cjs` 后 dev 不会热加载**，必须重启 dev（`next build` 无此问题）。
7. 沙箱里 npm / next / eslint / tsc 一律加 `env -u NODE_OPTIONS`。
8. 🔴 **push 失败先做「分层可达性探测」，不要先重试**：
   ```bash
   curl -sS -o /dev/null -w '%{http_code}' --max-time 10 https://api.github.com
   ```
   实测本环境 `github.com` 时通时不通（CONNECT 502 / 直连 75s 超时），而 **`api.github.com` 稳定可达**；
   `git push` 走的是 `github.com`，被挡就必然推不上去 —— **重试无意义，换通道**：
   ① 用户在自己终端 push；② 走 GitHub Git Data API（提交**未签名**时可逐提交重建，
   断言返回 sha == 本地 sha，全等即字节等价）。
   > ⚠️ 旧版本此处写的是「先重试 2–3 次再判网络不通」—— **已证伪**（白花 4 分钟，4 次全 128）。
9. 无 `gh` CLI，查 PR / CI 用 curl + 钥匙串凭据（**不要 echo token**）：
   `TOKEN=$(printf "protocol=https\nhost=github.com\n" | git credential fill | sed -n 's/^password=//p')`
   CI 状态用 `commits/<sha>/check-runs`（比 `statuses` 稳）。
10. 🔴 **写端点一律 fail-closed**：`POST /api/tasks` 要 `x-manual-trigger-token`（比对
    `MANUAL_TRIGGER_TOKEN`）、`POST /api/webhook` 要签名（比对 `WEBHOOK_SECRET`）；
    **两个变量任一未配置，对应接口直接返回 503**，而不是「不配置就不校验」。
    理由：分析链路会真调 DeepSeek 产生费用，敞开等于替别人付账。
11. 🔴 **AI 调用必须排在 DeepSeek 空闲时段**（**空闲单价 = 高峰的一半**）。
    高峰 = 北京时间 **周一至周五 9:00–12:00、14:00–18:00**；其余（含周末全天）为空闲。
    - 🔴 **AI 调用数 = 2 ×（触发了 AI 的任务数），与 `uncertain` 条数无关**（R4 实测修正）。
      链路：`scheduler.ts:149` → `enrich.ts:17-18`（**有 uncertain 才进入**）→
      `semantic-graph.ts`（**一次** `graph.invoke`，不按条循环）。图里**只有 2 个 LLM 节点**
      （`predict` + `suggest`；`restate`/`retrieve` 是纯函数），全部变更**打包进同一个 prompt**。
      权威证据：`tests/semantic-graph.test.ts` 直接断言 `mock.calls.length === 2`。
      ⚠️「每次 `uncertain` 变更 = 1 次调用」**是错的**，曾据此把成本估偏（一版低估、一版高估）。
    - **能不用 AI 的验证就别用**：如验 webhook 适配器，选 **0 `uncertain`** 的输入（如 failwatch `HEAD~10..HEAD`），AI 调用数归零。
    - 🔴 **动手前必须重新 `date` 确认时段 —— 不要沿用上一轮的结论**（对话可能已跨了数小时）。
      转场点：**12:00 → 空闲**、**14:00 → 高峰**、**18:00 → 空闲（至次日 09:00）**。
      判断时点：`TZ=Asia/Shanghai date`。**记录时间一律换算成北京时间**（DB 存 UTC）。
12. 🔴 **公开仓库的 PII 红线 = 「本地元数据」，不是「别的项目源码」**。
    本仓库是 PUBLIC（被分析的 interview-forge / failwatch 同样 PUBLIC），所以内嵌别项目源码
    **不算泄漏**；真正要防的是：**`/Users/<用户名>` 绝对路径、内网 IP、localhost 端口、临时路径**。
    - **`docs/reports/e2e-logs/` 整体 gitignore、一条都不入库**（其中含原始日志/截图，是本机跑一次的产物，
      第三方无法独立复现；结论由 `docs/reports/E2E-VERIFICATION-*.md` 承接 + `npm run scan` 可复跑）。
    - ⚠️ **排除某个文件/目录后，必须全仓 grep 它被引用的每一处** —— 曾漏掉 `README.md` 里指向它的链接
      → GitHub 上 404。改方案 = 改引用，两件事必须一起做。
    - 核「提交里有没有敏感串」**要看新增行**：`git diff main..HEAD | grep -E '^\+' | grep -E '<pat>'`；
      **不能用 `git grep <pat> <c1> <c2>`**（它扫全部文件，会把早已公开的文件算成命中 → 假警报）。

---

## 3. 方法论（这个项目的核心教训）

**「输出看起来正常」≠「在正常工作」。**

检测类工具的致命缺陷都在**「少报」方向**，而单测只验证「该报的报了」，不验证「该报的是不是漏了」。
本项目**三次事故** —— `git show` 路径引号、签名盲区、跨写法变更被静默丢弃 ——
**全部发生在 100+ 单测全绿的时候**。

所以本项目的验证纪律是三条：

1. **真实仓库核对**：任何引擎改动都要重跑 `npm run scan`（已固化为脚本）。一次真实扫描
   曾同时查出 3 个问题（含 1 个自造回归），这是单测给不了的。
2. **已知缺陷样本集**：为检测类能力维护一组最小 fixture + 逐个断言「**必须检出**」，
   每条都要做**断言灵敏度验证** —— 记下文件 SHA-256 → 把被守护的那行**临时改回旧写法** →
   跑测试**确认它变红** → 还原 → 哈希逐字节校验。**不做这一步，你无法知道断言是不是恒真摆设。**
3. **零成本 baseline 对比**：改引擎后验回归不必跑全链路 ——
   `npm run scan <repo> <base> <ref>` + **外科式 stash**（`git stash push -- <仅引擎文件>`，
   保留扫描脚本），成本归零；还原后用 SHA-256 逐字节比对 + `git stash list` 为空校验零丢失。

### 附则：写「从未 / 唯一 / 全部」前先穷举

2026-09-16 在同一份文档里连错四次，全是**用抽样结论冒充全称结论**或**没查证就否定**，
而且**每次都是用户质疑才发现**：

| 错误断言 | 实际 |
|---|---|
| 「全链路从未用真实数据跑通」 | 跑过 4 次，其中 2 次 repo 就是本项目自己 |
| 「唯一缺单测的是 `scheduler.ts`」 | 零单测模块共 10 个 |
| 「『跑通过 4 次』无出处」（否定他人正确结论） | 4 是库里真实任务数 |
| 「A2 引用的『下方说明』不存在」 | 它**存在**，标题叫「补注」；且当时用的 `grep "a\|b"` 在本沙箱（toybox）**静默返回 0 匹配**，给了假阴性 |

**规矩**：

1. 说「从未 / 唯一 / 全部 / 没有过」时，**必须同时写出「我是怎么验证的」**；查不过来就写「待核实」，不要断言。
2. **否定别人写下的结论前，先复现对方的验证路径**（通常就是查库）。
3. 判「某功能从未用过」前，**先确认相关字段/表不是后加的** —— 例：不能用 `source` 列全 null
   证明「没有 webhook 触发」，因为该列比任务记录晚加 1.5–3.5 小时。
4. 四查清单：**查库**（最权威、最常被忘）、`git log --all --grep`、全量枚举、往期 demo/截图/JSON 产物目录。
5. **搜不到 ≠ 不存在 —— 而且本项目环境里 bash `grep` 有静默假阴性**：
   本沙箱的 `grep`/`sed`/`find`/`ls` 是 **toybox**，`grep "a\|b"` 这种 BRE 交替
   **会静默返回 0 匹配且不报错**。
   **正确做法**：用 **Grep 工具（ripgrep）** 而非 bash grep；必须用 bash 时写 `grep -E "a|b"`，
   **永不写 `a\|b`**；下「不存在」结论前**用两种独立手段交叉验证**。
6. **别用启发式代替验证**：用「取选择器最后一个 class 名查是否出现」这类粗糙规则判断
   「CSS 有没有被用到」，会得出与事实相反的结果。要么把字符串字面量切成 class token 精确比对，
   要么交叉验证。**这个坑当天就踩了一次。**

---

## 4. 文件地图

```
worker/                🔴 **Worker 线程侧引擎，有意放在 `src/` 之外**
  analyze-core.cjs     引擎纯函数：AST 解析 / 导出符号 / import 解析 / 差异对比 / 影响图穿透
  rules.cjs            确定性规则引擎：semver 口径定级（proven / heuristic / uncertain）
  analyze.worker.cjs   worker 入口：git clone / checkout / 调 analyze-core（.cjs，不进 bundle、不参与 tsc）
src/lib/
  run-analysis.ts      主线程侧桥：new Worker + 软超时 + terminate() 回收（**会被 Next 打包**）
  persist.ts           结果落库（Prisma 事务 + 批量 deleteMany/createMany）
  scheduler.ts         任务调度编排（13 条单测，含 7 个 fake；并发上限 3 + 原子认领 + 卡死回收）
  events.ts            SSE 事件总线
  ai/                  DeepSeek + LangGraph 语义引擎（只判断 uncertain 变更）
  security/            依赖 CVE 扫描 + 构建体积门禁
  status/gitlab-status.ts  GitLab Commit Status 回写
src/components/
  ImpactTable.tsx      影响表（置信度三档 + 引擎来源标记 + AI 建议 sub-row）
  DiffViewer.tsx       Monaco Diff（theme 是顶层 prop，不在 options 里）
scripts/
  scan-repo.cjs        真实仓库扫描驱动（绕开 DB/HTTP，零 AI 成本）
  create-fixture.sh    fixture 生成
docs/
  architecture.md      架构与规则口径
  product.md           产品说明
  AUDIT-BACKLOG.md     审计清单唯一归属地（做 / 不做 / 待定三态）—— **状态一变就改它**
  G1-KICKOFF.md        零背景 HTML 说明书（G1）的开工说明，自包含（新对话读它即可开工）；**用完即可删**
  DEVELOPING.md        本文件（红线 / 方法论 / 文件地图）
  frontend-redesign.md 前端视觉设计原则
  reports/             审查报告 + 端到端验证结论（e2e-logs/ 原始 dump 不入库）
tests/
  *.test.cjs / *.test.ts   node:test 单测 17 个文件（CI 第三道门禁）
LICENSE                  MIT / Copyright (c) 2026 ForceNiu
.github/workflows/ci.yml lint → typecheck → test → build 四道门禁
```

> 🔴 **`worker/analyze.worker.cjs` 只被「运行时字符串路径」引用**（`src/lib/run-analysis.ts:23`、`scripts/scan-repo.cjs:38`），
> 不是 `import` —— 目的是让它既不进 Next bundle、也不被 Turbopack 改写。
> **后果：改它的文件名 / 目录名不会有任何编译期报错，只在运行时挂（或更坏：静默跑到旧路径）。**
> 同步点**共 4 处**（只算「改这个文件名/目录名就必须跟着改」的）：上面两个字符串 + `tests/analyze-worker.test.cjs:20`（构造）+ `tests/run-analysis.test.ts:93`（断言）。
> 固定判据：`npm run scan <仓库> <base> <head>` 与基线数字逐项对齐（`analyze-worker.test.cjs` 真起 Worker 线程）。

---

## 5. 依赖与提交的几个具体坑

- **改 npm 依赖不要直接 `npm uninstall`**（会夹带无关 diff：registry 域名改写、可选包补全等）。
  做法：外科式改 `package.json` + `package-lock.json`，然后两道验证 ——
  ① `JSON.stringify(JSON.parse(raw), null, 2)` round-trip 与原文件**字节一致**（证明 JSON 读写无损）；
  ② `npm install --package-lock-only --dry-run` 返回 `up to date`（证明两者一致）。
  🔴🔴 **验收必须先把包从 `node_modules` 挪走再跑门禁** —— 只改文件时磁盘上包还在，
  门禁绿**证明不了**「干净安装也绿」。**验的是环境，不是文件。**
- **有些结论只有 CI 能给**：`npm ci` 成功是「干净安装 + Linux 下 lockfile 合法」的权威证据
  （本地只能用「把包挪走」近似验证）。所以「必须开 PR 触发 CI」是**实质必要**，不是形式主义。
- **合并前四重复核 + 合并后抽验**：`state=open` + `mergeable_state=clean` + CI 全绿 +
  `PUT /merge` 带 `sha` 锁定被审查过的那个 SHA；合并后还要用 `git ls-tree origin/main` 查关键文件在不在、
  `--is-ancestor` 确认快进关系 —— **别只信 API 回的那句「merged」**。
