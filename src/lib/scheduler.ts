// 单机定时任务：node-cron 每日清理到期资讯，并按需刷新样例股票行情。
// 手动 admin 接口与定时任务共用同一套任务执行器，统一写入 job_runs。

import { schedule, validate } from "node-cron";

import { normalizeStockCode, SAMPLE_CODES } from "@/lib/market";
import { getKlines, getMarketQuote } from "@/lib/market-data";
import { getNews } from "@/lib/news";
import { cleanupExpiredFundNews } from "@/lib/fund-news";
import { getFundHoldings } from "@/lib/fund-holdings";
import { getFundIntraday } from "@/lib/fund-intraday";
import { SAMPLE_FUND_CODES } from "@/lib/fund-market";
import { getFundMetrics } from "@/lib/fund-metrics";
import { getFundNav, getFundProfile } from "@/lib/fund-data";
import { runAlertScan } from "@/lib/alert-scan";
import { runDailyReportJob } from "@/lib/daily-report";
import type { DailyReportJobOptions } from "@/lib/daily-report";
import { dailyReportExists } from "@/lib/daily-report-store";
import { beijingDateKey, getTradingCalendar, shiftDateKey } from "@/lib/trading-calendar";
import type { TradingCalendar } from "@/lib/trading-calendar";
import { recordTaskRun } from "@/lib/observability";
import { store } from "@/lib/store";
import type {
  DailyReportBackfillResult,
  DailyReportJobResult,
  DailyReportKind,
  JobRun,
  NewsItem,
} from "@/lib/shared/types";

type JobName = "cleanup" | "refresh" | "fund-refresh" | "alert-scan" | "daily-report";
type JobSource = "manual" | "cron";
type RefreshTarget = "quote" | "kline" | "news" | "all";
export type FundRefreshTarget = "profile" | "intraday" | "nav" | "holdings" | "metrics" | "all";

export interface CleanupJobOptions {
  before?: string;
  dryRun?: boolean;
  source?: JobSource;
}

export interface RefreshJobOptions {
  codes?: string[];
  target?: RefreshTarget;
  source?: JobSource;
}

export interface FundRefreshJobOptions {
  codes?: string[];
  target?: FundRefreshTarget;
  source?: JobSource;
}

const LONG_TERM_TAG = "长期";

function createJobId(jobName: JobName): string {
  return `job-${jobName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeBefore(value?: string): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new Error("before 参数不是有效时间。");
  }
  return date.toISOString();
}

/** 判断到期资讯是否应软删除：只处理 active，且保留 pinned 与长期消息。 */
function isCleanupCandidate(item: NewsItem): boolean {
  return item.status === "active" && !item.pinned && !item.tags.includes(LONG_TERM_TAG);
}

async function writeJobRun(run: JobRun): Promise<void> {
  await store.jobRuns.insert(run);
}

async function trackJob(
  jobName: JobName,
  detail: Record<string, unknown>,
  action: () => Promise<Record<string, unknown>>,
): Promise<JobRun> {
  const startedAt = new Date().toISOString();
  const baseRun: JobRun = {
    id: createJobId(jobName),
    job_name: jobName,
    status: "running",
    started_at: startedAt,
    finished_at: null,
    detail,
  };

  await writeJobRun(baseRun).catch((error: unknown) => {
    console.error(`写入 ${jobName} 运行中日志失败。`, error);
  });

  try {
    const result = await action();
    const completedRun: JobRun = {
      ...baseRun,
      status: "success",
      finished_at: new Date().toISOString(),
      detail: { ...detail, ...result },
    };
    await writeJobRun(completedRun).catch((error: unknown) => {
      console.error(`写入 ${jobName} 成功日志失败。`, error);
    });
    return completedRun;
  } catch (error) {
    const failedRun: JobRun = {
      ...baseRun,
      status: "failed",
      finished_at: new Date().toISOString(),
      detail: {
        ...detail,
        error: error instanceof Error ? error.message : `${jobName} 执行失败`,
      },
    };
    await writeJobRun(failedRun).catch((logError: unknown) => {
      console.error(`写入 ${jobName} 失败日志失败。`, logError);
    });
    throw error;
  }
}

/** 执行一次资讯清理任务，返回写入完成的 JobRun。 */
export async function runCleanupJob(options: CleanupJobOptions = {}): Promise<JobRun> {
  const before = normalizeBefore(options.before);
  const dryRun = options.dryRun ?? false;
  const source = options.source ?? "manual";

  return trackJob(
    "cleanup",
    { source, dry_run: dryRun, before },
    async () => {
      recordTaskRun("cleanup");
      const candidates = (await store.newsItems.listExpired(before)).filter(isCleanupCandidate);
      const fundCleanedCount = await cleanupExpiredFundNews(before, dryRun);
      if (!dryRun) {
        for (const item of candidates) {
          await store.newsItems.updateStatus(item.id, "expired");
        }
      }
      return {
        cleaned_count: candidates.length,
        eligible_count: candidates.length,
        fund_cleaned_count: fundCleanedCount,
        fund_eligible_count: fundCleanedCount,
      };
    },
  );
}

/** 执行一次行情或资讯刷新任务，返回写入完成的 JobRun。 */
export async function runRefreshJob(options: RefreshJobOptions = {}): Promise<JobRun> {
  const codes = options.codes?.length ? options.codes : [...SAMPLE_CODES];
  const target = options.target ?? "all";
  const source = options.source ?? "manual";

  return trackJob(
    "refresh",
    { source, codes, target },
    async () => {
      recordTaskRun("refresh");
      for (const code of codes) {
        if (target === "quote" || target === "all") {
          await getMarketQuote(code, true);
        }
        if (target === "kline" || target === "all") {
          await getKlines(code, "day", "qfq", 120, true);
        }
        if (target === "news" || target === "all") {
          await getNews(code, true);
        }
      }
      return { refreshed_count: codes.length };
    },
  );
}

/** 执行一次基金数据刷新任务：更新档案、净值、持仓与风险指标。 */
export async function runFundRefreshJob(
  options: FundRefreshJobOptions = {},
): Promise<JobRun> {
  const codes = options.codes?.length ? options.codes : [...SAMPLE_FUND_CODES];
  const target = options.target ?? "all";
  const source = options.source ?? "manual";

  return trackJob(
    "fund-refresh",
    { source, codes, target },
    async () => {
      recordTaskRun("refresh");
      for (const code of codes) {
        if (target === "profile" || target === "all") {
          await getFundProfile(code, true);
        }
        if (target === "intraday" || target === "all") {
          await getFundIntraday(code, true);
        }
        if (target === "nav" || target === "all") {
          await getFundNav(code, "1y", "unit", true);
          await getFundNav(code, "all", "cumulative", true);
        }
        if (target === "holdings" || target === "all") {
          await getFundHoldings(code, true);
        }
        if (target === "metrics" || target === "all") {
          await getFundMetrics(code, "1y", true);
          await getFundMetrics(code, "all", true);
        }
      }
      return { refreshed_count: codes.length, target };
    },
  );
}

/** 校验并规范化手动刷新请求中的股票代码；非法时返回 null。 */
export function normalizeRefreshCode(code?: string): string | null {
  if (!code) {
    return null;
  }
  return normalizeStockCode(code);
}

/** 校验并规范化手动基金刷新请求中的基金代码；非法时返回 null。 */
export function normalizeFundRefreshCode(code?: string): string | null {
  if (!code) {
    return null;
  }
  return /^\d{6}$/.test(code.trim()) ? code.trim() : null;
}

/** 样例股票每日行情刷新。 */
export function runScheduledRefresh(): Promise<JobRun> {
  return runRefreshJob({
    codes: [...SAMPLE_CODES],
    target: "quote",
    source: "cron",
  });
}

/** 每日基金数据刷新。 */
export function runScheduledFundRefresh(): Promise<JobRun> {
  return runFundRefreshJob({
    codes: [...SAMPLE_FUND_CODES],
    target: "all",
    source: "cron",
  });
}

/** 预警扫描任务选项。 */
export interface AlertScanJobOptions {
  source?: JobSource;
}

/** 预警扫描：交易日每 30 分钟触发一次（是否真正评估由有效时段判定决定）。 */
export function runAlertScanJob(options: AlertScanJobOptions = {}): Promise<JobRun> {
  return trackJob("alert-scan", { source: options.source ?? "cron" }, async () => {
    recordTaskRun("refresh");
    const result = await runAlertScan();
    return { ...result };
  });
}

/** 日报任务：手动与定时共用同一套执行器，统一写入 job_runs。 */
function trackDailyReportJob(
  kind: DailyReportKind,
  options: DailyReportJobOptions,
  onResult: (result: DailyReportJobResult) => void,
): Promise<JobRun> {
  return trackJob(
    "daily-report",
    {
      source: options.source ?? "manual",
      kind,
      date: options.date ?? null,
      force: options.force ?? false,
    },
    async () => {
      recordTaskRun("analysis");
      const result = await runDailyReportJob(kind, options);
      onResult(result);
      return { ...result };
    },
  );
}

/** 手动生成日报（含按指定日期补生成历史日报），返回任务结果。 */
export async function runDailyReportManual(
  kind: DailyReportKind,
  options: DailyReportJobOptions = {},
): Promise<DailyReportJobResult> {
  const holder: { result: DailyReportJobResult | null } = { result: null };
  await trackDailyReportJob(kind, options, (result) => {
    holder.result = result;
  });

  return (
    holder.result ?? {
      kind,
      date: options.date ?? beijingDateKey(new Date()),
      status: "skipped",
      reason: "任务未返回结果。",
      storage: null,
      report_source: null,
    }
  );
}

/** 批量回补一次最多覆盖的交易日数量，避免单次请求打满上游与模型额度。 */
export const DAILY_REPORT_BACKFILL_MAX_DAYS = 30;

/** 批量回补选项：days 为最近交易日数量，force 为 true 时连已存在的日报一并重生成。 */
export interface DailyReportBackfillOptions {
  days?: number;
  force?: boolean;
  source?: JobSource;
}

/** 规范化回补天数：非法值回落默认值，越界收敛到 [1, 30]。 */
export function normalizeBackfillDays(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return 5;
  }
  return Math.min(DAILY_REPORT_BACKFILL_MAX_DAYS, Math.max(1, Math.trunc(parsed)));
}

/**
 * 取从 endDate 起（含）向前的最近 count 个交易日，返回日期倒序。
 * 回溯窗口设为 count * 3 + 31 天，覆盖春节等长假期，同时避免日历异常时死循环。
 */
export function recentTradingDays(
  calendar: TradingCalendar,
  endDate: string,
  count: number,
): string[] {
  const dates: string[] = [];
  const limit = count * 3 + 31;
  let cursor = endDate;
  for (let step = 0; step < limit && dates.length < count; step += 1) {
    if (calendar.isTradingDay(cursor)) {
      dates.push(cursor);
    }
    cursor = shiftDateKey(cursor, -1);
  }
  return dates;
}

/**
 * 批量回补最近 N 个交易日的日报。
 * 按时间正序逐日生成（早的在前），保证正文对比数据先就位；
 * 单日失败只记入结果不中断整批，历史日报不重复推送邮件。
 */
export async function runDailyReportBackfill(
  kind: DailyReportKind,
  options: DailyReportBackfillOptions = {},
): Promise<DailyReportBackfillResult> {
  const days = normalizeBackfillDays(options.days ?? 5);
  const force = options.force ?? false;
  const source = options.source ?? "manual";
  const endDate = beijingDateKey(new Date());
  const calendar = await getTradingCalendar();
  const dates = recentTradingDays(calendar, endDate, days);
  const results: DailyReportJobResult[] = [];

  await trackJob(
    "daily-report",
    { source, kind, backfill_days: days, dates, force },
    async () => {
      recordTaskRun("analysis");
      for (const date of [...dates].reverse()) {
        try {
          results.push(await runDailyReportJob(kind, { date, force, source, notify: false }));
        } catch (error) {
          results.push({
            kind,
            date,
            status: "skipped",
            reason: `生成失败：${error instanceof Error ? error.message : String(error)}`,
            storage: null,
            report_source: null,
            email_status: null,
            email_reason: null,
          });
        }
      }
      return {
        backfill_days: days,
        generated_count: results.filter((item) => item.status === "generated").length,
        skipped_count: results.filter((item) => item.status === "skipped").length,
      };
    },
  );

  return {
    kind,
    days,
    dates,
    generated: results.filter((item) => item.status === "generated").length,
    skipped: results.filter((item) => item.status === "skipped").length,
    results,
  };
}

/**
 * 探测式触发：交易日且当天日报尚未生成时才进入生成流程。
 * 非交易日或已生成时直接跳过，避免污染 job_runs。
 */
async function probeDailyReport(kind: DailyReportKind): Promise<JobRun | null> {
  const date = beijingDateKey(new Date());
  const calendar = await getTradingCalendar();
  if (!calendar.isTradingDay(date)) {
    return null;
  }
  if (await dailyReportExists(kind, date)) {
    return null;
  }
  return trackDailyReportJob(kind, { source: "cron", date }, () => undefined);
}

/** 定时股市日报：交易日 15:00 后每 10 分钟探测一次，数据就绪即生成。 */
function runScheduledStockReport(): Promise<JobRun | null> {
  return probeDailyReport("stock");
}

/** 定时基金日报：交易日晚间每 20 分钟探测一次，净值公布即生成。 */
function runScheduledFundReport(): Promise<JobRun | null> {
  return probeDailyReport("fund");
}
/** 每日资讯清理。 */
export function runScheduledCleanup(): Promise<JobRun> {
  return runCleanupJob({ source: "cron" });
}

function safeSchedule(
  expression: string,
  name: string,
  action: () => Promise<JobRun | null>,
): void {
  if (!validate(expression)) {
    console.error(`无效的定时表达式 ${expression}，已跳过任务 ${name}。`);
    return;
  }

  schedule(
    expression,
    () => {
      void action();
    },
    {
      name,
      timezone: process.env.SCHEDULER_TIMEZONE ?? "Asia/Shanghai",
    },
  );
}

/** 启动单机定时任务；多次调用只启动一次，避免开发模式热更新重复注册。 */
export function startScheduler(): void {
  const globalForScheduler = globalThis as typeof globalThis & {
    __stockAnalysisSchedulerStarted?: boolean;
  };

  if (globalForScheduler.__stockAnalysisSchedulerStarted) {
    return;
  }

  globalForScheduler.__stockAnalysisSchedulerStarted = true;
  safeSchedule(process.env.CLEANUP_CRON ?? "0 3 * * *", "news-cleanup", runScheduledCleanup);
  safeSchedule(
    process.env.REFRESH_CRON ?? "30 3 * * *",
    "sample-quote-refresh",
    runScheduledRefresh,
  );
  safeSchedule(
    process.env.FUND_REFRESH_CRON ?? "45 3 * * *",
    "sample-fund-refresh",
    runScheduledFundRefresh,
  );
  safeSchedule(process.env.ALERT_CRON ?? "*/30 9-15 * * 1-5", "alert-scan", runAlertScanJob);
  safeSchedule(
    process.env.DAILY_STOCK_REPORT_CRON ?? "*/10 15-16 * * 1-5",
    "daily-stock-report",
    runScheduledStockReport,
  );
  safeSchedule(
    process.env.DAILY_FUND_REPORT_CRON ?? "*/20 20-23 * * 1-5",
    "daily-fund-report",
    runScheduledFundReport,
  );
}
