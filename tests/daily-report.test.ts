// AI 收盘日报回归测试：时区、就绪判定、指标口径、模板降级与列表排序。
import { describe, expect, it } from "vitest";

import {
  REPORT_SECTIONS,
  beijingClock,
  buildDailyReportHeadline,
  buildDailyReportMessages,
  buildDailyReportMetrics,
  buildTemplateDailyReport,
  changeFromKlines,
  evaluateDailyReportReadiness,
  formatChangePct,
  isAfterChinaClose,
  summarizeChanges,
  toneOf,
} from "@/lib/daily-report";
import {
  dailyReportObjectKey,
  dedupeDailyReportSummaries,
  normalizeDailyReportDate,
  normalizeDailyReportKind,
  sortDailyReportSummaries,
  toDailyReportSummary,
} from "@/lib/daily-report-store";
import type {
  DailyReport,
  DailyReportData,
  DailyReportSummary,
  Kline,
} from "@/lib/shared/types";

function baseData(overrides: Partial<DailyReportData> = {}): DailyReportData {
  return {
    trade_date: "2026-09-10",
    indices: [
      {
        code: "sh000001",
        name: "上证指数",
        price: 3934.4,
        change: -17.11,
        change_pct: -0.43,
        amount: 779_672_690_000,
        source: "tencent",
        fetched_at: "2026-09-10T07:30:00Z",
      },
    ],
    breadth: {
      up: 931,
      down: 4192,
      flat: 83,
      limit_up: 39,
      limit_down: 14,
      suspended: 12,
      activity_pct: 17.84,
      stat_date: "2026-09-10 15:00:00",
      source: "legulegu",
      fetched_at: "2026-09-10T07:30:00Z",
    },
    sectors: {
      top: [{ name: "船舶制造", change_pct: 2.61, companies: 8, amount: 1, leader: "中国船舶" }],
      bottom: [{ name: "纺织机械", change_pct: -3.13, companies: 8, amount: 1, leader: "中捷资源" }],
      total: 49,
      source: "akshare",
      fetched_at: "2026-09-10T07:30:00Z",
    },
    holdings: [
      {
        code: "600519",
        name: "贵州茅台",
        change_pct: -0.5,
        price: 1500,
        nav_date: null,
        note: null,
        source: "tencent",
      },
    ],
    news: [
      {
        title: "示例资讯标题",
        source: "示例来源",
        url: "https://example.com/news",
        published_at: "2026-09-10T01:00:00Z",
      },
    ],
    missing: [],
    ...overrides,
  };
}

function summary(date: string, generatedAt: string, kind: "stock" | "fund" = "stock"): DailyReportSummary {
  return {
    kind,
    date,
    generated_at: generatedAt,
    source: "deepseek",
    storage: "r2",
    title: `${date} AI 股市日报`,
    headline: "摘要",
    metrics: [],
  };
}

describe("北京时间与收盘判定", () => {
  it("按北京时间取日期键与分钟数", () => {
    const clock = beijingClock(new Date("2026-09-10T01:30:00Z"));
    expect(clock.date).toBe("2026-09-10");
    expect(clock.minutes).toBe(9 * 60 + 30);
  });

  it("15:00 之后才视为收盘", () => {
    expect(isAfterChinaClose(new Date("2026-09-10T06:59:00Z"))).toBe(false);
    expect(isAfterChinaClose(new Date("2026-09-10T07:00:00Z"))).toBe(true);
  });
});

describe("指标格式化", () => {
  it("涨跌色调遵循红涨绿跌", () => {
    expect(toneOf(1)).toBe("up");
    expect(toneOf(-1)).toBe("down");
    expect(toneOf(0)).toBe("flat");
    expect(toneOf(null)).toBe("flat");
  });

  it("百分比带符号且保留两位", () => {
    expect(formatChangePct(1.234)).toBe("+1.23%");
    expect(formatChangePct(-0.5)).toBe("-0.50%");
    expect(formatChangePct(null)).toBe("—");
  });

  it("汇总平均涨跌与涨跌家数", () => {
    const result = summarizeChanges([1, -1, null, 2]);
    expect(result.average).toBe(0.67);
    expect(result.up).toBe(2);
    expect(result.down).toBe(1);
  });

  it("无有效数据时平均值为 null", () => {
    expect(summarizeChanges([null, null])).toEqual({ average: null, up: 0, down: 0 });
  });
});

describe("历史日期取数", () => {
  const klines: Kline[] = [
    { code: "600519", period: "day", ts: "2026-09-09T00:00:00+08:00", close: 100, open: 99, high: 101, low: 98, volume: 1, amount: 1, adj_type: "qfq", source: "akshare", fetched_at: "x" },
    { code: "600519", period: "day", ts: "2026-09-10T00:00:00+08:00", close: 110, open: 101, high: 111, low: 100, volume: 1, amount: 1, adj_type: "qfq", source: "akshare", fetched_at: "x" },
  ];

  it("按日期取收盘与前收计算涨跌幅", () => {
    expect(changeFromKlines(klines, "2026-09-10")).toEqual({ price: 110, changePct: 10 });
  });

  it("日期不在 K 线中返回 null", () => {
    expect(changeFromKlines(klines, "2026-09-08")).toBeNull();
  });
});

describe("就绪判定", () => {
  it("股市：收盘涨跌家数已更新即就绪", () => {
    const result = evaluateDailyReportReadiness(
      "stock",
      "2026-09-10",
      baseData(),
      new Date("2026-09-10T08:00:00Z"),
    );
    expect(result.ready).toBe(true);
    expect(result.reason).toContain("涨跌家数");
  });

  it("股市：未收盘且无涨跌家数时不就绪", () => {
    const result = evaluateDailyReportReadiness(
      "stock",
      "2026-09-10",
      baseData({ breadth: null }),
      new Date("2026-09-10T03:00:00Z"),
    );
    expect(result.ready).toBe(false);
    expect(result.reason).toContain("15:00");
  });

  it("股市：指数取不到时不就绪", () => {
    const result = evaluateDailyReportReadiness(
      "stock",
      "2026-09-10",
      baseData({ breadth: null, indices: [] }),
      new Date("2026-09-10T08:00:00Z"),
    );
    expect(result.ready).toBe(false);
  });

  it("基金：当日净值公布即就绪", () => {
    const result = evaluateDailyReportReadiness(
      "fund",
      "2026-09-10",
      baseData({
        holdings: [
          { code: "110022", name: "易方达消费", change_pct: -1.67, price: 2.84, nav_date: "2026-09-10", note: null, source: "akshare" },
        ],
      }),
      new Date("2026-09-10T12:00:00Z"),
    );
    expect(result.ready).toBe(true);
    expect(result.reason).toContain("净值");
  });

  it("历史日期：采集到数据即可补生成", () => {
    const result = evaluateDailyReportReadiness(
      "stock",
      "2026-09-01",
      baseData({ trade_date: "2026-09-01" }),
      new Date("2026-09-10T08:00:00Z"),
    );
    expect(result.ready).toBe(true);
    expect(result.reason).toContain("历史日期");
  });

  it("历史日期：无任何数据时不生成", () => {
    const result = evaluateDailyReportReadiness(
      "stock",
      "2026-09-01",
      baseData({ indices: [], holdings: [] }),
      new Date("2026-09-10T08:00:00Z"),
    );
    expect(result.ready).toBe(false);
  });
});

describe("指标卡片与摘要", () => {
  it("股市指标包含指数、涨跌家数与板块", () => {
    const labels = buildDailyReportMetrics("stock", baseData()).map((item) => item.label);
    expect(labels).toContain("上证指数");
    expect(labels).toContain("涨跌家数");
    expect(labels).toContain("领涨板块");
    expect(labels).toContain("领跌板块");
    expect(labels).toContain("自选股平均");
  });

  it("基金指标包含自选基金平均", () => {
    const labels = buildDailyReportMetrics("fund", baseData()).map((item) => item.label);
    expect(labels).toContain("自选基金平均");
  });

  it("基金多于一只时给出领涨/领跌基金", () => {
    const labels = buildDailyReportMetrics(
      "fund",
      baseData({
        holdings: [
          { code: "110022", name: "易方达消费", change_pct: -1.67, price: 2.84, nav_date: null, note: null, source: "sina" },
          { code: "510300", name: "沪深300ETF", change_pct: -0.43, price: 4.1, nav_date: null, note: null, source: "akshare" },
        ],
      }),
    ).map((item) => item.label);
    expect(labels).toContain("领涨基金");
    expect(labels).toContain("领跌基金");
  });

  it("摘要引用具体数字", () => {
    const headline = buildDailyReportHeadline("stock", baseData());
    expect(headline).toContain("3934.40");
    expect(headline).toContain("931 家上涨");
    expect(headline).toContain("船舶制造");
  });

  it("数据全缺时摘要说明缺失原因", () => {
    const headline = buildDailyReportHeadline(
      "stock",
      baseData({ indices: [], holdings: [], sectors: null, breadth: null, missing: ["大盘指数"] }),
    );
    expect(headline).toContain("数据缺失");
  });
});

describe("提示词与模板降级", () => {
  it("提示词包含固定章节与缺失说明", () => {
    const messages = buildDailyReportMessages("stock", "2026-09-10", baseData());
    expect(messages.system).toContain(REPORT_SECTIONS.stock[0]);
    expect(messages.user).toContain("2026-09-10");
    expect(messages.user).toContain("2026-09-10 15:00:00");
  });

  it("模板日报包含全部章节与关键数字", () => {
    const markdown = buildTemplateDailyReport("stock", "2026-09-10", baseData());
    for (const heading of REPORT_SECTIONS.stock) {
      expect(markdown).toContain(heading);
    }
    expect(markdown).toContain("3934.40");
    expect(markdown).toContain("931");
    expect(markdown).toContain("船舶制造");
  });

  it("缺失数据在模板中显式说明", () => {
    const markdown = buildTemplateDailyReport(
      "stock",
      "2026-09-10",
      baseData({ breadth: null, sectors: null, missing: ["全市场涨跌家数（行情侧车暂不可用）"] }),
    );
    expect(markdown).toContain("数据缺失说明");
    expect(markdown).toContain("本日全市场涨跌家数不可用");
  });
});

describe("日报存储契约", () => {
  it("对象键按类型与日期拼接", () => {
    expect(dailyReportObjectKey("stock", "2026-09-10")).toBe(
      "daily-reports/stock/2026-09-10.json",
    );
  });

  it("类型与日期校验拒绝非法输入", () => {
    expect(normalizeDailyReportKind("stock")).toBe("stock");
    expect(normalizeDailyReportKind("other")).toBeNull();
    expect(normalizeDailyReportDate("2026-09-10")).toBe("2026-09-10");
    expect(normalizeDailyReportDate("2026-9-1")).toBeNull();
    expect(normalizeDailyReportDate("../../etc/passwd")).toBeNull();
  });

  it("列表按日期倒序", () => {
    const sorted = sortDailyReportSummaries([
      summary("2026-09-01", "2026-09-01T10:00:00.000Z"),
      summary("2026-09-10", "2026-09-10T10:00:00.000Z"),
      summary("2026-09-05", "2026-09-05T10:00:00.000Z"),
    ]);
    expect(sorted.map((item) => item.date)).toEqual([
      "2026-09-10",
      "2026-09-05",
      "2026-09-01",
    ]);
  });

  it("同日期去重保留生成时间更新的一条", () => {
    const merged = dedupeDailyReportSummaries([
      summary("2026-09-10", "2026-09-10T10:00:00.000Z"),
      summary("2026-09-10", "2026-09-10T12:00:00.000Z"),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].generated_at).toBe("2026-09-10T12:00:00.000Z");
  });

  it("摘要提取只保留列表字段", () => {
    const report: DailyReport = {
      ...summary("2026-09-10", "2026-09-10T10:00:00.000Z"),
      markdown: "# 正文",
      data: baseData(),
      model: "deepseek-chat",
    };
    const result = toDailyReportSummary(report);
    expect(result).not.toHaveProperty("markdown");
    expect(result.date).toBe("2026-09-10");
  });
});