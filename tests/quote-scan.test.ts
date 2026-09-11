// 实时行情预警判定回归测试：快照转观测值、标的键隔离、冷却与非交易时段跳过。
import { describe, expect, it } from "vitest";

import { FALLBACK_SOURCE } from "@/lib/alerts";
import { evaluateQuoteAlerts, quoteItemKey, toQuoteObservations } from "@/lib/quote-scan";
import { buildFallbackTradingCalendar } from "@/lib/trading-calendar";
import type { QuoteStreamItem } from "@/lib/shared/types";

import { alertRule } from "./helpers/fixtures";

const TRADING_DAY = "2024-03-05"; // 周二

/** 按北京时间构造时刻，避免测试依赖运行环境时区。 */
function beijingTime(date: string, hour: number, minute = 0): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute));
}

const calendar = buildFallbackTradingCalendar();

/** 构造行情快照；默认贵州茅台跌 1.2%。 */
function quoteItem(overrides: Partial<QuoteStreamItem> = {}): QuoteStreamItem {
  return {
    code: "600519",
    target: "stock",
    price: 1700,
    change_pct: -1.2,
    prev_close: 1720,
    source: "akshare",
    fetched_at: "2024-03-05T02:00:00.000Z",
    ...overrides,
  };
}

describe("toQuoteObservations", () => {
  it("股票快照提供最新价与当日涨跌幅", () => {
    const observations = toQuoteObservations(quoteItem({ change_pct: -4.5, price: 1642.5 }));
    expect(observations).toEqual([
      {
        metric: "change_pct",
        value: -4.5,
        source: "akshare",
        observed_at: "2024-03-05T02:00:00.000Z",
      },
      {
        metric: "price",
        value: 1642.5,
        source: "akshare",
        observed_at: "2024-03-05T02:00:00.000Z",
      },
    ]);
  });

  it("基金快照映射为盘中估算净值与估算涨跌幅", () => {
    const observations = toQuoteObservations(
      quoteItem({ target: "fund", code: "110011", price: 1.2345, change_pct: -2.1 }),
    );
    expect(observations.map((item) => item.metric)).toEqual([
      "estimate_change_pct",
      "estimate_nav",
    ]);
    expect(observations[1].value).toBe(1.2345);
  });
});

describe("evaluateQuoteAlerts", () => {
  it("阈值命中时产出事件与规则 id", () => {
    const result = evaluateQuoteAlerts({
      items: [quoteItem({ change_pct: -4.5 })],
      rules: [alertRule()],
      now: beijingTime(TRADING_DAY, 10),
      calendar,
    });
    expect(result.events).toHaveLength(1);
    expect(result.triggered_rule_ids).toEqual(["alert-rule-1"]);
    expect(result.events[0].message).toContain("触发预警");
    expect(result.events[0].hits[0].value).toBe(-4.5);
  });

  it("未达阈值只记录跳过原因，不产出事件", () => {
    const result = evaluateQuoteAlerts({
      items: [quoteItem({ change_pct: -1.2 })],
      rules: [alertRule()],
      now: beijingTime(TRADING_DAY, 10),
      calendar,
    });
    expect(result.events).toHaveLength(0);
    expect(result.skipped_reasons).toContain("未达到触发条件");
  });

  it("冷却期内的规则不重复触发", () => {
    const result = evaluateQuoteAlerts({
      items: [quoteItem({ change_pct: -4.5 })],
      rules: [alertRule({ last_triggered_at: "2024-03-05T01:00:00.000Z" })],
      now: beijingTime(TRADING_DAY, 10),
      calendar,
    });
    expect(result.events).toHaveLength(0);
    expect(result.skipped_reasons).toContain("处于 12 小时冷却期内");
  });

  it("非交易时段不触发", () => {
    const result = evaluateQuoteAlerts({
      items: [quoteItem({ change_pct: -4.5 })],
      rules: [alertRule()],
      now: beijingTime(TRADING_DAY, 20),
      calendar,
    });
    expect(result.events).toHaveLength(0);
    expect(result.skipped_reasons.join(",")).toContain("非股票交易时段");
  });

  it("降级来源的观测值被判定引擎跳过", () => {
    const result = evaluateQuoteAlerts({
      items: [quoteItem({ change_pct: -4.5, source: FALLBACK_SOURCE })],
      rules: [alertRule()],
      now: beijingTime(TRADING_DAY, 10),
      calendar,
    });
    expect(result.events).toHaveLength(0);
    expect(result.skipped_reasons).toContain("观测值来自确定性降级数据，已跳过");
  });

  it("基金规则使用估算口径，历史净值类条件留给定时扫描", () => {
    const fundItem = quoteItem({
      target: "fund",
      code: "110011",
      price: 1.2345,
      change_pct: -4.5,
    });
    const estimateRule = alertRule({
      id: "fund-estimate",
      target: "fund",
      code: "110011",
      name: "易方达中小盘",
      conditions: [{ metric: "estimate_change_pct", operator: "lte", threshold: -3 }],
    });
    const navRule = alertRule({
      id: "fund-nav",
      target: "fund",
      code: "110011",
      name: "易方达中小盘",
      conditions: [{ metric: "unit_nav", operator: "lte", threshold: 1 }],
    });

    const result = evaluateQuoteAlerts({
      items: [fundItem],
      rules: [estimateRule, navRule],
      now: beijingTime(TRADING_DAY, 10),
      calendar,
    });
    expect(result.triggered_rule_ids).toEqual(["fund-estimate"]);
    expect(result.skipped_reasons.join(",")).toContain("缺少指标观测值");
  });

  it("同代码的股票与基金规则互不串号", () => {
    const stockRule = alertRule({ conditions: [{ metric: "price", operator: "lte", threshold: 9999 }] });
    const result = evaluateQuoteAlerts({
      // 只提供基金快照：股票规则不应被这条快照触发。
      items: [quoteItem({ target: "fund", code: "600519", price: 1.2, change_pct: -1 })],
      rules: [stockRule],
      now: beijingTime(TRADING_DAY, 10),
      calendar,
    });
    expect(result.events).toHaveLength(0);
    expect(result.skipped_reasons).toHaveLength(0);
  });

  it("快照未覆盖的规则不参与判定", () => {
    const result = evaluateQuoteAlerts({
      items: [],
      rules: [alertRule()],
      now: beijingTime(TRADING_DAY, 10),
      calendar,
    });
    expect(result.events).toHaveLength(0);
    expect(result.skipped_reasons).toHaveLength(0);
  });
});

describe("quoteItemKey", () => {
  it("用标的类型加代码区分同名代码", () => {
    expect(quoteItemKey({ target: "stock", code: "600519" })).toBe("stock:600519");
    expect(quoteItemKey({ target: "fund", code: "600519" })).toBe("fund:600519");
  });
});
