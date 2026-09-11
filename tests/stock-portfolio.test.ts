// 个股持仓组合口径测试：校验入参解析、估值公式与组合汇总口径。
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildHolding,
  parseMoney,
  stockPortfolioRepository,
  summarizePortfolio,
  validateHoldingInput,
  validateHoldingUpdate,
  valueHolding,
} from "@/lib/stock-portfolio";
import type { MarketQuote, StockHolding } from "@/lib/shared/types";

/** 构造持仓记录。 */
function holding(overrides: Partial<StockHolding> = {}): StockHolding {
  return {
    id: "h-1",
    code: "600519",
    name: "贵州茅台",
    amount: 100_000,
    profit: 5_000,
    note: null,
    created_at: "2026-01-05T02:00:00.000Z",
    updated_at: "2026-01-05T02:00:00.000Z",
    ...overrides,
  };
}

/** 构造行情快照。 */
function quote(overrides: Partial<MarketQuote> = {}): MarketQuote {
  return {
    code: "600519",
    ts: "2026-01-06T02:00:00.000Z",
    price: 1_700,
    change_pct: 2,
    open: 1_680,
    high: 1_710,
    low: 1_670,
    prev_close: 1_666.67,
    volume: 1000,
    amount: 1_700_000,
    turnover_rate: null,
    pe: null,
    pb: null,
    market_cap: null,
    float_cap: null,
    source: "tencent",
    fetched_at: "2026-01-06T02:00:00.000Z",
    ...overrides,
  };
}

describe("parseMoney", () => {
  it("解析数字与带千分位的字符串", () => {
    expect(parseMoney(1234.5)).toBe(1234.5);
    expect(parseMoney(" 1,234.50 ")).toBe(1234.5);
    expect(parseMoney("-800")).toBe(-800);
  });

  it("空值与非法输入返回 null", () => {
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney(Number.NaN)).toBeNull();
    expect(parseMoney(null)).toBeNull();
  });
});

describe("validateHoldingInput", () => {
  it("接受合法入参并归一化备注", () => {
    const result = validateHoldingInput({ code: "600519", amount: "100000", profit: "-3000", note: " 定投 " });
    expect("value" in result).toBe(true);
    if ("value" in result) {
      expect(result.value).toEqual({ code: "600519", amount: 100000, profit: -3000, note: "定投" });
    }
  });

  it("收益缺省按 0 处理", () => {
    const result = validateHoldingInput({ code: "000001", amount: 50_000 });
    expect("value" in result && result.value.profit).toBe(0);
  });

  it("拒绝非法代码与非法金额", () => {
    expect(validateHoldingInput({ code: "12345", amount: 1000 })).toEqual({
      error: "请输入合法的沪深北 A 股 6 位代码。",
    });
    expect(validateHoldingInput({ code: "600519", amount: 0 })).toEqual({
      error: "投入金额必须是大于 0 的数字。",
    });
    expect(validateHoldingInput({ code: "600519", amount: "abc" })).toEqual({
      error: "投入金额必须是大于 0 的数字。",
    });
  });
});

describe("validateHoldingUpdate", () => {
  it("允许只改收益且可以为负", () => {
    const result = validateHoldingUpdate({ profit: -1200.5 });
    expect("value" in result && result.value).toEqual({ profit: -1200.5 });
  });

  it("空更新返回错误", () => {
    expect(validateHoldingUpdate({})).toEqual({ error: "没有需要更新的字段。" });
  });

  it("备注传空串表示清空", () => {
    const result = validateHoldingUpdate({ note: "   " });
    expect("value" in result && result.value.note).toBeNull();
  });
});

describe("valueHolding", () => {
  it("市值等于投入金额加持仓收益，并推导收益率", () => {
    const valuation = valueHolding(holding(), quote());
    expect(valuation.market_value).toBe(105_000);
    expect(valuation.profit_pct).toBe(5);
    expect(valuation.quote_available).toBe(true);
    expect(valuation.price).toBe(1_700);
  });

  it("按当日涨跌幅反推当日盈亏", () => {
    const valuation = valueHolding(holding(), quote({ change_pct: 10 }));
    // 市值 105000，昨收市值 105000 / 1.1 = 95454.55，当日盈亏约 9545.45
    expect(valuation.day_profit).toBeCloseTo(9_545.45, 2);
  });

  it("取不到行情时只保留手工口径", () => {
    const valuation = valueHolding(holding({ profit: -2_000 }), null);
    expect(valuation.market_value).toBe(98_000);
    expect(valuation.profit_pct).toBe(-2);
    expect(valuation.day_profit).toBeNull();
    expect(valuation.quote_available).toBe(false);
  });

  it("涨跌幅异常时不反推当日盈亏", () => {
    const valuation = valueHolding(holding(), quote({ change_pct: -100 }));
    expect(valuation.day_profit).toBeNull();
  });
});

describe("summarizePortfolio", () => {
  it("汇总总额、权重与行业分布", () => {
    const valuations = [
      valueHolding(holding({ id: "a", code: "600519", name: "贵州茅台", amount: 60_000, profit: 6_000 }), quote()),
      valueHolding(
        holding({ id: "b", code: "000001", name: "平安银行", amount: 40_000, profit: -4_000 }),
        quote({ change_pct: 1 }),
      ),
    ];
    const industries: Record<string, string> = { "600519": "白酒", "000001": "银行" };

    const summary = summarizePortfolio(valuations, (code) => industries[code] ?? null);

    expect(summary.total_amount).toBe(100_000);
    expect(summary.total_profit).toBe(2_000);
    expect(summary.total_profit_pct).toBe(2);
    expect(summary.total_market_value).toBe(102_000);
    expect(summary.holdings_count).toBe(2);
    expect(summary.weights.map((item) => item.code)).toEqual(["600519", "000001"]);
    expect(summary.weights[0].weight_pct).toBeCloseTo(64.71, 2);
    expect(summary.industry_allocation.map((item) => item.industry)).toEqual(["白酒", "银行"]);
  });

  it("未知行业归入未分类，空组合收益率为 null", () => {
    const summary = summarizePortfolio([valueHolding(holding(), null)], () => null);
    expect(summary.industry_allocation[0].industry).toBe("未分类");
    expect(summarizePortfolio([], () => null).total_profit_pct).toBeNull();
  });

  it("只统计取到行情的当日盈亏", () => {
    const valuations = [
      valueHolding(holding({ id: "a" }), quote({ change_pct: 10 })),
      valueHolding(holding({ id: "b", code: "000001" }), null),
    ];
    const summary = summarizePortfolio(valuations);
    expect(summary.day_profit).toBeCloseTo(9_545.45, 2);
  });
});

describe("stockPortfolioRepository 本地文件回退", () => {
  const file = path.join(process.cwd(), ".data", "stock-portfolio.json");
  let backup: string | null = null;

  beforeAll(async () => {
    // 备份并清空回退文件，避免影响本机已有数据。
    try {
      backup = await readFile(file, "utf8");
    } catch {
      backup = null;
    }
    await rm(file, { force: true });
  });

  afterAll(async () => {
    if (backup === null) {
      await rm(file, { force: true });
      return;
    }
    await writeFile(file, backup, "utf8");
  });

  it("未配置数据库时增删改查走本地 JSON 文件", async () => {
    const holding = buildHolding(
      { code: "600519", amount: 50_000, profit: 1_200, note: "回退测试" },
      "贵州茅台",
    );

    await stockPortfolioRepository.add(holding);
    expect(await stockPortfolioRepository.getById(holding.id)).toEqual(holding);
    expect((await stockPortfolioRepository.getByCode("600519"))?.amount).toBe(50_000);

    await stockPortfolioRepository.update(holding.id, { amount: 60_000, profit: -300 });
    const updated = await stockPortfolioRepository.getById(holding.id);
    expect(updated?.amount).toBe(60_000);
    expect(updated?.profit).toBe(-300);
    expect(updated?.updated_at).not.toBe(holding.updated_at);

    await stockPortfolioRepository.remove(holding.id);
    expect(await stockPortfolioRepository.list()).toEqual([]);
  });
});