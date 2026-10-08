# code-guardian 实施计划

基于代码审查发现的问题，按优先级分阶段实施。

---

## 阶段 0：基础设施修复（P0 - 本 Sprint 必做）

### 0.1 修复测试运行器
**问题**：41 个测试 `Invalid URL`（tsx ESM loader 无法 resolve mock 模块）

**方案 A（推荐）**：迁移到 Jest
```bash
npm i -D jest @types/jest ts-jest
# jest.config.ts: preset: 'ts-jest', testEnvironment: 'node', moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' }
# package.json: "test": "jest"
```
- 支持 `jest.mock('@prisma/client')` 完美工作
- 生态成熟、CI 缓存友好

**方案 B**：修现有 `node:test + tsx`
- 需要 `--experimental-vm-modules` + 自定义 loader
- 维护成本高，不推荐

**验收**：`npm test` 全绿（232+ 通过，0 失败）

---

### 0.2 加 CI 流水线
**文件**：`.github/workflows/ci.yml`
```yaml
jobs:
  ci:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_PASSWORD: test }
        ports: [5432:5432]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npx prisma generate
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
```

**验收**：PR 提交自动跑 CI，失败阻断合并

---

### 0.3 Worker 路径提取常量（消除 4 处同步点）
**新建文件**：`src/lib/worker-path.ts`
```typescript
export const WORKER_ENTRY_PATH = 'worker/analyze.worker.cjs';

export function getWorkerPath(): string {
  return path.join(process.cwd(), WORKER_ENTRY_PATH);
}
```
**修改 4 处引用**：
- `src/lib/run-analysis.ts`
- `scripts/scan-repo.cjs`
- `tests/analyze-worker.test.cjs`
- `tests/run-analysis.test.ts`

**验收**：改文件名/目录名只需改 1 处，编译期即报错

---

## 阶段 1：可观测性与部署就绪（P1 - 下 Sprint）

### 1.1 结构化日志
**引入**：`pino` + `pino-pretty`
```bash
npm i pino pino-pretty
```
**新建**：`src/lib/logger.ts`
```typescript
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV !== 'production' 
    ? { target: 'pino-pretty', options: { colorize: true } } 
    : undefined,
});

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
```
**全码库替换**：`console.log/error` → `logger.info/error({taskId, repoId}, msg)`

**验收**：日志为 JSON，含 `taskId`/`repoId`，可接入 Loki

---

### 1.2 Monaco Editor 本地打包（离线部署支持）
**现状**：Turbopack 下 webpack 插件失效，强制走 CDN

**方案**：
1. `next.config.ts` 启用 `monaco-editor-webpack-plugin` 输出到 `public/monaco`
2. `DiffViewer.tsx` 指向本地路径：`monacoBaseUrl: '/monaco'`
3. 或 vendor 方案：`npm i monaco-editor` 后拷贝 `node_modules/monaco-editor/min/vs` 到 `public/vs`

**验收**：断网环境 `npm run build && npm start`，Diff 视图正常渲染

---

### 1.3 健康检查端点
**新建**：`src/app/api/health/route.ts`
```typescript
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: 'ok', db: 'connected' });
  } catch {
    return NextResponse.json({ status: 'degraded', db: 'disconnected' }, { status: 503 });
  }
}
```
**验收**：`curl /api/health` 返回 200/503，供 k8s liveness/readiness 探针

---

## 阶段 2：数据层与测试深化（P2 - 2-3 Sprint）

### 2.1 JSON 列迁移到关系表
**Prisma migrate**：
```prisma
model ExportSymbol {
  // 现有字段保留
  // 删除 importers Json
}

model SymbolImporter {
  id         String       @id @default(cuid())
  exportSymbolId String   @map("export_symbol_id")
  filePath   String       @map("file_path")
  exportSymbol ExportSymbol @relation(fields: [exportSymbolId], references: [id], onDelete: Cascade)
  @@unique([exportSymbolId, filePath])
  @@map("symbol_importers")
}
```
**迁移脚本**：读现有 JSON，批量写入新表
**代码修改**：`persist.ts`、`analyze-worker.cjs` 反向索引构建逻辑

**验收**：反向索引查询用 SQL JOIN，大仓库 < 100ms

---

### 2.2 集成测试骨架
**技术栈**：Testcontainers (PostgreSQL) + 临时 Git 仓库 (git init --bare)

**测试场景**：
| 场景 | 验证点 |
|------|--------|
| GitLab MR webhook 入队 → 调度 → Worker → 持久化 → GitLab 回写 | 全链路通 |
| GitHub push 事件 | 适配器字段映射正确 |
| 并发 3 任务 | MAX_CONCURRENT 生效、无竞态 |
| Worker 超时 | 任务标记 failed、槽位释放 |
| 增量缓存命中 | 第二次分析 cacheHits > 0 |
| CVE 扫描失败 | 降级不阻断主流程 |

**目标**：核心 6 条链路 100% 覆盖

---

## 阶段 3：架构演进（P3 - 中长期）

### 3.1 调度器 Redis 化（水平扩展）
**替换**：内存 `running` + `activeWorkdirs` → Redis
- 分布式锁：`SET task:{id}:lock NX EX 300`
- 任务队列：BullMQ / Redis Streams
- 缓存淘汰：Redis SET 存 `workdir:lastUsed`，Lua 脚本原子淘汰

**验收**：`docker compose up --scale app=3` 无重复处理、无槽位泄漏

---

### 3.2 API 版本化
**策略**：URL 前缀 `/api/v1/`
- `v1` 维护现有契约
- `v2` 引入 breaking changes（如响应格式统一、错误码规范）
- Webhook 端点同时支持 `v1`、`v2`（按 Header `Accept-Version` 路由）

---

### 3.3 配置外部化
**迁移**：所有魔法数字 → 环境变量 / 配置表
```typescript
// src/lib/config.ts
export const config = {
  maxConcurrent: Number(process.env.MAX_CONCURRENT ?? 3),
  taskTimeoutMs: Number(process.env.TASK_TIMEOUT_MS ?? 300000),
  workerTimeoutMs: Number(process.env.WORKER_TIMEOUT_MS ?? 240000),
  gitTimeoutMs: Number(process.env.GIT_TIMEOUT_MS ?? 120000),
  pruneIntervalMs: Number(process.env.PRUNE_INTERVAL_MS ?? 600000),
};
```

---

## 阶段 4：代码质量与安全加固（持续）

### 4.1 Worker 终止竞态修复
```typescript
// run-analysis.ts
worker.once('exit', async (code) => {
  if (settled) return;
  settled = true;
  done();
  await worker.terminate(); // await 确保线程真退出
  reject(...);
});
```

### 4.2 预留字段清理
- `rulesConfig`：要么实现规则热更新，要么删除/迁移到独立表
- 加 `@deprecated` 注释或删除

### 4.3 GitHub fork PR 支持（可选）
- Webhook 适配器检测 fork → 自动 `git fetch origin pull/<id>/head:<ref>`
- 或文档明确标注「不支持 fork PR，请用同仓 PR」

---

## 里程碑汇总

| 里程碑 | 交付物 | 预计工时 | 依赖 |
|--------|--------|----------|------|
| M0 | 测试全绿 + CI 跑通 | 4-6h | 无 |
| M1 | 结构化日志 + 离线 Monaco + 健康检查 | 6-8h | M0 |
| M2 | JSON→关系表 + 6 条集成测试 | 16-24h | M0 |
| M3 | Redis 调度器 + API 版本化 | 24-32h | M2 |
| M4 | 配置外部化 + 终止竞态 + 清理 | 4-6h | M1 |

---

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Jest 迁移现有测试需改写 | 延期 | 先跑通核心 50 个测试，其余渐进式迁移 |
| Monaco 本地打包 Turbopack 冲突 | 方案不可行 | 备选：vendor 到 public/vs，绕过打包器 |
| JSON 迁移数据量大 | 停机时间长 | 双写过渡期 + 在线迁移脚本 |
| Redis 引入运维复杂度 | 部署成本 | 先用托管 Redis (Upstash/云厂商)，后自建 |

---

## 立即行动项（今天可开始）

1. [ ] `npm i -D jest @types/jest ts-jest` + `jest.config.ts`
2. [ ] 修好 1 个涉及 Prisma 的测试（如 `enqueue.test.ts`）验证 mock 生效
3. [ ] 新建 `src/lib/worker-path.ts`，改 4 处引用
4. [ ] 写 `.github/workflows/ci.yml`

---

**确认后进入执行模式**，按 M0 → M1 → M2 顺序推进。
