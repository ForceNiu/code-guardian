# 全量结构审计（重跑）· 2026-09-17

> **编号约定**：本轮一律用 **`ST` 前缀**（`ST1`–`ST4`）。
> 开工前已扫台账占用表：既有 ID 为 `A3` / `B1`–`B3` / `C1`–`C7` / `D5` / `E3`–`E4` / `N1`–`N3` / `S1`–`S10` / `T1`–`T8`，
> `ST` 完全空余 —— 特意避开 `S`，因为 `S1`–`S10` 已在用，`ST1` 与 `S1` 并排出现易被误读。

## 为什么重跑这一轮

第五批（PR **#20**）已对 **86 个入库文件**做过一次全项目结构审计，结论是
「0 条失效导入 / 0 个漏跑测试 / 0 个漏入库 / 23 条未引用导出全是正常冗余」。

本轮动因是用户要求**「不放过任何文件」再核一次**。与第五批的实质差别有两个：

1. 仓库从 **86 → 87 个跟踪文件**（新增 `docs/G1-KICKOFF.md`），且 `main` 已从 `3f804d43` 前进到 `21a3d7e6`；
2. **换了一个更强的口径**：不只问「有没有漏」，而是把「磁盘上的文件」与「git 清单」做**逐字节差集**，
   并额外追问一句 —— **「扫描面本身有没有洞」**（本轮独有的第 3 步，`ST1` 就是这一步逮到的）。

## 方法

| 步 | 手段 | 产出 |
|---|---|---|
| 1 | `git ls-files` × `git status --porcelain --ignored=matching` | 三层归属：**跟踪 87 / 忽略 8 类 / 未跟踪 2**（第六批 + 本批的报告） |
| 2 | 引用完整性脚本（`repo-structure-audit` 技能 `audit-refs.cjs`：解析真实 import + 用 `fs.existsSync` 解析路径） | ① 失效导入 ② 无 import 引用 ③ 未引用导出 ④ md 链接 + 孤儿文档 |
| 3 | **复刻脚本的 walk 排除逻辑**，与 `git ls-files` 求差集 | **扫描面是否有洞** |

> 🔴 为什么必须有第 3 步：前两步只能证明「**扫到的那些**文件没问题」，
> **证明不了「该扫的都扫到了」**。第 3 步就是专门问这一句的 —— 它真的逮到一个（见 `ST1`）。

## 全过项（先说没问题的）

1. **① 解析不到的 import：0 条**（脚本退出码 0）。
2. **④ markdown 本地链接：18 条，失效 0 条**。第五批修过的那处
   （`docs/reports/E2E-VERIFICATION-2026-09-16.md` 里漏写成 `](DEVELOPING.md)`）已保持正确。
3. **② 无 import 引用的文件：3 个，逐个人工确认，全部有「运行时 / 命令入口」解释**：

   | 文件 | 为什么「没人 import」是正常的 |
   |---|---|
   | `worker/analyze.worker.cjs` | 只被 `path.join(process.cwd(), "worker", …)` 这类**运行时字符串**加载（`docs/DEVELOPING.md` 文件地图已标注） |
   | `scripts/scan-repo.cjs` | 由 `package.json` 的 `"scan"` script 拉起 |
   | `docs/demo-ai-uncertain/build-report.mjs` | 文件头自带用法注释，手动执行 |

   → **0 个真死文件。**

4. **③ 24 条「未引用导出」分类完毕，无一条是真死代码**：
   - **16 条 type-only**：`types.ts` ×7、`gitlab-status.ts` ×3、`webhook-adapters.ts` ×3、
     `semantic-graph.ts` 的 `AIJudgement`、`badge.tsx` 的 `BadgeProps`、`button.tsx` 的 `ButtonProps`
   - **3 条值导出、但同文件内部在用 / 已被文档点为扩展点**：`badgeVariants`、`buttonVariants`、
     `buildSemanticGraph`（后者还写在 `README.md` 的扩展指南里）
   - **5 条见 `ST4`**（`card.tsx` 的 5 个子组件）
5. **未跟踪文件：2 个** —— 两份审计报告自身（第六批 `docs/reports/TEXT-AUDIT-2026-09-17.md` + 本报告），均预期内。
6. **忽略层 8 类全部在 `.gitignore` 里写了理由**：`node_modules/`、`.next/`、`.cache/`、`fixtures/`、
   `docs/reports/e2e-logs/`、`.env`、`next-env.d.ts`、`tsconfig.tsbuildinfo`。
   其中 `e2e-logs/` 的理由写得最完整（含「这些文件带本机绝对路径与内网 IP，不入库即无需长期维护脱敏」）。
7. **无 0 行 / 占位 / stub 文件**：行数最小的 25 个全部有意义 —— 最小的是 2–3 行的 `ALTER` 迁移 SQL
   与 6 行的 `cn()` 工具（`src/lib/utils.ts`）。

## 发现

| # | 发现（含位置） | 性质 | 处理 |
|---|---|---|---|
| **ST1** | 审计脚本的 walk **跳过一切点开头的目录** → **`.github/workflows/ci.yml` 静默逃出扫描面**（脚本报「扫描 90 个文件」，而磁盘上是 91）。它是全仓**唯一**位于点目录下的跟踪文件 | 🔴 **工具自身缺陷（假阴性方向）** | ✅ 已修脚本（放行 `.github`）；修后重跑 = **91** |
| **ST2** | 「孤儿文档」判定**只看 markdown 链接** → `docs/G1-KICKOFF.md` 被误报为孤儿（实际被 **3 处**以 `` `docs/G1-KICKOFF.md` `` 形式纯文本提及：`docs/AUDIT-BACKLOG.md`、`docs/DEVELOPING.md`、`docs/reports/TEXT-AUDIT-2026-09-17.md`） | 🟡 **工具自身缺陷（假阳性方向）** | ✅ 已修脚本（增列 basename 提及处）；修后 ④b 能区分「被提及」与「真孤儿」 |
| **ST3** | **两份新报告都没有 markdown 链接指向它们**：`docs/reports/TEXT-AUDIT-2026-09-17.md` 与 `docs/reports/STRUCTURE-AUDIT-2026-09-17.md` 目前**只被纯文本提及**、链接为 0 | 🟢 真问题（很轻） | 🔜 见台账 §二.10 |
| **ST4** | `src/components/ui/card.tsx` 的 **5 个子组件从未被渲染**（`CardHeader` / `CardFooter` / `CardTitle` / `CardDescription` / `CardContent`）—— 只有 `Card` 本体被 `src/app/page.tsx` 使用 | 🟡 真·未使用导出 | 🔜 见台账 §二.10（登记，倾向不删） |

> 📌 `ST4` 有一份有意思的旁证：**产品自己的引擎早就报过同一件事**。
> 本地 E2E 产物 `docs/reports/e2e-logs/scan-R0-codeguardian-OLDWINDOW.log`（该目录**有意不入库**，此处仅作路径说明）
> 里有两行 `card.tsx#CardHeader | added | proven | 引用 0`。
> —— 外部审计脚本与自研引擎在同一个结论上对上了，这本身是对引擎的一个正反馈。

## 关于 ST1 / ST2 的元教训

这两条都不是**被审对象**的毛病，而是**审计工具**的毛病。它们能暴露出来，靠的是第 3 步那句
「**磁盘上是多少个？脚本报的是多少个？**」—— 如果只跑脚本、照抄它的输出，`90` 这个数字会被当成事实，
`.github/workflows/ci.yml` 会**永远**不在任何自动检查的覆盖范围内。

→ 已把这两条写进技能 `repo-structure-audit` 的「其他硬坑」，并写明通用判据：
**「扫描 N 个文件」这个数字必须等于磁盘上的文件数（扣除预期排除项），不等就说明有目录被静默吞掉。**

## 附录 · 自指漂移（本报告自己造成的变化）

**写这份报告这件事本身改变了审计结果。** 必须记下来，否则按本文档复现的人会以为数字对不上：

| 指标 | 审计主体（写入本报告**前**） | 含本报告的最终态 |
|---|---|---|
| 扫描文件数 | **91** | **92** |
| markdown 数 | 11 | 12 |
| ④b「无 markdown 链接引用」的文档 | **2** | **3** |

更关键的是：**`ST3` 的原始结论被这份报告自己推翻了。**
写入前，`docs/reports/TEXT-AUDIT-2026-09-17.md` 是「全仓零提及」的**真孤儿**；
本报告在发现表里写出了它的文件名之后，它立刻变成「被 1 处纯文本提及」。

→ **「某文件零提及」这类断言，在一份会引用别人的文档里天然自毁** —— 与技能 §⑥ 的「自指计数」是同一族错误。
→ **正确表述**：只写「**怎么量**」（给出命令），并把「当时量出来是多少」明确标成**时点快照**、附一句「用前复测」。

---

## 复现

```bash
# 1) 引用完整性（本报告写入后应输出「扫描：92 个文件」且退出码 0；写入前为 91）
#    注意：「扫描数」会随报告入库而变 → 用前复测，别把 92 当成永久值
node <repo-structure-audit>/scripts/audit-refs.cjs <仓库根>

# 2) 三层归属
git ls-files | wc -l                        # 87
git status --porcelain --ignored=matching   # 忽略 8 类
git ls-files --others --exclude-standard    # 未跟踪（本批为 2：两份审计报告）
```
