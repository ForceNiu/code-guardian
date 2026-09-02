// Next.js 约定文件：服务启动时执行一次，用于拉起后台任务调度器。
// 仅在 Node.js runtime 下运行（Edge runtime 不支持 worker_threads）。
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startScheduler } = await import("@/lib/scheduler");
  startScheduler();
}
