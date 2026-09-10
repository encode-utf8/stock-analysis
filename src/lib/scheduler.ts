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
import { beijingDateKey, getTradingCalendar } from "@/lib/trading-calendar";
import { recordTaskRun } from "@/lib/observability";
import { store } from "@/lib/store";
import type { DailyReportJobResult, DailyReportKind, JobRun, NewsItem } from "@/lib/shared/types";

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
