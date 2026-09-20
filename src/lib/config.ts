// 集中配置：所有环境变量**只在这里读一次**，其余模块一律通过 `getConfig()` 取。
//
// 为什么要有这一层（此前的问题）：`process.env.X` 散落在各 route / lib 里，
// 同一个变量在不同文件的判空口径还可能不一致（有人 `if (!v)`、有人 `if (v === undefined)`），
// 加新变量时要靠 grep 才知道漏了哪处。集中之后：读的地方只有一个，口径也只有一个。
//
// 🔴 两条硬约束（改这个文件前必读）：
//
// 1. **模块顶层绝不 throw**。`next build` 会执行被 import 模块的顶层代码 ——
//    顶层做校验会让「没配 DATABASE_URL」直接变成**构建失败**，而我们希望它是**启动失败**
//    （构建机通常没有数据库）。所以校验拆成独立的 `validateConfig()`，只在启动时显式调用。
//
// 2. **`null` 的语义是「该能力关闭」，不是「配置错了」**。
//    本项目对两个写端点采用 **fail-closed**：未配 token/secret 时接口返回 503 拒绝服务，
//    而不是「没配就不校验」（后者等于公网敞开，会替别人付 DeepSeek 的钱）。
//    因此 `manualTriggerToken` / `webhookSecret` 为 null 时，**调用方必须继续拒绝**，不能放行。
//    同理 `deepseekApiKey` = null → 跳过 AI 判定但报告照出；`gitlabToken` = null → 静默跳过回写。

export type AppConfig = {
  /** Prisma 连接串。**唯一必填项** —— 没有它项目完全不能工作。 */
  databaseUrl: string | null;
  /** 手动触发口令。null → `POST /api/tasks` 返回 503（fail-closed）。 */
  manualTriggerToken: string | null;
  /** Webhook 来源校验密钥。null → `POST /api/webhook` 返回 503（fail-closed）。 */
  webhookSecret: string | null;
  /** DeepSeek Key。null → 跳过 AI 语义判定，报告照常产出。 */
  deepseekApiKey: string | null;
  /** GitLab Token。null → 静默跳过 Commit Status 回写。 */
  gitlabToken: string | null;
  /** 出网代理（`HTTPS_PROXY` 优先，其次 `HTTP_PROXY`）。null → 直连。 */
  proxy: string | null;
  isProduction: boolean;
};

/** 空串 / 全空白一律视为「未配置」—— 与原先 `if (!value)` 的判空口径保持一致。 */
function blank(value: string | undefined): string | null {
  const s = (value ?? "").trim();
  return s === "" ? null : s;
}

/** 读代理：HTTPS_PROXY 优先；去掉 `http(s)://` 前缀（下游只认 host:port）。
 *  刻意不做大小写不敏感匹配 —— 与原先 deepseek.ts 的正则保持完全一致，避免改出新行为。 */
function readProxy(): string | null {
  const raw = (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "").trim();
  if (raw === "") return null;
  return raw.replace(/^https?:\/\//, "");
}

// 刻意**不做进程内缓存**：读几个 `process.env` 属性是纳秒级操作，在 HTTP 请求里完全不可测，
// 而缓存会引入一个真实陷阱 —— 改了 env 却读不到新值（单测改 env 就会踩，实测挂了 3 条；
// 其中一条因此拿到了 token，真的去请求 GitLab 拿到 401）。缓存在这里是纯负资产，故不缓存。

/** 取配置。**不会抛错** —— 缺项一律是 null，由调用方按 fail-closed 处理。 */
export function getConfig(): AppConfig {
  return {
    databaseUrl: blank(process.env.DATABASE_URL),
    manualTriggerToken: blank(process.env.MANUAL_TRIGGER_TOKEN),
    webhookSecret: blank(process.env.WEBHOOK_SECRET),
    deepseekApiKey: blank(process.env.DEEPSEEK_API_KEY),
    gitlabToken: blank(process.env.GITLAB_TOKEN),
    proxy: readProxy(),
    isProduction: process.env.NODE_ENV === "production",
  };
}

/** 启动时校验必填项。**只在入口（instrumentation.ts）调用一次** —— 见本文件顶部约束 1。 */
export function validateConfig(): { ok: true; missing: [] } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  const c = getConfig();
  if (!c.databaseUrl) missing.push("DATABASE_URL");
  if (missing.length === 0) return { ok: true, missing: [] };
  return { ok: false, missing };
}
