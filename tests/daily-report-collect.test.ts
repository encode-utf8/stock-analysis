// 日报采集链路回归测试：用模块替身隔离侧车、自选池与资讯，
// 重点验证指数/板块/涨跌家数的组装、对比数据、缺数据回退与降级剔除。
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/analysis", () => ({
  deepSeekBaseUrl: () => "http://model.local",
  deepSeekConfigured: () => false,
  deepSeekModel: () => "test-model",
}));

vi.mock("@/lib/daily-report-email", () => ({
  sendDailyReportDigest: vi.fn(async () => ({ status: "skipped", reason: "测试跳过" })),
}));

vi.mock("@/lib/daily-report-store", () => ({
  dailyReportExists: vi.fn(async () => false),
  saveDailyReport: vi.fn(async () => "local"),
}));

vi.mock("@/lib/data-service", () => ({
  fetchIndexKlineFromSidecar: vi.fn(),
  fetchIndexQuotesFromSidecar: vi.fn(),
  fetchMarketBreadthFromSidecar: vi.fn(),
  fetchMarketSectorsFromSidecar: vi.fn(),
}));

vi.mock("@/lib/fund-data", () => ({
  getFundNav: vi.fn(async () => []),
}));

vi.mock("@/lib/fund-news", () => ({
  getFundIndustryNews: vi.fn(async () => ({ news: [] })),
}));

vi.mock("@/lib/fund-intraday", () => ({
  getFundIntraday: vi.fn(async () => ({
    code: "510300",
    price: 4.2,
    estimated_nav: 4.18,
    change_pct: 0.5,
    official_nav_date: "2026-09-11",
    source: "tencent",
  })),
}));

vi.mock("@/lib/fund-market", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fund-market")>();
  return {
    ...actual,
    resolveFundProfile: (code: string) => ({ ...actual.resolveFundProfile(code), name: `测试基金${code}` }),
  };
});

vi.mock("@/lib/fund-watchlist", () => ({
  fundWatchlistRepository: { list: vi.fn(async () => []) },
}));

vi.mock("@/lib/market-data", () => ({
  getKlines: vi.fn(async () => []),
  getMarketQuote: vi.fn(),
}));

vi.mock("@/lib/news", () => ({
  getNews: vi.fn(async () => []),
}));

vi.mock("@/lib/observability", () => ({
  recordExternalCall: vi.fn(),
}));

vi.mock("@/lib/watchlist", () => ({
  watchlistRepository: { list: vi.fn(async () => []) },
}));

import {
  fetchIndexKlineFromSidecar,
  fetchIndexQuotesFromSidecar,
  fetchMarketBreadthFromSidecar,
  fetchMarketSectorsFromSidecar,
} from "@/lib/data-service";
import { collectDailyReportData } from "@/lib/daily-report";
import { getFundIndustryNews } from "@/lib/fund-news";
import { getFundNav } from "@/lib/fund-data";
import { getKlines, getMarketQuote } from "@/lib/market-data";
import type {
  IndexKlineSeries,
  MarketBreadthSnapshot,
  MarketSectorsSnapshot,
} from "@/lib/shared/types";

const klineMock = vi.mocked(fetchIndexKlineFromSidecar);
const quoteMock = vi.mocked(fetchIndexQuotesFromSidecar);
const breadthMock = vi.mocked(fetchMarketBreadthFromSidecar);
const sectorsMock = vi.mocked(fetchMarketSectorsFromSidecar);
const navMock = vi.mocked(getFundNav);
const fundNewsMock = vi.mocked(getFundIndustryNews);
const marketQuoteMock = vi.mocked(getMarketQuote);
const klinesMock = vi.mocked(getKlines);

/** 构造指数日线序列，默认覆盖 09-09 至 09-11。 */
function indexSeries(
  code: string,
  name: string,
  closes: Record<string, number> = {
    "2026-09-09": 3951.51,
    "2026-09-10": 3934.4,
    "2026-09-11": 3888.11,
  },
): IndexKlineSeries {
  return {
    code,
    name,
    days: Object.entries(closes).map(([date, close], index) => ({
      date,
      open: close,
      close,
      high: close,
      low: close,
      amount: 900_000_000_000 - index * 10_000_000_000,
    })),
    source: "tencent",
    fetched_at: "2026-09-13T02:00:00Z",
  };
}

/** 三大指数全部可用的日线替身。 */
function allIndexSeries(): IndexKlineSeries[] {
  return [
    indexSeries("sh000001", "上证指数"),
    indexSeries("sz399001", "深证成指", {
      "2026-09-09": 13723.32,
      "2026-09-10": 13617.67,
      "2026-09-11": 13471.26,
    }),
    indexSeries("sz399006", "创业板指", {
      "2026-09-09": 3354.97,
      "2026-09-10": 3338.42,
      "2026-09-11": 3322.04,
    }),
  ];
}

/** 同花顺历史口径板块快照（含前一日对比）。 */
function thsSectors(): MarketSectorsSnapshot {
  return {
    top: [{ name: "元件", change_pct: 3.11, companies: null, amount: 1, leader: null, prev_change_pct: 1.31 }],
    bottom: [{ name: "多元金融", change_pct: -4.47, companies: null, amount: 1, leader: null, prev_change_pct: 1.01 }],
    total: 90,
    comparison: {
      prev_date: "2026-09-10",
      prev_rise_count: 10,
      prev_fall_count: 80,
      newcomers: ["通信设备"],
      dropped: ["银行"],
    },
    source: "ths",
    fetched_at: "2026-09-13T02:00:00Z",
  };
}

/** 当日新浪口径板块快照（无对比）。 */
function sinaSectors(): MarketSectorsSnapshot {
  return {
    top: [{ name: "船舶制造", change_pct: 2.61, companies: 8, amount: 1, leader: "中国船舶" }],
    bottom: [{ name: "纺织机械", change_pct: -3.13, companies: 8, amount: 1, leader: "中捷资源" }],
    total: 49,
    source: "akshare",
    fetched_at: "2026-09-13T02:00:00Z",
  };
}

const breadth: MarketBreadthSnapshot = {
  up: 604,
  down: 4567,
  flat: 36,
  limit_up: 40,
  limit_down: 21,
  suspended: 12,
  activity_pct: 11.57,
  stat_date: "2026-09-11 15:00:00",
  source: "legulegu",
  fetched_at: "2026-09-13T02:00:00Z",
};

/** 历史日期（收盘后）：指数、板块、家数、自选池全部返回数据。 */
function setupHistoryScenario(): void {
  const series = allIndexSeries();
  klineMock.mockImplementation(async (code: string) => series.find((item) => item.code === code) ?? null);
  sectorsMock.mockResolvedValue(thsSectors());
  breadthMock.mockResolvedValue(breadth);
  klinesMock.mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setupHistoryScenario();
});

describe("collectDailyReportData 历史日期", () => {
  it("按日线组装指数对比，并原样透传板块轮动", async () => {
    const data = await collectDailyReportData("stock", "2026-09-11", new Date("2026-09-13T02:00:00Z"));

    expect(data.missing).toEqual([]);
    expect(data.indices).toHaveLength(3);
    expect(data.indices[0]).toMatchObject({ code: "sh000001", price: 3888.11, change_pct: -1.18 });
    // 历史路径只请求一次板块（同花顺口径），不额外带 history 参数。
    expect(sectorsMock).toHaveBeenCalledTimes(1);
    expect(sectorsMock).toHaveBeenCalledWith(5, "2026-09-11");
    expect(data.comparison?.prev_date).toBe("2026-09-10");
    expect(data.comparison?.indices).toHaveLength(3);
    expect(data.comparison?.indices[0].prev_change_pct).toBe(-0.43);
    expect(data.comparison?.sectors?.prev_fall_count).toBe(80);
    expect(data.sectors?.source).toBe("ths");
    expect(data.breadth?.up).toBe(604);
  });

  it("指数日线缺失时重试一次，部分缺失写入 missing", async () => {
    const series = allIndexSeries();
    klineMock.mockImplementation(async (code: string) =>
      code === "sz399001" ? null : (series.find((item) => item.code === code) ?? null),
    );

    const data = await collectDailyReportData("stock", "2026-09-11", new Date("2026-09-13T02:00:00Z"));

    // 3 个指数 + 失败指数重试 1 次 = 4 次请求。
    expect(klineMock).toHaveBeenCalledTimes(4);
    expect(data.indices).toHaveLength(2);
    expect(data.comparison?.indices).toHaveLength(2);
    expect(data.missing).toContain("大盘指数部分缺失（2/3）");
  });

  it("板块与涨跌家数都取不到时写入两条缺失，且对比不含板块", async () => {
    sectorsMock.mockResolvedValue(null);
    breadthMock.mockResolvedValue(null);

    const data = await collectDailyReportData("stock", "2026-09-11", new Date("2026-09-13T02:00:00Z"));

    expect(data.sectors).toBeNull();
    expect(data.breadth).toBeNull();
    expect(data.missing).toContain("全市场涨跌家数（2026-09-11 上游与板块口径均不可用）");
    expect(data.missing).toContain("行业板块涨跌（2026-09-11 上游无可用数据）");
    // 指数仍可用，因此对比对象存在但板块部分为 null。
    expect(data.comparison?.indices).toHaveLength(3);
    expect(data.comparison?.sectors).toBeNull();
  });

  it("自选池取到确定性降级数据时剔除并记录缺失", async () => {
    quoteMock.mockResolvedValue([]);
    marketQuoteMock.mockResolvedValue({
      code: "600519",
      ts: "2026-09-11",
      price: 1500,
      change_pct: 0,
      open: 1500,
      high: 1500,
      low: 1500,
      prev_close: 1500,
      volume: 0,
      amount: 0,
      turnover_rate: null,
      pe: null,
      pb: null,
      market_cap: null,
      float_cap: null,
      source: "deterministic-fallback",
      fetched_at: "2026-09-13T02:00:00Z",
    });

    const data = await collectDailyReportData("stock", "2026-09-11", new Date("2026-09-11T08:00:00Z"));

    expect(data.holdings).toEqual([]);
    expect(data.missing.some((item) => item.startsWith("自选标的降级数据"))).toBe(true);
  });
});

describe("collectDailyReportData 当日", () => {
  it("快照用于展示，板块额外取一次历史口径用于对比", async () => {
    quoteMock.mockResolvedValue(
      allIndexSeries().map((series) => ({
        code: series.code,
        name: series.name,
        price: series.days[2].close,
        change: -1,
        change_pct: -1.18,
        amount: 958_186_337_000,
        source: "tencent",
        fetched_at: "2026-09-11T07:00:00Z",
      })),
    );
    sectorsMock.mockResolvedValueOnce(sinaSectors()).mockResolvedValueOnce(thsSectors());

    const data = await collectDailyReportData("stock", "2026-09-11", new Date("2026-09-11T08:00:00Z"));

    expect(sectorsMock).toHaveBeenCalledTimes(2);
    expect(sectorsMock).toHaveBeenNthCalledWith(1, 5, "2026-09-11");
    expect(sectorsMock).toHaveBeenNthCalledWith(2, 5, "2026-09-11", { history: true });
    // 展示用当日新浪口径，对比用同花顺历史口径。
    expect(data.sectors?.source).toBe("akshare");
    expect(data.comparison?.sectors?.prev_rise_count).toBe(10);
    expect(data.indices).toHaveLength(3);
  });

  it("当日板块全部失败时用历史口径兜底", async () => {
    quoteMock.mockResolvedValue([]);
    sectorsMock.mockResolvedValueOnce(null).mockResolvedValueOnce(thsSectors());

    const data = await collectDailyReportData("stock", "2026-09-11", new Date("2026-09-11T08:00:00Z"));

    expect(data.sectors?.source).toBe("ths");
    expect(data.sectors).not.toBeNull();
  });
});

describe("collectDailyReportData 基金", () => {
  it("历史日期用官方净值计算当日涨跌并过滤资讯日期", async () => {
    navMock.mockResolvedValue([
      {
        code: "510300",
        nav_date: "2026-09-09",
        unit_nav: 4.1,
        cumulative_nav: 4.1,
        daily_change_pct: 0.2,
        source: "eastmoney",
        fetched_at: "2026-09-13T02:00:00Z",
      },
      {
        code: "510300",
        nav_date: "2026-09-10",
        unit_nav: 4.2,
        cumulative_nav: 4.2,
        daily_change_pct: null,
        source: "eastmoney",
        fetched_at: "2026-09-13T02:00:00Z",
      },
    ]);
    fundNewsMock.mockResolvedValue({
      code: "510300",
      industries: ["沪深300"],
      industry_analysis_source: "holdings",
      available: true,
      reason: null,
      generated_at: "2026-09-10T02:00:00Z",
      news: [
        {
          id: "n1",
          code: "510300",
          title: "当日资讯",
          summary: "摘要",
          source: "示例来源",
          url: "https://example.com/1",
          published_at: "2026-09-10T01:00:00Z",
          fetched_at: "2026-09-10T01:00:00Z",
          status: "active",
          tags: [],
          pinned: false,
          sentiment: "neutral",
          confidence: 0.5,
          impact_days: 1,
          expire_at: "2026-09-17T01:00:00Z",
          news_type: "market",
        },
        {
          id: "n2",
          code: "510300",
          title: "更早资讯",
          summary: "摘要",
          source: "示例来源",
          url: "https://example.com/2",
          published_at: "2026-09-09T01:00:00Z",
          fetched_at: "2026-09-09T01:00:00Z",
          status: "active",
          tags: [],
          pinned: false,
          sentiment: "neutral",
          confidence: 0.5,
          impact_days: 1,
          expire_at: "2026-09-16T01:00:00Z",
          news_type: "market",
        },
      ],
    });

    const data = await collectDailyReportData("fund", "2026-09-10", new Date("2026-09-13T02:00:00Z"));

    expect(data.holdings).toHaveLength(3);
    // 官方净值缺 daily_change_pct 时用相邻净值推算：4.2 / 4.1 - 1 = 2.44%。
    expect(data.holdings[0]).toMatchObject({
      code: "510300",
      price: 4.2,
      nav_date: "2026-09-10",
      change_pct: 2.44,
    });
    expect(data.news).toHaveLength(1);
    expect(data.news[0].title).toBe("当日资讯");
  });
});
