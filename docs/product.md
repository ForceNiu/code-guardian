# Code Guardian · 产品文档

> AI 代码副作用检测与审查治理平台 —— 完整产品说明

---

## 1. 产品概述

**一句话定位**：在 MR 合并前，自动算出「这次改动影响了哪些函数、哪些文件」，再叠加依赖安全门禁，作为代码合并的自动化审查依据。

传统 linter（如 ESLint）只能查语法问题，查不出「改了这个导出函数，谁在调用它、谁会被连带影响」；人工 Code Review 面对大 MR 又慢又容易漏。Code Guardian 用 **AST 增量分析 + 反向索引** 自动算出影响链路，再用 **确定性规则引擎（80%）+ AI 语义引擎（20%）** 双轨给出门禁结论，最后叠加 **依赖安全门禁（CVE 扫描 + 体积检测）**，把「代码副作用」审查从「代码」维度扩展到「依赖安全」维度。

---

## 2. 背景与痛点

| 痛点 | 现有方案的不足 | Code Guardian 的解法 |
| :--- | :--- | :--- |
| 改名 / 删函数影响面不可见 | ESLint 只查语法，查不出「谁引用了这个被改的导出」 | AST 反向索引：改一个符号，立刻知道影响哪些文件 |
| 人工 Review 慢、易漏 | 大 MR 跨文件引用靠人脑记，容易漏看连带影响 | 自动算影响链路，Review 聚焦高风险变更 |
| 依赖带漏洞无人盯 | 合并了才发现依赖有 CVE，回滚成本高 | 依赖 CVE 扫描 + 体积门禁，合并前拦截 |
| 全量 AI 审查成本高 | 每个变更都送 LLM，Token 成本不可控 | 规则引擎兜底 80%，AI 只覆盖 20% 的 uncertain 变更 |

---

## 3. 目标用户与使用场景

**目标用户**

- 用 GitLab / GitHub 做 MR 协作、需要合并门禁的研发团队
- 负责工程质量 / Code Review 的负责人（要「红绿灯」当合并依据）
- 在意依赖安全、想拦截高危 CVE 的项目维护者

**使用场景**

| 场景 | 入口 | 结果 |
| :--- | :--- | :--- |
| MR 自动审查 | GitLab MR / GitHub PR / push Webhook 自动触发 | 分析完成后回写 commit status（红绿灯），作为合并门禁 |
| 手动即时分析 | 首页粘贴仓库地址 + base/head ref | 直接生成影响链路报告，无需配 Webhook |
| 依赖安全体检 | 分析流程自动附带 | 报告页「安全门禁」卡片展示 CVE 漏洞 + 体积门禁 |

---

## 4. 核心功能

| 能力 | 说明 |
| :--- | :--- |
| 多源 Webhook | `POST /api/webhook` 幂等入队，适配 GitLab MR / GitHub push / GitHub PR，唯一索引防重 |
| 手动触发 | 首页粘贴仓库地址 + base/head ref 即可分析 |
| AST 分析引擎 | `@babel/parser` + `@babel/traverse`，跑在 `worker_threads` 里，不阻塞主线程 |
| 导出符号提取 | 解析 `export` 得到每个文件的导出函数/变量，支持任意历史提交当 head 对比 |
| 跨文件引用追踪 | 反向索引表：每个符号存「谁引用它」→ 改一个函数立刻知道影响范围 |
| 确定性规则引擎 | 27 条查表规则（函数签名/字段/别名/重命名导出/enum/class），semver 判据 + confidence 三档 |
| AI 语义引擎 | 规则判为 `uncertain` 的变更送 LangGraph 4 节点（DeepSeek）补判定，失败静默降级 |
| 影响链路 | 对比 base/head 导出签名，输出「文件 → 符号 → 变更类型 → 影响文件」 |
| 任务调度 | 数据库状态机 + 5s 轮询 + 信号量限 3 并发，无 Redis/队列 |
| 实时进度 | SSE（`text/event-stream`）推送解析/分析各阶段状态，断线自动降级轮询 |
| Monaco Diff | 新旧文件左右对比，高亮副作用行 |
| 哈希缓存 | `file_snapshots` 存 MD5，`export_symbols` 存反向索引 |
| 安全门禁 | CVE 依赖漏洞扫描（npm Bulk Advisory）+ 依赖体积门禁（unpackedSize 累计 + 100MB 阈值）+ GitLab Commit Status 回写（MR 合并红绿灯） |

---

## 5. 使用流程

```
接入（三选一）
  ├─ GitLab / GitHub Webhook  → 自动入队
  ├─ 首页手动粘贴仓库地址     → 手动触发
  └─ seed 灌入演示任务        → 演示数据

分析（调度器自动执行）
  ├─ git clone/fetch 仓库
  ├─ git diff base...head    → 变更文件
  ├─ Babel AST 解析          → 导出符号 + 反向索引
  ├─ 变更符号 diff           → 影响链路
  ├─ 规则引擎定级（80%）     → proven / heuristic / uncertain
  ├─ AI 语义引擎补判定（20%）→ 仅 uncertain 送 LangGraph
  └─ 安全门禁（CVE + 体积）  → 依赖漏洞 + 体积门禁

报告与门禁
  ├─ 报告页：影响链路表 + 风险总览 + Monaco Diff + 安全门禁卡片
  └─ GitLab 回写 commit status（红绿灯）→ 合并门禁依据
```

---

## 6. 核心亮点与差异化

| 维度 | Code Guardian | ESLint | SonarQube / 人工 Review |
| :--- | :--- | :--- | :--- |
| 影响链路 | ✅ AST 反向索引，改一个符号知道影响面 | ❌ 只查单文件语法 | ⚠️ 靠人脑 / 静态规则，不追踪跨文件导出引用 |
| 判定方式 | 规则引擎（0 Token）+ AI 双轨 | 纯规则 | 纯规则 / 纯人工 |
| 依赖安全 | ✅ CVE + 体积门禁 | ❌ | ⚠️ 有但独立成体系 |
| 合并门禁 | ✅ GitLab commit status 红绿灯 | ❌ | ✅（需额外配置） |
| 成本 | AI 只覆盖 20%，Token 可控 | 免费 | 高（商业授权 / 人力） |

**三个核心差异化**：

1. **影响链路而非单纯告警**：不只告诉你「这里有个问题」，而是算出「这个变更连带影响了哪些文件」。
2. **双轨引擎控成本**：80% 的变更由 0 Token 的确定性规则搞定，AI 只覆盖 20% 的 uncertain，月 Token 可控在 $200 内。
3. **代码 + 依赖双维度门禁**：影响链路（代码副作用）+ 安全门禁（CVE / 体积）两份报告并列，一次 MR 审查同时覆盖代码与依赖。

---

## 7. 技术指标

| 指标 | 值 |
| :--- | :--- |
| 确定性规则 | 27 条查表（函数签名 10 类 / type/interface 字段 8 类 / enum 成员 2 类 / class 成员 5 类 + renamed/removed/added） |
| AI 语义引擎 | LangGraph 4 节点管线（重述→检索→预测→建议），DeepSeek |
| 单元测试 | 103 个，全绿 |
| CI 门禁 | `lint → typecheck → test → build` 四道，全绿 |
| 依赖 CVE 数据源 | npm Bulk Advisory（完整依赖树，含传递依赖） |
| 体积门禁阈值 | 累计 unpackedSize 100MB |
| 端到端实测 | fixture 扫出 30 条漏洞（high 14 / moderate 15 / low 1）+ 体积 1.69MB |
| 并发控制 | 数据库状态机 + 信号量限 3，无 Redis / 队列 |

---

## 8. 产品路线图

| 阶段 | 内容 | 状态 |
| :--- | :--- | :--- |
| M1 骨架 | Prisma 建表 + Webhook 幂等防重 + 任务入队 | ✅ 已实现 |
| M2 Worker 核心 | git + AST + 导出符号 + 哈希缓存 + 影响链路 | ✅ 已实现 |
| M3 规则引擎 | 27 条确定性规则 + LangGraph 双轨 | ✅ 已实现 |
| M4 前端联调 | SSE 实时进度 + Monaco Diff + 任意 head | ✅ 已实现 |
| M5 安全门禁 | CVE 扫描 + 体积门禁 + GitLab 状态回写 | ✅ 已实现 |
| 未来（可选） | 部署上线（Vercel + Neon）、真实 GitLab 集成验证、规则扩容、演示录屏 | ⏳ 规划中 |

---

## 9. 快速开始

详见 [README](../README.md) 的「快速开始」章节，核心步骤：

```bash
npm install                 # 装依赖
cp .env.example .env        # 配 Neon / 本地 Postgres
npx prisma migrate dev      # 建表
npm run fixture             # 生成演示仓库（含 lodash/axios 依赖）
npm run seed                # 灌入演示任务
npm run dev                 # 启动（调度器随 instrumentation 自动拉起）
```

打开 http://localhost:3000 即可看到自动分析出的影响链路 + 安全门禁报告。

---

## 相关文档

- [架构文档](./architecture.md) —— 系统架构、数据模型、关键技术决策
- [README](../README.md) —— 项目概览与快速开始
