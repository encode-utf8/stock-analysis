// 基金持仓口径单测：固定推算本金、当日收益、累计收益率与各类降级分支。
import { describe, expect, it } from "vitest";

import {
  computeFundPositionMath,
  computeWeights,
  parseNumericInput,
  round2,
  roundPct,
  sumValuations,
} from "@/lib/fund-position-calc";

describe("数值解析与取整", () => {
  it("支持千分位字符串与数字", () => {
    expect(parseNumericInput(" 1,234.5 ")).toBe(1234.5);
    expect(parseNumericInput(12)).toBe(12);
    expect(parseNumericInput("")).toBeNull();
    expect(parseNumericInput("abc")).toBeNull();
    expect(parseNumericInput(null)).toBeNull();
    expect(parseNumericInput(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("round2 / roundPct 处理取整与非有限值", () => {
    expect(round2(1.111)).toBe(1.11);
    expect(round2(-1.111)).toBe(-1.11);
    expect(round2(Number.NaN)).toBe(0);
    expect(roundPct(1.234)).toBe(1.23);
    expect(roundPct(-1.235)).toBe(-1.24);
    expect(roundPct(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("computeFundPositionMath", () => {
  it("按持有金额与累计收益推算本金、当日收益与收益率", () => {
    const result = computeFundPositionMath({ marketValue: 10_000, totalProfit: 2_000, changePct: 2 });

    expect(result.costAmount).toBe(8_000);
    expect(result.totalProfit).toBe(2_000);
    expect(result.totalProfitPct).toBe(25);
    // 10000 − 10000 / 1.02 = 196.08
    expect(result.dayProfit).toBe(196.08);
    expect(result.prevTotalProfit).toBe(1_803.92);
  });

  it("满足恒等式「上一交易日累计收益 + 当日收益 = 累计收益」", () => {
    const result = computeFundPositionMath({ marketValue: 10_000, totalProfit: 2_000, changePct: 2 });
    expect((result.prevTotalProfit as number) + (result.dayProfit as number)).toBeCloseTo(result.totalProfit, 2);
  });

  it("亏损场景下当日收益为负", () => {
    const result = computeFundPositionMath({ marketValue: 8_000, totalProfit: -2_000, changePct: -1 });

    expect(result.costAmount).toBe(10_000);
    expect(result.totalProfitPct).toBe(-20);
    // 8000 − 8000 / 0.99 = −80.81
    expect(result.dayProfit).toBe(-80.81);
    expect(result.prevTotalProfit).toBe(-1_919.19);
  });

  it("涨跌幅缺失或异常时只置空当日口径", () => {
    for (const changePct of [null, 120, -100, Number.NaN]) {
      const result = computeFundPositionMath({ marketValue: 10_000, totalProfit: 2_000, changePct });
      expect(result.dayProfit).toBeNull();
      expect(result.prevTotalProfit).toBeNull();
      // 累计口径与涨跌幅无关，仍然可用
      expect(result.costAmount).toBe(8_000);
      expect(result.totalProfitPct).toBe(25);
    }
  });

  it("推算本金非正时收益率留空", () => {
    expect(computeFundPositionMath({ marketValue: 1_000, totalProfit: 1_000, changePct: 1 }).totalProfitPct).toBeNull();
    expect(computeFundPositionMath({ marketValue: 1_000, totalProfit: 3_000, changePct: 1 }).totalProfitPct).toBeNull();
  });
});

describe("computeWeights", () => {
  it("按持有金额计算占比并四舍五入", () => {
    expect(computeWeights([6_000, 4_000])).toEqual([60, 40]);
    expect(computeWeights([1, 2])).toEqual([33.33, 66.67]);
  });

  it("金额非法或总额为 0 时返回 0", () => {
    expect(computeWeights([0, 0])).toEqual([0, 0]);
    expect(computeWeights([])).toEqual([]);
    expect(computeWeights([Number.NaN, 100])).toEqual([0, 100]);
  });
});

describe("sumValuations", () => {
  it("汇总持有金额、推算本金与累计收益率", () => {
    const totals = sumValuations([
      { market_value: 10_000, total_profit: 2_000, day_profit: 196.08 },
      { market_value: 5_000, total_profit: -500, day_profit: null },
    ]);

    expect(totals.total_market_value).toBe(15_000);
    expect(totals.total_profit).toBe(1_500);
    expect(totals.total_cost).toBe(13_500);
    expect(totals.total_profit_pct).toBe(11.11);
    expect(totals.total_day_profit).toBe(196.08);
  });

  it("全部取不到当日收益时为 null，空组合收益率为 null", () => {
    const totals = sumValuations([{ market_value: 1_000, total_profit: 100, day_profit: null }]);
    expect(totals.total_day_profit).toBeNull();
    expect(totals.total_profit_pct).toBe(11.11);
    expect(sumValuations([]).total_profit_pct).toBeNull();
    expect(sumValuations([]).total_day_profit).toBeNull();
  });
});