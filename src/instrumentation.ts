// Next.js 约定文件：服务启动时执行一次，用于拉起后台任务调度器。
// 仅在 Node.js runtime 下运行（Edge runtime 不支持 worker_threads）。
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // 启动时集中校验必填配置（全部集中在 src/lib/config.ts 读）。
  // 取舍：**报错 + 不启动调度器**，而不是直接 throw 让进程退出 ——
  //   容器环境下数据库常比应用晚几秒就绪，throw 会变成崩溃重启循环；
  //   而调度器强依赖数据库，缺配置时它每 5 秒轮询只会刷一堆同样的错。
  //   所以这里大声报错（日志一眼可见），并让服务其余部分照常起来。
  const { validateConfig } = await import("@/lib/config");
  const check = validateConfig();
  if (!check.ok) {
    console.error(
      `[config] 缺少必填环境变量：${check.missing.join(", ")} —— 参照 .env.example 配置后重启`,
    );
    return;
  }

  const { startScheduler } = await import("@/lib/scheduler");
  startScheduler();
}
