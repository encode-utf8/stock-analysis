// Next.js 服务端启动钩子：进程启动即注册定时任务。
// 修复的缺口：此前只有访问 admin 接口才会调用 startScheduler()，无人访问时清理 / 预警扫描 / 日报探测会静默停摆。
// 构建阶段、Edge 运行时不注册；设置 SKIP_INPROCESS_SCHEDULER=1 可关闭进程内 cron（改由独立 worker 守护）。

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }
  if (process.env.SKIP_INPROCESS_SCHEDULER === "1") {
    console.log("[scheduler] SKIP_INPROCESS_SCHEDULER=1，已跳过进程内定时任务注册。");
    return;
  }

  const { startScheduler } = await import("@/lib/scheduler");
  startScheduler();
}
