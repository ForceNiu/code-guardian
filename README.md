# Code Guardian · AI 代码副作用检测与审查治理平台

在 MR 合并前自动分析 **「这次改动影响了哪些函数、哪些文件」**，作为合并门禁依据。
ESLint 查不出变量污染，Code Review 人工又太慢——本平台用 **AST 增量分析 + 反向索引** 把影响链路自动算出来。

> 当前进度：**M1（骨架）→ M5（安全门禁）已全部完成并合并**。M5 覆盖 CVE 依赖漏洞扫描 + 构建体积门禁 + GitLab 状态回写。详见 [架构文档](docs/architecture.md) 里程碑部分。

---

## 核心能力（已实现）

| 能力 | 说明 | 解决什么问题 |
| :--- | :--- | :--- |
| 多源 Webhook | `POST /api/webhook` 幂等入队，适配 GitLab MR / GitHub push / GitHub PR，唯一索引防重 | 不用改现有 CI；同一 MR 重复触发**不会重复烧 AI 的钱** |
| 手动触发 | 首页粘贴仓库地址 + base/head ref 即可分析 | 还没接 webhook 也能先看到效果 |
| AST 分析引擎 | `@babel/parser` + `@babel/traverse`，跑在 `worker_threads` 里 | 分析大仓库时不卡住接口 |
| 导出符号提取 | 解析 `export` 得到每个文件的导出函数/变量，支持任意历史提交当 head 对比 | 想比哪两个提交就比哪两个，不受「当前分支」限制 |
| 跨文件引用追踪 | 反向索引表：每个符号存「谁引用它」 | 回答**「改这个函数会影响谁」**——ESLint 不回答的问题 |
| 确定性规则引擎 | 25 条查表规则 + `unknown` 兜底（函数签名 10 类 / type·interface 字段 8 类 / enum 成员 2 类 / class 成员 5 类）＋ semver 判据、confidence 三档 | **绝大多数变更由规则判定**（真实仓库实测 0 `uncertain`）、模糊的才送 AI：结论可复现、成本可控 |
| AI 语义引擎 | 规则判为 `uncertain` 的变更送 LangGraph 4 节点（DeepSeek）补判定，失败静默降级 | 规则兜不住的那部分才送 AI；**AI 挂了也不阻塞出报告** |
| 影响链路 | 对比 base/head 导出签名，输出「文件 → 符号 → 变更类型 → 影响文件」 | 直接拿来当**合并门禁的判据**，不用人再读一遍 diff |
| 任务调度 | 数据库状态机 + 5s 轮询 + 信号量限 3 并发，无 Redis/队列 | 单机就能跑，不引入额外中间件 |
| 实时进度 | SSE（`text/event-stream`）推送解析/分析各阶段状态，断线自动降级轮询 | 长任务不假死，用户知道现在到哪一步 |
| Monaco Diff | 新旧文件左右对比，高亮副作用行 | 从「有影响」落到「影响了哪一行」 |
| 哈希缓存 | `file_snapshots` 存 MD5，`export_symbols` 存反向索引 | 二次分析只算变更文件，不重扫全仓 |
| 安全门禁 | CVE 依赖漏洞扫描（npm Bulk Advisory）+ 依赖体积门禁（unpackedSize 累计 + 100MB 阈值）+ GitLab Commit Status 回写 | 不只查代码本身，还查**依赖带来的漏洞与体积** |

### 能力落在哪个文件

| 能力 | 代码位置 |
| :--- | :--- |
| 分析流水线总控 | `src/lib/run-analysis.ts`（主线程） → `worker/analyze.worker.cjs`（Worker 线程） |
| AST 解析 / 符号 / 差异 / 影响图 | `worker/analyze-core.cjs` |
| 25 条规则 + 定级 | `worker/rules.cjs` |
| 任务调度（轮询/限并发/超时） | `src/lib/scheduler.ts` |
| 结果落库 / 增量缓存 | `src/lib/persist.ts` |
| SSE 事件总线 | `src/lib/events.ts` |
| Webhook 适配（三种源） | `src/lib/webhook-adapters.ts` |
| AI 语义引擎 | `src/lib/ai/`（`semantic-graph.ts` 4 节点 + `deepseek.ts`） |
| 安全门禁 | `src/lib/security/` + `src/lib/status/gitlab-status.ts` |
| 前端报告页 | `src/app/tasks/[id]/page.tsx` + `src/components/` |

### 关键阈值（改了要重新验证）

| 参数 | 值 | 位置 |
| :--- | :--- | :--- |
| 并发上限 | 3 | `scheduler.ts` |
| 轮询间隔 | 5s | `scheduler.ts` |
| 任务硬超时 | 5 min | `scheduler.ts` |
| Worker 软超时 | 4 min（必须短于硬超时） | `run-analysis.ts` |
| git 操作超时 | 2 min | `analyze.worker.cjs` |
| DeepSeek 超时 | 5 min | `ai/deepseek.ts` |
| 依赖体积门禁 | 100 MB | `security/bundle-size.ts` |
| 影响面升档阈值 | 引用 ≥5 且非 proven | `rules.cjs` |

---

## 技术栈

版本取自 `package.json` 的实际声明（`^` 为语义化范围内的最低版本）。运行环境：**Node 22**（CI 与本地一致）。

| 技术 | 版本 | 作用 |
| :--- | :--- | :--- |
| Next.js | `^16.3.4` | 页面与 API 路由（App Router） |
| React / React DOM | `^19.2.8` | 报告页与组件 |
| TypeScript | `^5.9.3` | strict 全量类型（CI 第二道门禁） |
| Prisma / Prisma Client | `^6.19.3` | ORM、迁移、增量缓存落库 |
| PostgreSQL | 本地用 `postgres:16-alpine`；线上 Neon 云库 | 任务、文件快照、导出符号反向索引 |
| Tailwind CSS | `^4.3.3` | 样式（v4，无 `tailwind.config.js`） |
| @babel/parser / @babel/traverse | `^7.29.8` | AST 解析与遍历（分析引擎的核心） |
| @langchain/langgraph | `^1.4.13` | AI 语义引擎 4 节点管线 |
| @langchain/core | `^1.2.9` | LangGraph 的运行时依赖 |
| DeepSeek | HTTP 直发（无 SDK） | 语义判定；`node:https`/`node:http` 直连，**配了 `HTTPS_PROXY` 则改走 CONNECT 隧道**（undici 不读代理变量，在代理环境会挂死），无代理时直连兜底 |
| @monaco-editor/react | `^4.7.0` | 新旧文件 Diff 对比 |
| zod | `^3.25.76` | Webhook 与手动触发入参校验 |
| node:worker_threads | Node 22 内置 | CPU 密集分析隔离在主线程之外 |
| @phosphor-icons/react / framer-motion | `^2.1.10` / `^13.2.0` | 图标与动效（前端视觉层） |

---

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置数据库（二选一）
cp .env.example .env
# 方案 A：Neon 云库 —— 编辑 .env 填入你的 DATABASE_URL
# 方案 B：本地 Docker（离线兜底）—— docker compose up -d，.env 用
#   DATABASE_URL="postgresql://codeguardian:codeguardian@localhost:5432/code_guardian?schema=public"

# 3. 建表
npx prisma migrate dev --name init

# 4. 生成演示仓库（跨文件引用 + 一个典型 MR）
npm run fixture

# 5. 灌入种子数据（建仓库 + 一条 pending 任务）
npm run seed

# 6. 启动（调度器会随 instrumentation.ts 自动拉起，自动处理 pending 任务）
npm run dev
```

打开 http://localhost:3000 ，即可看到自动分析出的影响链路报告。

---

## 快速验证 Webhook 幂等

> ⚠️ `POST /api/webhook` 是**写端点且 fail-closed**（见下方「环境变量」）：**不配 `WEBHOOK_SECRET` 直接 503**，
> 配了但**不带 `x-gitlab-token` 头**则 **401**。所以下面的 `-H "x-gitlab-token: …"` **不能省**——
> 无平台事件头时走的是「统一格式」兼容路径，该路径**同样校验这个 token**（`src/app/api/webhook/route.ts:79`）。

```bash
# 前置：.env 里已配 WEBHOOK_SECRET（未配则本接口整段返回 503）
export WEBHOOK_SECRET='<你在 .env 里配的值>'

# 第一次：创建任务 ── 期望 HTTP 201 + {"status":"created", …}
curl -X POST http://localhost:3000/api/webhook \
  -H 'Content-Type: application/json' \
  -H "x-gitlab-token: $WEBHOOK_SECRET" \
  -d '{"gitUrl":"/绝对路径/code-guardian/fixtures/sample-repo","mrId":"demo-1","commitSha":"<head-sha>","baseRef":"<base-sha>","headRef":"<head-sha>"}'

# 第二次（同 payload）：应返回 {"status":"duplicate"} + HTTP 200，不重复入队
```

> 若把 `-H "x-gitlab-token: …"` 换成真实 GitLab 的 `X-Gitlab-Event: Merge Request Hook` 头，走的就是真正的 MR 适配路径。

---

## 部署

生产运行 = 一个 Next.js 服务器 + 一个 Postgres。**单实例部署下不需要 Redis、消息队列或额外的 worker 进程**——
调度器随 `instrumentation.ts` 在应用启动时自动拉起（5s 轮询，并发上限 3），分析跑在进程内的 `worker_threads` 里。

> ⚠️ 上句的「**单实例**」是硬前提：SSE 进度推送走的是**进程内**事件总线（`src/lib/events.ts`，EventEmitter 挂 `globalThis`）。
> 横向扩到**多实例 / Serverless** 后，跨实例订阅失效——浏览器可能一直收不到进度更新（任务本身仍会跑完，可刷新看结果），
> 届时需把它换成 Redis pub/sub。这是已知边界，登记见 `docs/AUDIT-BACKLOG.md`（D11）。

```bash
npm ci
npx prisma generate      # 项目无 postinstall，必须手动跑一次（CI 也是显式一步）
npx prisma migrate deploy  # 只应用已有迁移，不生成新迁移
npm run build
npm run start              # 默认监听 3000
```

> 🔴 **上生产前必须先配好两个写端点的口令**（`MANUAL_TRIGGER_TOKEN` / `WEBHOOK_SECRET`）。
> 它们是 **fail-closed** 的——不配就返回 503，对应功能整段不可用。见下方「环境变量」。

| 项 | 值 | 说明 |
| :--- | :--- | :--- |
| 应用端口 | `3000` | `npm run start` 的默认端口 |
| 数据库 | Neon 云库，或本地 Docker | 本地：`npm run db:up` / `db:down` → `postgres:16-alpine`，映射宿主机 `5432`，数据卷 `pgdata`，带 `pg_isready` 健康检查 |
| 迁移（开发） | `npm run prisma:migrate` | 会**生成**新迁移文件 |
| 迁移（生产） | `npm run prisma:deploy` | **只应用**已有迁移 |
| 查库 | `npm run prisma:studio` | 可视化查看任务、快照与符号索引 |
| CI | `.github/workflows/ci.yml` | 单 job，Node 22，依次 `lint → typecheck → test → build`，超时 15 min；push 到 `main` 与所有 PR 都触发 |

> 📌 本仓库**没有绑定任何托管平台的自动部署**：合并到 `main` 不会触发线上发布，部署方式由你自己选。

---

## 目录结构

```
prisma/            schema（4 张表）+ 迁移 + seed
src/app/           页面（首页 + 报告页）+ API 路由（webhook / tasks / stream SSE）
src/lib/           调度器 · 事件总线 · 入队 · 持久化 · webhook 适配 · ai/ · security/ · 状态回写 · 类型 · run-analysis（主线程侧）
worker/            Worker 线程侧引擎（AST 核心 + 规则引擎 + git + 反向索引 + 影响链路）—— **有意放在 `src/` 之外**：不进 Next bundle、不参与 tsc
src/components/    状态步骤 · 风险总览 · 影响链路表 · Monaco Diff
tests/             node:test 单测（分析核心 / 规则引擎 / AI 图谱 / DeepSeek 客户端 / 安全门禁及其集成层 / webhook 适配 / 入队与持久化 / worker 生命周期 / 调度编排）
scripts/           fixture 生成 + 真实仓库核验（`scan-repo.cjs`）
fixtures/          演示用 git 仓库
docs/              产品文档(含 §10 已知边界) · 架构文档 · 开发须知(DEVELOPING: 红线/方法论/文件地图) · 审计台账(AUDIT-BACKLOG)；历史报告已移出本仓库
.github/           CI（lint → typecheck → test → build 四道门禁，单 job）
```

详见 [产品文档](docs/product.md) 与 [架构文档](docs/architecture.md)。

---

## 脚本

| 命令 | 作用 |
| :--- | :--- |
| `npm run dev` | 启动开发服务器（调度器随 `instrumentation.ts` 自动拉起，自动消费 pending 任务） |
| `npm run build` | 生产构建（CI 第四道门禁） |
| `npm run start` | 启动生产服务器（需先 `npm run build`） |
| `npm run lint` | ESLint（CI 第一道门禁） |
| `npm run typecheck` | `tsc --noEmit` 类型检查（CI 第二道门禁） |
| `npm test` | Node 内置 `node:test`，纳 `tests/*.test.cjs` + `tests/*.test.ts`（CI 第三道门禁） |
| `npm run scan <仓库路径> [baseRef] [headRef]` | 跳过 Web/DB，**直接对本地仓库跑一遍完整分析**（引擎改动后唯一靠谱的验证手段） |
| `npm run prisma:generate` | 生成 Prisma Client（项目无 postinstall，CI 与本地都需手动跑一次） |
| `npm run prisma:migrate` | 迁移（开发） |
| `npm run prisma:deploy` | 迁移（生产，只应用已有迁移、不生成新迁移） |
| `npm run prisma:studio` | Prisma Studio 可视化查库 |
| `npm run db:up` / `db:down` | 本地 Docker Postgres 起停（`.env` 要指到本地连接串） |
| `npm run fixture` | 生成演示仓库 |
| `npm run seed` | 灌入种子数据 |

沙箱/代理环境下以上命令一律加 `env -u NODE_OPTIONS`。

---

## 环境变量

| 变量 | 必填 | 不填会怎样 |
| :--- | :--- | :--- |
| `DATABASE_URL` | ✅ | 服务起不来（Prisma 连不上库） |
| `DEEPSEEK_API_KEY` | — | AI 语义引擎跳过，`uncertain` 变更无人补判，报告照出 |
| `GITLAB_TOKEN` | — | GitLab Commit Status 回写静默跳过，MR 没有红绿灯 |
| `WEBHOOK_SECRET` | — | 🔒 **fail-closed**：不填则该接口返回 503（不再跳过校验），`/api/webhook` 整段不可用 |
| `MANUAL_TRIGGER_TOKEN` | — | 🔒 **fail-closed**：不填则 `POST /api/tasks` 返回 503，首页「触发分析」需填此口令 |

> 🔴 两个写端点（`POST /api/tasks`、`POST /api/webhook`）自 2026-09-16 起均为**安全默认**：
> **未配置密钥即拒绝**，而不是「未配置即不校验」。因为分析链路会真调 DeepSeek 产生费用，
> 敞开等于替别人付账。本地开发也需显式配好这两个变量之一才能提交任务。

完整说明见 `.env.example`。数据库二选一：Neon 云库，或 `docker compose up -d` 起本地 Postgres。

---

## 扩展指南

三处最常改的地方，每处都标了**改哪个文件**和**改完必须做什么**。

### 1. 加一条定级规则

- `worker/rules.cjs`：`classifyFunctionChange` / `classifyTypeFieldChange` / `classifyEnumChange` / `classifyClassChange` 负责产出变更 **label**，再到 `RULE_TABLE` 加一行 `label: { severity, confidence }`。
- `confidence` 三档的含义决定了钱花在哪：`proven` = 直接定级、直接当门禁（**0 Token**）；`heuristic` = 需复核但不阻断；`uncertain` = 才送 AI 语义引擎。
  → **能算准的别塞进 `uncertain`**，那是白烧 token。
- 改完必须做两件事：① 在 `tests/rules.test.cjs` 补断言，并做**灵敏度验证**（把新规则临时改回旧写法 → 确认测试变红 → 还原）；② 跑 `npm run scan <仓库路径> <base> <head>` 与基线数字对比。
  ⚠️ **基线数字必须连窗口一起记**：`main~N..main` 不是固定输入，`main` 前进一次就是另一个窗口。

### 2. 换 AI 供应商 / 换模型

- 唯一入口：`src/lib/ai/enrich.ts` 的 `enrichUncertain`。
- 管线只依赖接口 `LLMInvoker`（`src/lib/ai/semantic-graph.ts`）：**实现一个带 `invoke` 的对象传给 `buildSemanticGraph(llm)` 即可，4 个节点不用动**。
- 默认真实实现是 `createLLM()`（`src/lib/ai/deepseek.ts`）→ 返回 `DeepSeekLLM`；它返回 `null` 时整条 AI 路径静默跳过（未配 key 就是这个状态）。
- ⚠️ `deepseek.ts` 刻意**不用 `fetch`**，改用 `node:https` / `node:http` / `node:tls` 直发——因为 undici 不读 `HTTPS_PROXY`，在代理环境会挂死。换供应商时若改用 SDK，先确认代理行为。

### 3. 接新的事件源

- `src/lib/webhook-adapters.ts` 四步：`WebhookSource` 加类型 → `detectEvent(headers)` 加识别 → 写 `adaptXxx(payload)` → 在 `adaptWebhook` 的**分派分支**里挂上（现为三元链，不是 switch）。
- **幂等不用自己写**：唯一索引 `(repoId, mrId, commitSha)` 兜住，重复触发由 `enqueueTask` 捕获 P2002 返回 `duplicate`。
- 签名校验现状：GitLab 比对 `x-gitlab-token`，GitHub 比对 `x-hub-signature-256`，手动触发比对 `x-manual-trigger-token`；**三处统一走 `safeEqual()`（`timingSafeEqual`）做常量时间比较**（P1-8 之前只有 GitHub 那处是常量时间，另两处是 `!==`）。

> 🔴 以上任一处改动都动到了**判定逻辑**或**外部调用**，因此收尾固定跑四道门禁 + 一次全链路复跑（见 [`docs/DEVELOPING.md`](docs/DEVELOPING.md) 的红线）。

---

## 已知边界（判读报告时必读）

报告里的数字各有口径，读错口径会得出相反结论。几条最容易踩的：

| 报告显示 | 真实含义 | 常见误读 |
| :--- | :--- | :--- |
| 影响链路 **0 条** | **对外接口层面**没检测到变化 | ❌ 误读成「这次改动没影响」——引擎**不解析函数体内部逻辑**，返回值/副作用变了但签名没动，看不到 |
| 体积 `incomplete` | 部分依赖体积查询失败，`totalBytes` **偏小** | ❌ 误读成「体积没超标」——要看「查询 N / 失败 M」 |
| 安全门禁 `failed` | 查询本身失败，结果**不可信** | ❌ 误读成「没有漏洞」——UI 会显示失败警示，不会留白 |
| AST 解析范围 | 仅 **TS/JS**（.js/.jsx/.ts/.tsx/.mjs/.cjs），**不含 .vue/.svelte** | ❌ 误读成「纯 Vue 项目也能用」——模板文件不进解析名单，影响链路基本空白 |
| AI 语义引擎「没动作」 | 真实语料上规则已把变更全部定级（0 `uncertain`），AI 通道未被触发 | ❌ 误读成「AI 坏了」——规则覆盖到位，AI 只是兜底补判通道 |

解析失败会按 `syntax`（你的代码错了）/ `unsupported`（我们不支持，如 pipeline 运算符）/ `empty`（空文件）分类上报，不再静默；`unsupported` 不为 0 意味着有文件根本没被解析，影响面是空白。AST 解析覆盖 TS/JS 栈（由 `worker/analyze-core.cjs` 的 `SOURCE_EXT` 定义），不含 `.vue` 等模板类文件——纯 Vue/Svelte 项目上影响链路基本空白，需人工确认。

完整口径见 [docs/product.md §10 已知边界](docs/product.md#10-已知边界判读报告前必读)。

---

## 这份文档不够看怎么办

| 想找什么 | 读哪份 |
| :--- | :--- |
| 能力全貌 / 环境变量 / 脚本 | 本文件 README.md |
| 改代码前必读：红线 / 方法论 / 文件地图 | [docs/DEVELOPING.md](docs/DEVELOPING.md) |
| 架构设计与规则口径 | [docs/architecture.md](docs/architecture.md) |
| 产品定位与使用场景 + 已知边界 | [docs/product.md](docs/product.md) |
| 审计待办台账（审计清单的唯一归属地） | [docs/AUDIT-BACKLOG.md](docs/AUDIT-BACKLOG.md) |
| 历史审查 / 全链路复跑报告（2026-09-16 ~ 09-19） | **已移出本仓库**，归档在仓库外 `学习笔记/code-guardian/历史报告-移出/` |

---

## 开源协议

MIT License，详见 [LICENSE](LICENSE)。
