# Code Guardian · 架构设计

> AI 代码副作用检测与审查治理平台 —— 在 MR 合并前自动分析「这次改动影响了哪些函数、哪些文件」，并作为合并门禁依据。

---

## 1. 一句话定位

ESLint 查不出变量污染、Code Review 人工太慢。本平台在 MR 合并前，用 **AST 增量分析 + 反向索引** 自动算出影响链路，再叠加 **确定性规则引擎（80%）+ AI 语义引擎（20%）** 双轨给出门禁结论。

---

## 2. 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                       前端（Next.js 16）                        │
│    任务列表 · 手动触发 · 状态步骤 · 风险总览 · 影响链路表格        │
│                        ↕ HTTP 轮询 / SSE                        │
├─────────────────────────────────────────────────────────────────┤
│              Next.js API Route（App Router）                    │
│   ┌─────────────┐  ┌─────────────┐  ┌──────────────────────┐   │
│   │ Webhook 接收 │  │ 任务增查 API │  │ instrumentation 启动  │   │
│   └─────────────┘  └─────────────┘  └──────────┬───────────┘   │
│                                                ▼                │
│                     调度器（setInterval 轮询 + 信号量限流 3）      │
│                              ↕ 认领 pending 任务                │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │            Worker Thread（worker_threads，CPU 隔离）      │  │
│   │  ① git clone/fetch → ② git diff → ③ Babel AST 解析       │  │
│   │  ④ 导出符号提取 → ⑤ 反向索引 → ⑥ 变更 diff → ⑦ 影响链路   │  │
│   └─────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                    Prisma + PostgreSQL（Neon）                  │
│    repositories · tasks · file_snapshots · export_symbols ·     │
│    feedbacks                                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 目录结构

```
code-guardian/
├── prisma/
│   ├── schema.prisma          # 5 张表（见 §4）
│   └── seed.ts                # 幂等 seed：建仓库 + 示例任务
├── src/
│   ├── app/
│   │   ├── page.tsx           # 首页：任务列表 + 手动触发
│   │   ├── tasks/[id]/page.tsx# 报告页：步骤/风险/影响链路（SSE 订阅 + 轮询兜底）
│   │   └── api/
│   │       ├── webhook/route.ts           # 多源 Webhook 入口（幂等防重）
│   │       ├── tasks/route.ts             # 列表 + 手动触发
│   │       ├── tasks/[id]/route.ts        # 任务详情
│   │       └── tasks/[id]/stream/route.ts # SSE 实时进度（text/event-stream）
│   ├── lib/
│   │   ├── prisma.ts           # 单例（globalThis 防热重载耗尽连接）
│   │   ├── scheduler.ts        # 轮询调度器 + 信号量 + 原子认领 + 事件发布
│   │   ├── enqueue.ts          # 入队（靠唯一索引防重）+ 事件发布
│   │   ├── persist.ts          # 符号缓存落库
│   │   ├── events.ts           # 进程内事件总线（EventEmitter 挂 globalThis）
│   │   ├── webhook-adapters.ts # 三源适配（GitLab MR / GitHub push / GitHub PR）
│   │   ├── ai/                 # M3b AI 语义引擎
│   │   │   ├── deepseek.ts       # DeepSeek 客户端（HTTP 代理 CONNECT 隧道）
│   │   │   ├── semantic-graph.ts # LangGraph 4 节点管线（重述→检索→预测→建议）
│   │   │   └── enrich.ts         # uncertain 变更集成层（合并判定回 impactChain）
│   │   ├── security/           # M5 安全门禁
│   │   │   ├── dependency-manifest.ts # 依赖清单（package.json + lockfile）
│   │   │   ├── cve-scan.ts           # CVE 扫描（npm Bulk Advisory）
│   │   │   ├── bundle-size.ts        # 构建体积检测（unpackedSize）
│   │   │   └── index.ts              # enrichSecurity 集成层
│   │   ├── status/             # GitLab Commit Status 回写
│   │   │   └── gitlab-status.ts
│   │   └── types.ts            # Worker ↔ 主线程共享类型
│   ├── worker/
│   │   ├── analyze-core.cjs    # AST 核心：导出符号提取 + 签名 + 字段/别名
│   │   ├── rules.cjs           # 确定性规则引擎（27 条查表 + confidence 三档）
│   │   ├── analyze.worker.cjs  # Worker：git + AST + 反向索引 + 影响链路
│   │   └── run-analysis.ts     # 主线程封装（new Worker + Promise）
│   ├── components/             # StatusSteps / RiskSummary / ImpactTable / DiffViewer
│   └── instrumentation.ts      # 启动时拉起调度器
├── fixtures/sample-repo/       # 演示用 git 仓库（独立历史）
├── scripts/create-fixture.sh   # 生成演示仓库
└── docs/architecture.md
```

---

## 4. 数据模型（5 张表）

| 表 | 职责 | 关键字段 |
| :--- | :--- | :--- |
| `repositories` | 仓库配置 | `git_url`、`default_branch`、`rules_config`(JSON) |
| `tasks` | 审查任务 | `status` 状态机、`result`(JSON)、**唯一索引 `(repo_id, mr_id, commit_sha)` 防重** |
| `file_snapshots` | 文件哈希缓存 | `file_path`、`content_hash`(MD5) |
| `export_symbols` | 导出符号反向索引 | `symbol_name`、`symbol_type`、`importers`(JSON)、索引 `(repo_id, file_path, symbol_name)` |
| `feedbacks` | 人工反馈 | `action`(adopt/reject/false_positive)、`comment` |

**任务状态机**：`pending → parsing → analyzing → reporting → done / failed`

---

## 5. 核心流程（时序）

```
Webhook / 手动触发
   → enqueueTask：按 gitUrl 找/建仓库，插入 Task（唯一索引防重）
   → 调度器每 5s 轮询 pending，最多取 3 条
   → 原子认领（updateMany WHERE status=pending 防并发重复）
   → 启动 Worker Thread
        ├─ git clone / fetch 仓库到 .cache/repos/<repoId>
        ├─ git diff base...head --name-only → 变更文件
        ├─ 全量 Babel AST 解析 → 提取导出符号 + import
        ├─ 构建反向索引：`文件#符号 → [引用它的文件]`
        ├─ 变更符号 diff：对比 base/head 导出签名（新增/删除/改参数个数）
        ├─ 影响链路：每个变更符号 → 反向查 importers
        └─ postMessage 回传 { result, symbolTable }
   → 主线程 persistSymbolTable（file_snapshots + export_symbols）
   → 更新 task.status = done，写入 result（影响链路 + 风险汇总）
   → 前端轮询 / SSE 感知完成后刷新展示
```

---

## 6. 关键技术决策（对应需求文档第六章）

| 难点 | 方案 | 落地位置 |
| :--- | :--- | :--- |
| AST 遍历阻塞主线程 | `worker_threads` 隔离 CPU，主线程只做 IO | `src/worker/analyze.worker.cjs` |
| 多 MR 并发耗尽资源 | 数据库状态机 + `setInterval` 轮询，信号量限 3 | `src/lib/scheduler.ts` |
| Webhook 重复触发 | Prisma 唯一索引 `(repoId, mrId, commitSha)` + P2002 幂等返回 | `src/lib/enqueue.ts` |
| 大仓全量扫描太慢 | 文件 MD5 哈希缓存 + 只 diff 变更文件 | `file_snapshots` 表 |
| 跨文件引用追踪 | 反向索引表：每个导出符号存「谁引用它」 | `export_symbols.importers` |

> 说明：Worker 全量解析保证正确性（Babel 解析百级文件 < 1s，满足 M2 的 8s 验收）；`file_snapshots` 哈希缓存 + 增量「跳过未变文件重解析」已在 M2 收尾落地。

---

## 7. 里程碑映射

| 里程碑 | 内容 | 本项目状态 |
| :--- | :--- | :--- |
| **M1 骨架** | Prisma 建表 + Webhook 防重 + 任务入队 | ✅ 已实现 |
| **M2 Worker 核心** | git + AST + 导出符号 + 缓存 + 影响链路 | ✅ 已实现（增量缓存命中跳过重解析） |
| M3 规则引擎 | 27 条 AST 硬规则 + LangGraph 双轨 | ✅ 已实现（确定性规则引擎 + AI 语义引擎） |
| M4 前端联调 | SSE 实时进度 + Monaco Diff + 任意 head | ✅ 已实现（跳过 AntD，自研轻量 UI） |
| M5 安全门禁 | CVE 扫描 + 构建体积检测 + GitLab 状态互操作 | 🟡 部分完成（CVE + 体积已实现，GitLab 回写待做） |

---

## 8. 双轨审查引擎（M3）

- **确定性规则引擎**（`src/worker/rules.cjs`，0 Token）：AST 硬规则捕获高风险变更，输出 `{ severity, confidence }` 三档（`proven`=自身即证据可直接门禁 / `heuristic`=经验判断需人工复核 / `uncertain`=归不了类交 AI）。规则覆盖函数签名 10 类、type/interface 字段 8 类、enum 成员 2 类、class 成员 5 类，外加 renamed/removed/added 三类变更分支，共 27 条查表规则。判据遵循 semver：删 / 收紧 = breaking（high），增 / 放宽 = 兼容（low）。
- **AI 语义引擎**（`src/lib/ai/`，M3b）：规则引擎判为 `uncertain` 的变更才送入 LangGraph，管线 `问题重述 → 上下文检索 → 影响面预测 → 修复建议` 4 节点，用 DeepSeek 产出 severity/confidence/suggestion 并合并回 impactChain。AI 不可用（无 key / 调用失败）时静默降级，保留原 uncertain 结果，不影响任务成功。
- **成本**：80% 由规则搞定，AI 只覆盖 20%，月 Token 可控在 $200 内。

---

## 9. 安全门禁（M5，部分完成）

> 定位：把「代码副作用」审查扩展到「依赖安全」维度，产出与影响链路并列的第二份门禁报告。当前已完成 CVE 扫描 + 构建体积检测，GitLab 状态回写待做。

### 数据流

```
scheduler.processTask()
  └─ runAnalysis(worker)           # AST 影响链路
  └─ enrichUncertain(result)        # M3b AI 语义判定
  └─ enrichSecurity(result, workdir) # M5 安全门禁（失败静默降级）
       ├─ readManifest()            # 读 package.json + package-lock.json 提取依赖清单
       ├─ scanVulnerabilities()     # 完整依赖树 → npm Bulk Advisory 端点
       └─ measureBundleSize()       # 顶层依赖 → npm registry 查 unpackedSize
```

### 依赖清单（`src/lib/security/dependency-manifest.ts`）

- `direct`：`package.json` 的 dependencies + devDependencies（顶层直接依赖），有 lockfile 时版本被精确覆盖
- `all`：`package-lock.json` 的 `packages` 字段完整依赖树（含传递依赖、scoped、嵌套路径）
- 非 npm 项目（无 `package.json`）返回 null，安全门禁整段跳过

### CVE 扫描（`src/lib/security/cve-scan.ts`）

- 端点 `POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk`，请求 `{ "包名": ["版本"] }`，返回每个包匹配的 advisory
- 完整依赖树提交（能发现传递依赖漏洞），`isDirect` 标记是否顶层
- severity 保留 npm 四档（critical/high/moderate/low），前端映射 badge

### 构建体积检测（`src/lib/security/bundle-size.ts`）

- 顶层依赖逐包查 `GET /{pkg}/{version}` 的 `dist.unpackedSize`（scoped 包 `/` 编码为 `%2F`）
- 8 并发 + 单包失败静默跳过；累计总体积 + 最大单包
- 门禁阈值：总依赖 100MB（`exceeded` 布尔）

### GitLab 状态回写（`src/lib/status/gitlab-status.ts`）

- 入队时从 GitLab MR webhook 提取 `project.id` 存为 `task.gitlabProjectId`，`source` 标记任务来源
- 任务 `done` / `failed` 后调 GitLab Commit Status API：`POST {host}/api/v4/projects/{projectId}/statuses/{sha}?state=...&name=...`，header `PRIVATE-TOKEN`
- 状态映射：`done` + high 漏洞 > 0 → `failed`；`done` 无 high → `success`；任务 `failed` → `failed`；其他 → `running`
- 前置条件不满足（非 gitlab-mr 来源 / 无 projectId / 无 `GITLAB_TOKEN` / gitUrl 非法）时直接跳过返回 false

### 降级策略

与 `enrichUncertain` 同定位——「尽力而为」增强：读清单 / CVE / 体积 / GitLab 回写任一步失败只打日志，任务仍 `done`，只是缺 `vulnerabilities` / `bundleSize` 字段或未回写门禁状态，前端「安全门禁」卡片按需渲染。
