// 调度任务编排测试：用模块替身替换外部数据源与 AI，验证各任务的调用参数、
// job_runs 落库、失败记录与批量回补的逐日行为。
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node-cron", () => ({
  schedule: vi.fn(),
  validate: vi.fn(() => true),
}));

vi.mock("@/lib/market-data", () => ({
  getMarketQuote: vi.fn(async () => ({})),
  getKlines: vi.fn(async () => []),
}));

vi.mock("@/lib/news", () => ({
  getNews: vi.fn(async () => []),
}));

vi.mock("@/lib/fund-news", () => ({
  cleanupExpiredFundNews: vi.fn(async () => 0),
}));

vi.mock("@/lib/fund-holdings", () => ({
  getFundHoldings: vi.fn(async () => ({ code: "510300", holdings: [], source: "test" })),
}));

vi.mock("@/lib/fund-intraday", () => ({
  getFundIntraday: vi.fn(async () => ({})),
}));

vi.mock("@/lib/fund-metrics", () => ({
  getFundMetrics: vi.fn(async () => ({})),
}));

vi.mock("@/lib/fund-data", () => ({
  getFundNav: vi.fn(async () => []),
  getFundProfile: vi.fn(async () => ({ code: "510300", name: "沪深300ETF" })),
}));

vi.mock("@/lib/alert-scan", () => ({
  runAlertScan: vi.fn(async () => ({
    scanned_targets: 0,
    scanned_rules: 0,
    triggered_count: 0,
    skipped_count: 0,
    skipped_reasons: [],
    email_status: "skipped",
    email_reason: null,
    trading_day_source: "test",
    duration_ms: 0,
  })),
}));

vi.mock("@/lib/daily-report", () => ({
  runDailyReportJob: vi.fn(),
}));

vi.mock("@/lib/daily-report-store", () => ({
  dailyReportExists: vi.fn(async () => false),
}));

vi.mock("@/lib/trading-calendar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/trading-calendar")>();
  return {
    ...actual,
    // 固定「今天」与交易日历，保证回补窗口与执行顺序可复现。
    beijingDateKey: () => "2026-09-13",
    getTradingCalendar: vi.fn(),
  };
});

import { schedule, validate } from "node-cron";

import { runAlertScan } from "@/lib/alert-scan";
import { runDailyReportJob } from "@/lib/daily-report";
import { cleanupExpiredFundNews } from "@/lib/fund-news";
import { getFundHoldings } from "@/lib/fund-holdings";
import { getFundIntraday } from "@/lib/fund-intraday";
import { getFundMetrics } from "@/lib/fund-metrics";
import { getFundNav, getFundProfile } from "@/lib/fund-data";
import { SAMPLE_FUND_CODES } from "@/lib/fund-market";
import { SAMPLE_CODES } from "@/lib/market";
import { getKlines, getMarketQuote } from "@/lib/market-data";
import { getNews } from "@/lib/news";
import {
  runAlertScanJob,
  runCleanupJob,
  runDailyReportBackfill,
  runDailyReportManual,
  runFundRefreshJob,
  runRefreshJob,
  startScheduler,
} from "@/lib/scheduler";
import { store } from "@/lib/store";
import { buildTradingCalendar, getTradingCalendar } from "@/lib/trading-calendar";
import type { DailyReportJobResult, NewsItem } from "@/lib/shared/types";

const scheduleMock = vi.mocked(schedule);
const validateMock = vi.mocked(validate);
const quoteMock = vi.mocked(getMarketQuote);
const klinesMock = vi.mocked(getKlines);
const newsMock = vi.mocked(getNews);
const fundCleanupMock = vi.mocked(cleanupExpiredFundNews);
const fundProfileMock = vi.mocked(getFundProfile);
const fundIntradayMock = vi.mocked(getFundIntraday);
const fundNavMock = vi.mocked(getFundNav);
const fundHoldingsMock = vi.mocked(getFundHoldings);
const fundMetricsMock = vi.mocked(getFundMetrics);
const alertScanMock = vi.mocked(runAlertScan);
const dailyReportJobMock = vi.mocked(runDailyReportJob);
const calendarMock = vi.mocked(getTradingCalendar);

/** 构造资讯条目；默认已过期且可被清理。 */
function newsItem(overrides: Partial<NewsItem> = {}): NewsItem {
  return {
    id: "news-1",
    code: "600519",
    title: "示例资讯",
    summary: "摘要",
    url: "https://example.com/news",
    source: "示例来源",
    published_at: "2026-09-01T01:00:00Z",
    fetched_at: "2026-09-01T01:00:00Z",
    sentiment: "neutral",
    confidence: 0.5,
    impact_days: 1,
    expire_at: "2026-09-02T01:00:00Z",
    tags: [],
    status: "active",
    pinned: false,
    ...overrides,
  };
}

/** 构造日报任务结果。 */
function reportResult(date: string, status: "generated" | "skipped" = "generated"): DailyReportJobResult {
  return {
    kind: "stock",
    date,
    status,
    reason: status === "generated" ? "历史日期补生成" : `${date} 日报已存在，跳过重复生成。`,
    storage: status === "generated" ? "r2" : null,
    report_source: status === "generated" ? "deepseek" : null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // 固定交易日历：09-09 至 09-11 为交易日，09-12/09-13 为周末。
  calendarMock.mockResolvedValue(
    buildTradingCalendar({
      source: "akshare",
      fetched_at: "2026-09-13T00:00:00Z",
      days: ["2026-09-09", "2026-09-10", "2026-09-11"],
    }),
  );
  validateMock.mockReturnValue(true);
  fundCleanupMock.mockResolvedValue(0);
  delete process.env.DATABASE_URL;
});

describe("手动刷新任务", () => {
  it("默认刷新全部样例股票的全部数据", async () => {
    const run = await runRefreshJob();

    expect(quoteMock).toHaveBeenCalledTimes(SAMPLE_CODES.length);
    expect(klinesMock).toHaveBeenCalledTimes(SAMPLE_CODES.length);
    expect(newsMock).toHaveBeenCalledTimes(SAMPLE_CODES.length);
    expect(quoteMock).toHaveBeenCalledWith(SAMPLE_CODES[0], true);
    expect(klinesMock).toHaveBeenCalledWith(SAMPLE_CODES[0], "day", "qfq", 120, true);
    expect(run.job_name).toBe("refresh");
    expect(run.status).toBe("success");
    expect(run.detail).toMatchObject({ refreshed_count: SAMPLE_CODES.length, target: "all" });
  });

  it("指定目标时只刷新对应数据", async () => {
    const run = await runRefreshJob({ codes: ["600519"], target: "quote" });

    expect(quoteMock).toHaveBeenCalledTimes(1);
    expect(klinesMock).not.toHaveBeenCalled();
    expect(newsMock).not.toHaveBeenCalled();
    expect(run.detail).toMatchObject({ codes: ["600519"], refreshed_count: 1 });
  });

  it("基金刷新覆盖档案、盘中、净值、持仓与指标", async () => {
    await runFundRefreshJob({ codes: ["510300"] });

    expect(fundProfileMock).toHaveBeenCalledWith("510300", true);
    expect(fundIntradayMock).toHaveBeenCalledWith("510300", true);
    expect(fundNavMock).toHaveBeenCalledWith("510300", "1y", "unit", true);
    expect(fundNavMock).toHaveBeenCalledWith("510300", "all", "cumulative", true);
    expect(fundHoldingsMock).toHaveBeenCalledWith("510300", true);
    expect(fundMetricsMock).toHaveBeenCalledWith("510300", "1y", true);
    expect(fundMetricsMock).toHaveBeenCalledWith("510300", "all", true);
  });

  it("基金刷新默认覆盖全部样例基金", async () => {
    const run = await runFundRefreshJob();
    expect(fundProfileMock).toHaveBeenCalledTimes(SAMPLE_FUND_CODES.length);
    expect(run.detail).toMatchObject({ refreshed_count: SAMPLE_FUND_CODES.length });
  });

  it("任务失败时记录 failed 运行日志并抛出异常", async () => {
    quoteMock.mockRejectedValueOnce(new Error("行情侧车不可用"));

    await expect(runRefreshJob({ codes: ["600519"], target: "quote" })).rejects.toThrow(
      "行情侧车不可用",
    );

    const runs = await store.jobRuns.listRecent(10);
    const failed = runs.find((item) => item.job_name === "refresh" && item.status === "failed");
    expect(failed?.detail).toMatchObject({ error: "行情侧车不可用" });
  });
});

describe("资讯清理任务", () => {
  it("只清理到期、未置顶且非长期的资讯", async () => {
    await store.newsItems.insert(newsItem({ id: "n-keep", code: "600000" }));
    await store.newsItems.insert(newsItem({ id: "n-pinned", code: "600001", pinned: true }));
    await store.newsItems.insert(newsItem({ id: "n-long", code: "600002", tags: ["长期"] }));
    await store.newsItems.insert(
      newsItem({ id: "n-future", code: "600003", expire_at: "2030-01-01T00:00:00Z" }),
    );
    fundCleanupMock.mockResolvedValue(2);

    const run = await runCleanupJob({ before: "2026-09-13T00:00:00Z" });

    expect(run.detail).toMatchObject({
      cleaned_count: 1,
      eligible_count: 1,
      fund_cleaned_count: 2,
    });
    const kept = await store.newsItems.listByCode("600000");
    expect(kept[0].status).toBe("expired");
    expect((await store.newsItems.listByCode("600001"))[0].status).toBe("active");
    expect((await store.newsItems.listByCode("600002"))[0].status).toBe("active");
    expect((await store.newsItems.listByCode("600003"))[0].status).toBe("active");
  });

  it("dryRun 只统计不落库", async () => {
    await store.newsItems.insert(newsItem({ id: "n-dry", code: "600004" }));

    const run = await runCleanupJob({ before: "2026-09-13T00:00:00Z", dryRun: true });

    expect(run.detail).toMatchObject({ dry_run: true, cleaned_count: 1 });
    expect((await store.newsItems.listByCode("600004"))[0].status).toBe("active");
  });

  it("非法 before 参数直接拒绝", async () => {
    await expect(runCleanupJob({ before: "not-a-date" })).rejects.toThrow("before 参数不是有效时间。");
  });
});

describe("预警扫描任务", () => {
  it("把扫描结果写进 job_runs", async () => {
    alertScanMock.mockResolvedValue({
      scanned_targets: 3,
      scanned_rules: 4,
      triggered_count: 1,
      skipped_count: 2,
      skipped_reasons: ["缺少指标观测值"],
      email_status: "sent",
      email_reason: null,
      trading_day_source: "akshare",
      duration_ms: 12,
    });

    const run = await runAlertScanJob({ source: "manual" });

    expect(run.job_name).toBe("alert-scan");
    expect(run.status).toBe("success");
    expect(run.detail).toMatchObject({
      scanned_targets: 3,
      triggered_count: 1,
      email_status: "sent",
      source: "manual",
    });
  });
});

describe("日报批量回补", () => {
  it("按交易日历取最近 N 天，并按时间正序生成且不推送邮件", async () => {
    dailyReportJobMock.mockImplementation(async (_kind, options) => {
      const date = options?.date ?? "2026-09-11";
      return reportResult(date, date === "2026-09-10" ? "skipped" : "generated");
    });

    const result = await runDailyReportBackfill("stock", { days: 2 });

    expect(result.dates).toEqual(["2026-09-11", "2026-09-10"]);
    expect(result.generated).toBe(1);
    expect(result.skipped).toBe(1);
    // 生成顺序为「早 → 晚」，保证正文对比数据先就位。
    expect(dailyReportJobMock.mock.calls.map((call) => call[1]?.date)).toEqual([
      "2026-09-10",
      "2026-09-11",
    ]);
    for (const call of dailyReportJobMock.mock.calls) {
      expect(call[1]).toMatchObject({ source: "manual", force: false, notify: false });
    }
    expect(dailyReportJobMock.mock.calls[0][0]).toBe("stock");
  });

  it("force 透传并可覆盖已存在的日报", async () => {
    dailyReportJobMock.mockImplementation(async (_kind, options) =>
      reportResult(options?.date ?? "2026-09-11"),
    );

    const result = await runDailyReportBackfill("fund", { days: 1, force: true });

    expect(result.dates).toEqual(["2026-09-11"]);
    expect(result.generated).toBe(1);
    expect(dailyReportJobMock).toHaveBeenCalledWith("fund", {
      date: "2026-09-11",
      force: true,
      source: "manual",
      notify: false,
    });

    const runs = await store.jobRuns.listRecent(5);
    const backfillRun = runs.find((item) => item.job_name === "daily-report");
    expect(backfillRun?.detail).toMatchObject({
      backfill_days: 1,
      generated_count: 1,
      skipped_count: 0,
      force: true,
    });
  });

  it("单日失败不中断整批，失败原因写入结果", async () => {
    dailyReportJobMock.mockImplementation(async (_kind, options) => {
      const date = options?.date ?? "";
      if (date === "2026-09-10") {
        throw new Error("上游数据不可用");
      }
      return reportResult(date);
    });

    const result = await runDailyReportBackfill("stock", { days: 2 });

    expect(result.generated).toBe(1);
    expect(result.skipped).toBe(1);
    const failed = result.results.find((item) => item.reason.startsWith("生成失败"));
    expect(failed?.date).toBe("2026-09-10");
    expect(failed?.reason).toContain("上游数据不可用");
    expect(failed?.email_status).toBeNull();
  });

  it("单个日期日报任务抛出时手动生成同样向上抛出", async () => {
    dailyReportJobMock.mockRejectedValueOnce(new Error("模型超时"));
    await expect(runDailyReportManual("stock", { date: "2026-09-11" })).rejects.toThrow("模型超时");
  });

  it("手动生成把任务结果原样返回", async () => {
    dailyReportJobMock.mockResolvedValue(reportResult("2026-09-11"));
    const result = await runDailyReportManual("stock", { date: "2026-09-11", force: true });

    expect(result).toMatchObject({ date: "2026-09-11", status: "generated", storage: "r2" });
    expect(dailyReportJobMock).toHaveBeenCalledWith("stock", {
      date: "2026-09-11",
      force: true,
    });
  });
});

describe("定时注册", () => {
  it("按调度表注册六个任务，重复调用不重复注册", () => {
    const globalForScheduler = globalThis as typeof globalThis & {
      __stockAnalysisSchedulerStarted?: boolean;
    };
    globalForScheduler.__stockAnalysisSchedulerStarted = false;
    delete process.env.CLEANUP_CRON;
    delete process.env.REFRESH_CRON;
    delete process.env.FUND_REFRESH_CRON;
    delete process.env.FUND_SETTLE_CRON;
    delete process.env.ALERT_CRON;
    delete process.env.DAILY_STOCK_REPORT_CRON;
    delete process.env.DAILY_FUND_REPORT_CRON;
    delete process.env.SCHEDULER_TIMEZONE;

    startScheduler();

    expect(scheduleMock).toHaveBeenCalledTimes(7);
    // node-cron 签名为 schedule(表达式, 回调, 选项)，任务名在第三个参数。
    expect(scheduleMock.mock.calls.map((call) => (call[2] as { name?: string })?.name)).toEqual([
      "news-cleanup",
      "sample-quote-refresh",
      "sample-fund-refresh",
      "fund-settlement",
      "alert-scan",
      "daily-stock-report",
      "daily-fund-report",
    ]);
    expect(scheduleMock.mock.calls[0][2]).toMatchObject({ timezone: "Asia/Shanghai" });

    startScheduler();
    expect(scheduleMock).toHaveBeenCalledTimes(7);
  });

  it("表达式非法时跳过该任务并记录错误", () => {
    const globalForScheduler = globalThis as typeof globalThis & {
      __stockAnalysisSchedulerStarted?: boolean;
    };
    globalForScheduler.__stockAnalysisSchedulerStarted = false;
    validateMock.mockReturnValue(false);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    startScheduler();

    expect(scheduleMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(7);
    errorSpy.mockRestore();
  });
});
