# Code Guardian · AI 代码副作用检测与审查治理平台

在 MR 合并前自动分析 **「这次改动影响了哪些函数、哪些文件」**，作为合并门禁依据。
ESLint 查不出变量污染，Code Review 人工又太慢——本平台用 **AST 增量分析 + 反向索引** 把影响链路自动算出来。

> 当前进度：**M1（骨架）+ M2（Worker 核心）已跑通**。规则引擎 / AI 双轨 / 安全门禁见 [架构文档](docs/architecture.md) 里程碑部分。

---

## 核心能力（已实现）

| 能力 | 说明 |
| :--- | :--- |
| Webhook 接收 | `POST /api/webhook` 幂等入队，唯一索引防重 |
| 手动触发 | 首页粘贴仓库地址 + base/head ref 即可分析 |
| AST 分析引擎 | `@babel/parser` + `@babel/traverse`，跑在 `worker_threads` 里，不阻塞主线程 |
| 导出符号提取 | 解析 `export` 得到每个文件的导出函数/变量 |
| 跨文件引用追踪 | 反向索引表：每个符号存「谁引用它」→ 改一个函数立刻知道影响范围 |
| 影响链路 | 对比 base/head 导出签名，输出「文件 → 符号 → 变更类型 → 影响文件」 |
| 任务调度 | 数据库状态机 + 5s 轮询 + 信号量限 3 并发，无 Redis/队列 |
| 哈希缓存 | `file_snapshots` 存 MD5，`export_symbols` 存反向索引 |

---

## 技术栈

- **Next.js 16**（App Router）+ **React 19** + **TypeScript**（strict）
- **Prisma 6** + **PostgreSQL**（Neon 云库）
- **@babel/parser / @babel/traverse**（AST）
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
prisma/            schema（5 张表）+ seed
src/app/           页面（首页 + 报告页）+ API 路由（webhook / tasks）
src/lib/           调度器 · 单例 · 入队 · 持久化 · 类型
src/worker/        Worker 线程（git + AST + 反向索引 + 影响链路）
src/components/    状态步骤 · 风险总览 · 影响链路表
fixtures/          演示用 git 仓库
docs/              架构文档
```

详见 [docs/architecture.md](docs/architecture.md)。

---

## 脚本

| 命令 | 作用 |
| :--- | :--- |
| `npm run dev` | 启动开发服务器（含调度器） |
| `npm run build` | 生产构建 |
| `npm run typecheck` | `tsc --noEmit` 类型检查 |
| `npm test` | 运行引擎纯函数单元测试（Node 内置 `node:test`） |
| `npm run prisma:migrate` | 迁移（开发） |
| `npm run prisma:studio` | Prisma Studio 可视化查库 |
| `npm run fixture` | 生成演示仓库 |
| `npm run seed` | 灌入种子数据 |
