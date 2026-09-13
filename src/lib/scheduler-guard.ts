// 定时任务守护层：统一调度表、过期判定与补跑编排。
// 设计目标：
// 1. SCHEDULE_TABLE 是调度表达式的单一事实来源，node-cron 注册与守护补跑共用同一份配置；
// 2. 过期判定与状态汇总为纯函数，注入「当前时间 / 最近运行状态 / 交易日历」，便于单元测试；
// 3. 补跑由 runSchedulerTick 串行执行，单项失败不影响其它任务，失败信息随结果返回。

import { dailyReportExists } from "@/lib/daily-report-store";
import type { DailyReportKind, JobRun } from "@/lib/shared/types";
import { beijingDateKey } from "@/lib/trading-calendar";
import { store } from "@/lib/store";

/** 任务新鲜度判定方式：interval 看「距上次运行多久」，daily 看「当天是否已运行」。 */
export type ScheduleFreshness = "interval" | "daily";

/** 单个定时任务的守护元数据。 */
export interface ScheduleEntry {
  /** 任务键：与 node-cron 任务名、守护结果、接口返回中的 key 保持一致。 */
  key: string;
  /** 中文展示名。 */
  label: string;
  /** 调度表达式所在的环境变量名。 */
  envKey: string;
  /** 未配置环境变量时使用的默认表达式。 */
  defaultCron: string;
  /** 新鲜度判定方式。 */
  freshness: ScheduleFreshness;
  /** interval 模式的过期阈值（分钟）；daily 模式忽略。 */
  staleAfterMinutes: number;
  /** 是否只在交易日补跑。 */
  tradingDayOnly: boolean;
  /** 当天最早可触发时刻（北京时区小时，0-23）；未到点不判过期，避免盘前误生成日报。 */
  earliestHour?: number;
  /** 写入 job_runs 时使用的 job_name。 */
  jobName: string;
  /** 日报类任务用它区分股市 / 基金（对应 job_runs.detail.kind）。 */
  detailKind?: DailyReportKind;
}

/** 与 startScheduler() 保持一致的任务清单（默认表达式即现有 cron 默认值）。 */
export const SCHEDULE_TABLE: readonly ScheduleEntry[] = [
  {
    key: "news-cleanup",
    label: "资讯清理",
    envKey: "CLEANUP_CRON",
    defaultCron: "0 3 * * *",
    freshness: "interval",
    staleAfterMinutes: 26 * 60,
    tradingDayOnly: false,
    jobName: "cleanup",
  },
  {
    key: "sample-quote-refresh",
    label: "样例行情刷新",
    envKey: "REFRESH_CRON",
    defaultCron: "30 3 * * *",
    freshness: "interval",
    staleAfterMinutes: 26 * 60,
    tradingDayOnly: false,
    jobName: "refresh",
  },
  {
    key: "sample-fund-refresh",
    label: "基金数据刷新",
    envKey: "FUND_REFRESH_CRON",
    defaultCron: "45 3 * * *",
    freshness: "interval",
    staleAfterMinutes: 26 * 60,
    tradingDayOnly: false,
    jobName: "fund-refresh",
  },
  {
    key: "alert-scan",
    label: "预警扫描",
    envKey: "ALERT_CRON",
    defaultCron: "*/30 9-15 * * 1-5",
    freshness: "interval",
    staleAfterMinutes: 2 * 60,
    tradingDayOnly: true,
    earliestHour: 9,
    jobName: "alert-scan",
  },
  {
    key: "daily-stock-report",
    label: "股市日报探测",
    envKey: "DAILY_STOCK_REPORT_CRON",
    defaultCron: "*/10 15-16 * * 1-5",
    freshness: "daily",
    staleAfterMinutes: 26 * 60,
    tradingDayOnly: true,
    earliestHour: 15,
    jobName: "daily-report",
    detailKind: "stock",
  },
  {
    key: "daily-fund-report",
    label: "基金日报探测",
    envKey: "DAILY_FUND_REPORT_CRON",
    defaultCron: "*/20 20-23 * * 1-5",
    freshness: "daily",
    staleAfterMinutes: 26 * 60,
    tradingDayOnly: true,
    earliestHour: 20,
    jobName: "daily-report",
    detailKind: "fund",
  },
];

/** 解析任务当前使用的调度表达式：环境变量优先，其次默认值。 */
export function resolveCron(
  entry: ScheduleEntry,
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = env[entry.envKey];
  return configured && configured.trim() ? configured.trim() : entry.defaultCron;
}

/** 取北京时间的小时数（0-23），不依赖服务器时区。 */
export function beijingHour(now: Date): number {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).getUTCHours();
}

/** 单个任务的最近运行状态。 */
export interface ScheduleTaskState {
  /** 最近一次运行开始时间（ISO），没有任何记录时为 null。 */
  lastRunAt: string | null;
  /** 当天是否已确认完成（当天有成功记录，或当天日报已存在）。 */
  satisfiedToday: boolean;
}

/** 任务键到运行状态的映射。 */
export type ScheduleStateMap = Record<string, ScheduleTaskState | undefined>;

/** 从内存 / 数据库读取状态时需要回溯的 job_runs 条数。 */
const RUN_SCAN_LIMIT = 200;

/** 判断一条 job_runs 记录是否属于某个任务；日报类按 detail.kind 区分。 */
function matchesEntry(run: JobRun, entry: ScheduleEntry): boolean {
  if (run.job_name !== entry.jobName) {
    return false;
  }
  if (!entry.detailKind) {
    return true;
  }
  return run.detail !== null && run.detail.kind === entry.detailKind;
}

/** 安全解析时间戳，非法输入返回 null。 */
function parseTime(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/** 从 job_runs 列表解析每个任务的最近运行状态（纯函数，便于单测）。 */
export function pickTaskStates(
  runs: readonly JobRun[],
  now: Date,
  entries: readonly ScheduleEntry[] = SCHEDULE_TABLE,
): ScheduleStateMap {
  const todayKey = beijingDateKey(now);
  const states: ScheduleStateMap = {};

  for (const entry of entries) {
    const matched = runs.filter((run) => matchesEntry(run, entry));
    const latest = matched[0] ?? null;
    const latestSuccess = matched.find((run) => run.status === "success") ?? null;
    const successTime = parseTime(latestSuccess?.started_at ?? null);
    const ranToday =
      successTime !== null && beijingDateKey(new Date(successTime)) === todayKey;

    states[entry.key] = {
      lastRunAt: latest?.started_at ?? null,
      satisfiedToday: ranToday,
    };
  }

  return states;
}

/**
 * 汇总所有任务的最近运行状态：job_runs 记录 + 当天日报落盘情况。
 * 日报类任务额外检查当天报告是否已存在，避免守护进程反复补跑已完成的日报。
 */
export async function collectTaskStates(
  now: Date = new Date(),
  entries: readonly ScheduleEntry[] = SCHEDULE_TABLE,
): Promise<ScheduleStateMap> {
  const runs = await store.jobRuns.listRecent(RUN_SCAN_LIMIT);
  const states = pickTaskStates(runs, now, entries);
  const todayKey = beijingDateKey(now);

  for (const entry of entries) {
    if (!entry.detailKind) {
      continue;
    }
    if (await dailyReportExists(entry.detailKind, todayKey)) {
      const previous = states[entry.key];
      states[entry.key] = {
        lastRunAt: previous?.lastRunAt ?? null,
        satisfiedToday: true,
      };
    }
  }

  return states;
}

/** 过期判定的输入参数。 */
export interface StaleTaskOptions {
  now: Date;
  states: ScheduleStateMap;
  /** 交易日判定函数，通常包一层 getTradingCalendar().isTradingDay。 */
  isTradingDay: (dateKey: string) => boolean;
  /** 可注入的任务清单，默认使用 SCHEDULE_TABLE（主要供测试使用）。 */
  entries?: readonly ScheduleEntry[];
}

/** 单个任务的判定结果。 */
export interface TaskEvaluation {
  entry: ScheduleEntry;
  /** 是否需要补跑。 */
  stale: boolean;
  /** 不需补跑的原因；需要补跑时为 null。 */
  skipReason: string | null;
  /** 距上次运行的分钟数；无记录时为 null。 */
  lastRunAgeMinutes: number | null;
}

/** 计算距上次运行的分钟数（向下取整）。 */
function ageMinutes(now: Date, lastRunAt: string | null): number | null {
  const time = parseTime(lastRunAt);
  if (time === null) {
    return null;
  }
  return Math.max(0, Math.floor((now.getTime() - time) / 60_000));
}

/** 判定单个任务是否需要补跑（纯函数）。 */
export function evaluateTask(
  entry: ScheduleEntry,
  options: Omit<StaleTaskOptions, "entries">,
): TaskEvaluation {
  const { now, states, isTradingDay } = options;
  const state = states[entry.key];
  const lastRunAt = state?.lastRunAt ?? null;
  const base = {
    entry,
    lastRunAgeMinutes: ageMinutes(now, lastRunAt),
  };

  if (entry.tradingDayOnly && !isTradingDay(beijingDateKey(now))) {
    return { ...base, stale: false, skipReason: "非交易日" };
  }
  if (entry.earliestHour !== undefined && beijingHour(now) < entry.earliestHour) {
    return {
      ...base,
      stale: false,
      skipReason: `未到触发时段（北京 ${entry.earliestHour}:00 之后）`,
    };
  }
  if (entry.freshness === "daily") {
    const done = state?.satisfiedToday === true;
    return { ...base, stale: !done, skipReason: done ? "当天已完成" : null };
  }
  if (base.lastRunAgeMinutes === null) {
    return { ...base, stale: true, skipReason: null };
  }
  const stale = base.lastRunAgeMinutes >= entry.staleAfterMinutes;
  return { ...base, stale, skipReason: stale ? null : "未到期" };
}

/** 返回需要补跑的任务清单。 */
export function selectStaleTasks(options: StaleTaskOptions): ScheduleEntry[] {
  const entries = options.entries ?? SCHEDULE_TABLE;
  return entries
    .map((entry) => evaluateTask(entry, options))
    .filter((item) => item.stale)
    .map((item) => item.entry);
}

/** 单个任务对外展示的状态。 */
export interface SchedulerTaskStatus {
  key: string;
  label: string;
  cron: string;
  envKey: string;
  freshness: ScheduleFreshness;
  staleAfterMinutes: number | null;
  tradingDayOnly: boolean;
  lastRunAt: string | null;
  lastRunAgeMinutes: number | null;
  stale: boolean;
  skipReason: string | null;
}

/** 调度状态汇总（供 GET /api/admin/scheduler/status 与面板使用）。 */
export interface SchedulerStatusSummary {
  now: string;
  timezone: string;
  /** 进程内 cron 是否已注册（instrumentation 或 admin 接口触发过 startScheduler）。 */
  schedulerRegistered: boolean;
  tradingDay: boolean;
  staleCount: number;
  tasks: SchedulerTaskStatus[];
}

/** 汇总调度状态：每个任务最近运行时间、是否过期、跳过原因。 */
export function summarizeSchedulerStatus(
  options: StaleTaskOptions & { schedulerRegistered?: boolean; timezone?: string },
): SchedulerStatusSummary {
  const entries = options.entries ?? SCHEDULE_TABLE;
  const todayKey = beijingDateKey(options.now);
  const tasks = entries.map((entry) => {
    const evaluation = evaluateTask(entry, options);
    return {
      key: entry.key,
      label: entry.label,
      cron: resolveCron(entry),
      envKey: entry.envKey,
      freshness: entry.freshness,
      staleAfterMinutes:
        entry.freshness === "interval" ? entry.staleAfterMinutes : null,
      tradingDayOnly: entry.tradingDayOnly,
      lastRunAt: options.states[entry.key]?.lastRunAt ?? null,
      lastRunAgeMinutes: evaluation.lastRunAgeMinutes,
      stale: evaluation.stale,
      skipReason: evaluation.skipReason,
    } satisfies SchedulerTaskStatus;
  });

  return {
    now: options.now.toISOString(),
    timezone: options.timezone ?? process.env.SCHEDULER_TIMEZONE ?? "Asia/Shanghai",
    schedulerRegistered: options.schedulerRegistered ?? false,
    tradingDay: options.isTradingDay(todayKey),
    staleCount: tasks.filter((task) => task.stale).length,
    tasks,
  };
}

/** 任务键到执行器的映射；由 scheduler.ts 提供，避免本模块反向依赖 cron 实现。 */
export type SchedulerRunners = Record<string, (() => Promise<unknown>) | undefined>;

/** 单个任务的补跑结果。 */
export interface SchedulerTickTaskResult {
  key: string;
  label: string;
  status: "ran" | "failed" | "skipped";
  error: string | null;
}

/** 一次补跑的汇总结果。 */
export interface SchedulerTickResult {
  now: string;
  tradingDay: boolean;
  staleCount: number;
  ranCount: number;
  failedCount: number;
  skippedCount: number;
  tasks: SchedulerTickTaskResult[];
}

/**
 * 补跑一次：只执行被判为过期的任务，串行执行，单项失败不中断其它任务。
 * 执行器由调用方注入（scheduler.ts 的 SCHEDULER_RUNNERS），保持本模块可单测。
 */
export async function runSchedulerTick(options: {
  now?: Date;
  runners: SchedulerRunners;
  isTradingDay: (dateKey: string) => boolean;
}): Promise<SchedulerTickResult> {
  const now = options.now ?? new Date();
  const states = await collectTaskStates(now);
  const stale = selectStaleTasks({ now, states, isTradingDay: options.isTradingDay });
  const tasks: SchedulerTickTaskResult[] = [];

  for (const entry of stale) {
    const run = options.runners[entry.key];
    if (!run) {
      tasks.push({
        key: entry.key,
        label: entry.label,
        status: "skipped",
        error: "未注册执行器",
      });
      continue;
    }
    try {
      await run();
      tasks.push({ key: entry.key, label: entry.label, status: "ran", error: null });
    } catch (error) {
      tasks.push({
        key: entry.key,
        label: entry.label,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    now: now.toISOString(),
    tradingDay: options.isTradingDay(beijingDateKey(now)),
    staleCount: stale.length,
    ranCount: tasks.filter((task) => task.status === "ran").length,
    failedCount: tasks.filter((task) => task.status === "failed").length,
    skippedCount: tasks.filter((task) => task.status === "skipped").length,
    tasks,
  };
}

/** 常量时间字符串比较，避免令牌比较被时序侧信道利用。 */
function safeTokenEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

/** 判断来源主机是否为本机地址。 */
function isLoopbackHost(host: string): boolean {
  // 去掉 IPv6 方括号并统一小写；Next 会以 ::ffff:127.0.0.1 这类 IPv4 映射地址上报本机来源。
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1"
  ) {
    return true;
  }
  const mapped = normalized.includes("::ffff:") ? normalized.split("::ffff:")[1] : normalized;
  return mapped.startsWith("127.");
}

/** 写接口鉴权结果。 */
export interface SchedulerAccessResult {
  ok: boolean;
  reason: string | null;
}

/**
 * 写接口鉴权：配置了 SCHEDULER_TOKEN 时要求请求头 x-scheduler-token 完全一致；
 * 未配置令牌时只允许本机直连（无代理头或来源为回环地址），避免公网误触发。
 */
export function authorizeSchedulerRequest(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): SchedulerAccessResult {
  const expected = env.SCHEDULER_TOKEN?.trim();
  if (expected) {
    const provided = request.headers.get("x-scheduler-token")?.trim() ?? "";
    return safeTokenEquals(provided, expected)
      ? { ok: true, reason: null }
      : { ok: false, reason: "调度令牌无效。" };
  }

  const forwarded = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const source = (forwarded?.split(",")[0] ?? realIp ?? "").trim();
  if (!source) {
    return { ok: true, reason: null };
  }
  return isLoopbackHost(source)
    ? { ok: true, reason: null }
    : { ok: false, reason: "未配置 SCHEDULER_TOKEN 时只允许本机触发。" };
}
