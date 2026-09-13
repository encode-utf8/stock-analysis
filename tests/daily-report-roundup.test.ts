// A 组日报能力收尾回归测试：对比区块、提示词口径、摘要邮件与回补/删除编排。
import { beforeAll, describe, expect, it } from "vitest";

import { buildDailyReportMessages, buildTemplateDailyReport } from "@/lib/daily-report";
import { buildDailyReportDigest } from "@/lib/daily-report-email";
import { deleteDailyReport, getDailyReport, saveDailyReport } from "@/lib/daily-report-store";
import { normalizeBackfillDays, recentTradingDays } from "@/lib/scheduler";
import { buildTradingCalendar } from "@/lib/trading-calendar";
import type { DailyReport, DailyReportData } from "@/lib/shared/types";

/** 测试用对比数据：三个指数的环比与板块轮动。 */
function comparison(): NonNullable<DailyReportData["comparison"]> {
  return {
    prev_date: "2026-09-09",
    indices: [
      {
        code: "sh000001",
        name: "上证指数",
        price: 3934.4,
        change_pct: -0.43,
        prev_change_pct: 0.51,
        amount: 779_672_690_000,
        prev_amount: 700_000_000_000,
        amount_change_pct: 11.38,
      },
      {
        code: "sz399001",
        name: "深证成指",
        price: 13471.26,
        change_pct: -1.08,
        prev_change_pct: null,
        amount: 1_013_712_000_000,
        prev_amount: null,
        amount_change_pct: null,
      },
    ],
    sectors: {
      prev_date: "2026-09-09",
      prev_rise_count: 67,
      prev_fall_count: 23,
      newcomers: ["元件", "通信设备"],
      dropped: ["多元金融"],
    },
  };
}

/** 测试用数据快照：股市日报最小可用集合。 */
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
      top: [{ name: "元件", change_pct: 3.11, companies: null, amount: 1, leader: null }],
      bottom: [{ name: "多元金融", change_pct: -4.47, companies: null, amount: 1, leader: null }],
      total: 90,
      source: "ths",
      fetched_at: "2026-09-10T07:30:00Z",
    },
    comparison: comparison(),
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
    news: [],
    missing: [],
    ...overrides,
  };
}

function report(data: DailyReportData = baseData()): DailyReport {
  return {
    kind: "stock",
    date: "2026-09-10",
    generated_at: "2026-09-10T08:00:00.000Z",
    source: "deepseek",
    storage: "local",
    title: "2026-09-10 AI 股市日报",
    headline: "上证指数收跌 0.43%，元件板块领涨",
    metrics: [
      { label: "成交额环比", value: "+11.38%", change_pct: 11.38, tone: "up" },
    ],
    markdown: "## 一、市场概况\n正文内容。",
    data,
    model: "deepseek-chat",
  };
}

describe("日报对比区块", () => {
  it("指数区块输出较前一交易日涨跌幅与成交额环比", () => {
    const markdown = buildTemplateDailyReport("stock", "2026-09-10", baseData());
    expect(markdown).toContain("较前一交易日（2026-09-09）涨跌幅");
    expect(markdown).toContain("上证指数 -0.43%（前一日 +0.51%）");
    expect(markdown).toContain("成交额环比：上证指数 +11.38%");
  });

  it("板块区块输出板块轮动与前一交易日涨跌分布", () => {
    const markdown = buildTemplateDailyReport("stock", "2026-09-10", baseData());
    expect(markdown).toContain("板块轮动（对比 2026-09-09）");
    expect(markdown).toContain("涨幅榜新进 元件、通信设备，掉出 多元金融");
    expect(markdown).toContain("前一交易日（2026-09-09）板块涨跌分布：上涨 67 个、下跌 23 个");
  });

  it("无对比数据时不编造环比", () => {
    const markdown = buildTemplateDailyReport("stock", "2026-09-10", baseData({ comparison: null }));
    expect(markdown).not.toContain("较前一交易日");
    expect(markdown).not.toContain("成交额环比");
    expect(markdown).not.toContain("板块轮动");
  });
});

describe("日报提示词口径", () => {
  it("有对比数据时要求引用并写明板块口径", () => {
    const { user } = buildDailyReportMessages("stock", "2026-09-10", baseData());
    expect(user).toContain("对比数据是「2026-09-09」环比");
    expect(user).toContain("不得与个股涨跌家数混用");
    expect(user).toContain("不要做涨跌家数的环比");
  });

  it("无缺失项时禁止正文写「不可用」", () => {
    const { user } = buildDailyReportMessages("stock", "2026-09-10", baseData());
    expect(user).toContain("本次没有任何缺失项");
    expect(user).toContain("不得出现「不可用」「数据缺失」");
  });

  it("历史板块口径说明成分公司数属于口径限制", () => {
    const { user } = buildDailyReportMessages("stock", "2026-09-10", baseData());
    expect(user).toContain("同花顺板块指数");
    expect(user).toContain("不是数据缺失");
  });
});

describe("日报摘要邮件", () => {
  it("主题包含类型、日期与摘要", () => {
    const { subject } = buildDailyReportDigest(report());
    expect(subject).toBe("【AI 股市日报】2026-09-10 上证指数收跌 0.43%，元件板块领涨");
  });

  it("正文包含指标、缺失项、Markdown 与免责声明", () => {
    const data = baseData({ missing: ["全市场涨跌家数（上游不可用）"] });
    const { text } = buildDailyReportDigest(report(data));
    expect(text).toContain("2026-09-10 股市日报（AI 生成）");
    expect(text).toContain("关键指标：");
    expect(text).toContain("- 成交额环比：+11.38%（+11.38%）");
    expect(text).toContain("数据缺失：全市场涨跌家数（上游不可用）");
    expect(text).toContain("正文内容。");
    expect(text).toContain("不构成任何投资建议");
  });

  it("模板降级时标注模板来源", () => {
    const { text } = buildDailyReportDigest({ ...report(), source: "template" });
    expect(text).toContain("（模板降级）");
  });
});

describe("批量回补编排", () => {
  it("回补天数规范化到 1-30，非法值回落 5", () => {
    expect(normalizeBackfillDays(undefined)).toBe(5);
    expect(normalizeBackfillDays("abc")).toBe(5);
    expect(normalizeBackfillDays(0)).toBe(1);
    expect(normalizeBackfillDays(3.9)).toBe(3);
    expect(normalizeBackfillDays("7")).toBe(7);
    expect(normalizeBackfillDays(100)).toBe(30);
  });

  it("按交易日历回溯最近 N 个交易日并跳过周末", () => {
    const calendar = buildTradingCalendar({
      source: "akshare",
      fetched_at: "2026-09-13T00:00:00.000Z",
      days: ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"],
    });
    expect(recentTradingDays(calendar, "2026-09-13", 3)).toEqual([
      "2026-09-11",
      "2026-09-10",
      "2026-09-09",
    ]);
    expect(recentTradingDays(calendar, "2026-09-13", 5)).toHaveLength(5);
  });
});

describe("日报删除", () => {
  beforeAll(() => {
    // 清空 R2 配置，确保单测只走本地文件分支，不访问远端对象存储。
    for (const key of [
      "R2_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_BUCKET_NAME",
      "R2_PUBLIC_URL",
    ]) {
      delete process.env[key];
    }
  });

  it("保存后可删除，详情与索引同步移除", async () => {
    // 使用明显不属于真实业务的日期，避免误删本地已有日报。
    const target: DailyReport = { ...report(), date: "1999-01-02" };
    const storage = await saveDailyReport(target);
    expect(storage).toBe("local");
    expect((await getDailyReport("stock", "1999-01-02"))?.report.date).toBe("1999-01-02");

    const result = await deleteDailyReport("stock", "1999-01-02");
    expect(result.deleted).toBe(true);
    expect(result.storage).toBe("local");
    expect(await getDailyReport("stock", "1999-01-02")).toBeNull();
  });

  it("删除不存在的日期不报错且 deleted 为 false", async () => {
    const result = await deleteDailyReport("stock", "1999-01-03");
    expect(result.deleted).toBe(false);
    expect(result.storage).toBeNull();
  });
});
