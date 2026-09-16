# Code Guardian · AI 代码副作用检测与审查治理平台

在 MR 合并前自动分析 **「这次改动影响了哪些函数、哪些文件」**，作为合并门禁依据。
ESLint 查不出变量污染，Code Review 人工又太慢——本平台用 **AST 增量分析 + 反向索引** 把影响链路自动算出来。

> 当前进度：**M1（骨架）→ M5（安全门禁）已全部完成并合并**。M5 覆盖 CVE 依赖漏洞扫描 + 构建体积门禁 + GitLab 状态回写。详见 [架构文档](docs/architecture.md) 里程碑部分。

---

## 核心能力（已实现）

| 能力 | 说明 |
| :--- | :--- |
| 多源 Webhook | `POST /api/webhook` 幂等入队，适配 GitLab MR / GitHub push / GitHub PR，唯一索引防重 |
| 手动触发 | 首页粘贴仓库地址 + base/head ref 即可分析 |
| AST 分析引擎 | `@babel/parser` + `@babel/traverse`，跑在 `worker_threads` 里，不阻塞主线程 |
| 导出符号提取 | 解析 `export` 得到每个文件的导出函数/变量，支持任意历史提交当 head 对比 |
| 跨文件引用追踪 | 反向索引表：每个符号存「谁引用它」→ 改一个函数立刻知道影响范围 |
| 确定性规则引擎 | 25 条查表规则 + `unknown` 兜底（函数签名/字段/别名/重命名导出/enum/class），semver 判据 + confidence 三档 |
| AI 语义引擎 | 规则判为 `uncertain` 的变更送 LangGraph 4 节点（DeepSeek）补判定，失败静默降级 |
| 影响链路 | 对比 base/head 导出签名，输出「文件 → 符号 → 变更类型 → 影响文件」 |
| 任务调度 | 数据库状态机 + 5s 轮询 + 信号量限 3 并发，无 Redis/队列 |
| 实时进度 | SSE（`text/event-stream`）推送解析/分析各阶段状态，断线自动降级轮询 |
| Monaco Diff | 新旧文件左右对比，高亮副作用行 |
| 哈希缓存 | `file_snapshots` 存 MD5，`export_symbols` 存反向索引 |
| 安全门禁 | CVE 依赖漏洞扫描（npm Bulk Advisory）+ 依赖体积门禁（unpackedSize 累计 + 100MB 阈值）+ GitLab Commit Status 回写（MR 合并红绿灯） |

### 能力落在哪个文件

| 能力 | 代码位置 |
| :--- | :--- |
| 分析流水线总控 | `src/worker/run-analysis.ts` → `src/worker/analyze.worker.cjs` |
| AST 解析 / 符号 / 差异 / 影响图 | `src/worker/analyze-core.cjs` |
| 25 条规则 + 定级 | `src/worker/rules.cjs` |
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

- **Next.js 16**（App Router）+ **React 19** + **TypeScript**（strict）
- **Prisma 6** + **PostgreSQL**（Neon 云库）
- **@babel/parser / @babel/traverse**（AST）
- **@langchain/langgraph**（AI 语义引擎 4 节点管线）+ **DeepSeek**
- **@monaco-editor/react**（Diff 对比）
- **worker_threads**（CPU 隔离）
- **zod**（入参校验）

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

```bash
# 第一次：创建任务
curl -X POST http://localhost:3000/api/webhook \
  -H 'Content-Type: application/json' \
  -d '{"gitUrl":"/绝对路径/code-guardian/fixtures/sample-repo","mrId":"demo-1","commitSha":"<head-sha>","baseRef":"<base-sha>","headRef":"<head-sha>"}'

# 第二次（同 payload）：应返回 duplicate，不重复入队
```

---

## 目录结构

```
prisma/            schema（5 张表）+ 迁移 + seed
src/app/           页面（首页 + 报告页）+ API 路由（webhook / tasks / stream SSE）
src/lib/           调度器 · 事件总线 · 入队 · 持久化 · webhook 适配 · ai/ · security/ · 状态回写 · 类型
src/worker/        Worker 线程（AST 核心 + 规则引擎 + git + 反向索引 + 影响链路）
src/components/    状态步骤 · 风险总览 · 影响链路表 · Monaco Diff
tests/             node:test 单测（分析核心 / 规则引擎 / AI 图谱 / 安全门禁 / webhook 适配）
scripts/           fixture 生成 + 真实仓库核验（`scan-repo.cjs`）
fixtures/          演示用 git 仓库
docs/              产品文档 · 架构文档 · 前端设计说明 · reports/（历史审查与验证结论）· demo-ai-uncertain/（AI 触发演示快照）
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

## 这份文档不够看怎么办

| 想找什么 | 读哪份 |
| :--- | :--- |
| 能力全貌 / 环境变量 / 脚本 | 本文件 README.md |
| 改代码前必读：红线 / 方法论 / 文件地图 | [docs/DEVELOPING.md](docs/DEVELOPING.md) |
| 架构设计与规则口径 | [docs/architecture.md](docs/architecture.md) |
| 产品定位与使用场景 | [docs/product.md](docs/product.md) |
| 前端视觉设计原则 | [docs/frontend-redesign.md](docs/frontend-redesign.md) |
| 历史审查结论 | [docs/reports/CODE_REVIEW_REPORT.md](docs/reports/CODE_REVIEW_REPORT.md) |
| 端到端验证记录 | [docs/reports/E2E-VERIFICATION-2026-09-16.md](docs/reports/E2E-VERIFICATION-2026-09-16.md) |

---

## 开源协议

MIT License，详见 [LICENSE](LICENSE)。
