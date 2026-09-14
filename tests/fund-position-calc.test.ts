// 基金持仓口径单测：固定推算本金、当日收益、累计收益率与各类降级分支。
import { describe, expect, it } from "vitest";

import {
  computeFundPositionMath,
  computeWeights,
  DEFAULT_FUND_PROFIT_CALIBER,
  isFundProfitCaliber,
  normalizeFundProfitCaliber,
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
    // 含当日口径：录入值即当前市值，上一交易日市值 = 10000 / 1.02 = 9803.92
    expect(result.marketValue).toBe(10_000);
    expect(result.prevMarketValue).toBe(9_803.92);
    expect(result.dayProfit).toBe(196.08);
    expect(result.prevTotalProfit).toBe(1_803.92);
  });

  it("满足恒等式「上一交易日累计收益 + 当日收益 = 累计收益」", () => {
    const result = computeFundPositionMath({ marketValue: 10_000, totalProfit: 2_000, changePct: 2 });
    expect((result.prevTotalProfit as number) + (result.dayProfit as number)).toBeCloseTo(
      result.totalProfit as number,
      2,
    );
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
      expect(result.prevMarketValue).toBeNull();
      // 含当日口径的当前市值与累计口径不依赖行情，仍然可用
      expect(result.marketValue).toBe(10_000);
      expect(result.costAmount).toBe(8_000);
      expect(result.totalProfitPct).toBe(25);
    }
  });

  it("推算本金非正时收益率留空", () => {
    expect(computeFundPositionMath({ marketValue: 1_000, totalProfit: 1_000, changePct: 1 }).totalProfitPct).toBeNull();
    expect(computeFundPositionMath({ marketValue: 1_000, totalProfit: 3_000, changePct: 1 }).totalProfitPct).toBeNull();
  });
});

describe("computeFundPositionMath 累计收益口径", () => {
  it("缺省按「含当日收益」处理，并在结果中回填口径", () => {
    const result = computeFundPositionMath({ marketValue: 10_000, totalProfit: 2_000, changePct: 2 });

    expect(result.profitCaliber).toBe(DEFAULT_FUND_PROFIT_CALIBER);
    expect(result.totalProfit).toBe(2_000);
    expect(result.prevTotalProfit).toBe(1_803.92);
  });

  it("不含当日口径：录入值即上一交易日口径，当前市值与累计收益按涨跌幅折算", () => {
    const result = computeFundPositionMath({
      marketValue: 10_000,
      totalProfit: 1_803.92,
      changePct: 2,
      profitCaliber: "exclude_today",
    });

    // 录入的 10,000 是上一交易日市值，当日 +2% → 当前市值 10,200
    expect(result.prevMarketValue).toBe(10_000);
    expect(result.marketValue).toBe(10_200);
    expect(result.dayProfit).toBe(200);
    expect(result.prevTotalProfit).toBe(1_803.92);
    expect(result.totalProfit).toBe(2_003.92);
    // 本金 = 录入市值 − 录入累计收益，与录入口径无关
    expect(result.costAmount).toBe(8_196.08);
    expect(result.totalProfitPct).toBe(24.45);
  });

  it("两种口径互为逆运算，且都满足恒等式", () => {
    const include = computeFundPositionMath({
      marketValue: 10_000,
      totalProfit: 2_000,
      changePct: 2,
      profitCaliber: "include_today",
    });
    // 把含当日口径推出的「上一交易日市值 + 上一交易日累计收益」当作不含当日口径的录入值，应还原出同一组结果。
    const exclude = computeFundPositionMath({
      marketValue: include.prevMarketValue as number,
      totalProfit: include.prevTotalProfit as number,
      changePct: 2,
      profitCaliber: "exclude_today",
    });

    expect(exclude.costAmount).toBe(include.costAmount);
    expect(exclude.totalProfit).toBe(include.totalProfit);
    expect(exclude.dayProfit).toBe(include.dayProfit);
    expect(exclude.prevTotalProfit).toBe(include.prevTotalProfit);
    expect((exclude.prevTotalProfit as number) + (exclude.dayProfit as number)).toBeCloseTo(
      exclude.totalProfit as number,
      2,
    );
  });

  it("不含当日口径下行情不可用：当前市值与当前累计收益留空，上一交易日口径保留录入值", () => {
    for (const changePct of [null, 120, -100, Number.NaN]) {
      const result = computeFundPositionMath({
        marketValue: 10_000,
        totalProfit: 2_000,
        changePct,
        profitCaliber: "exclude_today",
      });

      expect(result.marketValue).toBeNull();
      expect(result.dayProfit).toBeNull();
      expect(result.totalProfit).toBeNull();
      expect(result.totalProfitPct).toBeNull();
      // 录入值本身就是上一交易日口径，不依赖行情
      expect(result.prevMarketValue).toBe(10_000);
      expect(result.prevTotalProfit).toBe(2_000);
      // 推算本金只依赖录入值，任何情况下都可算
      expect(result.costAmount).toBe(8_000);
    }
  });

  it("口径工具函数：识别合法值，缺失或非法值归一到缺省", () => {
    expect(DEFAULT_FUND_PROFIT_CALIBER).toBe("include_today");
    expect(isFundProfitCaliber("include_today")).toBe(true);
    expect(isFundProfitCaliber("exclude_today")).toBe(true);
    expect(isFundProfitCaliber("bogus")).toBe(false);
    expect(isFundProfitCaliber(null)).toBe(false);
    expect(normalizeFundProfitCaliber(undefined)).toBe("include_today");
    expect(normalizeFundProfitCaliber("bogus")).toBe("include_today");
    expect(normalizeFundProfitCaliber("exclude_today")).toBe("exclude_today");
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

  it("任一只市值不可用时整列返回 null，避免部分合计算出失真占比", () => {
    expect(computeWeights([6_000, null])).toEqual([null, null]);
    expect(computeWeights([null, null])).toEqual([null, null]);
  });
});

describe("sumValuations", () => {
  it("汇总当前市值、推算本金与累计收益率", () => {
    const totals = sumValuations([
      { market_value: 10_000, cost_amount: 8_000, total_profit: 2_000, day_profit: 196.08 },
      { market_value: 5_000, cost_amount: 5_500, total_profit: -500, day_profit: null },
    ]);

    expect(totals.total_market_value).toBe(15_000);
    expect(totals.total_cost).toBe(13_500);
    expect(totals.total_profit).toBe(1_500);
    expect(totals.total_profit_pct).toBe(11.11);
    expect(totals.total_day_profit).toBe(196.08);
  });

  it("全部取不到当日收益时当日合计为 null，空组合收益率为 null", () => {
    const totals = sumValuations([
      { market_value: 1_000, cost_amount: 900, total_profit: 100, day_profit: null },
    ]);
    expect(totals.total_day_profit).toBeNull();
    expect(totals.total_profit_pct).toBe(11.11);
    expect(sumValuations([]).total_profit_pct).toBeNull();
    expect(sumValuations([]).total_day_profit).toBeNull();
  });

  it("任一只当前市值不可用时市值/收益合计留空（不做部分求和），但本金仍可合计", () => {
    const totals = sumValuations([
      { market_value: 10_000, cost_amount: 8_000, total_profit: 2_000, day_profit: 196.08 },
      { market_value: null, cost_amount: 5_500, total_profit: null, day_profit: null },
    ]);

    expect(totals.total_market_value).toBeNull();
    expect(totals.total_profit).toBeNull();
    expect(totals.total_profit_pct).toBeNull();
    // 推算本金只依赖录入值，任何情况下都可合计
    expect(totals.total_cost).toBe(13_500);
    // 当日收益合计维持既有约定：按可计算部分求和
    expect(totals.total_day_profit).toBe(196.08);
  });

  it("空组合仍按 0 汇总", () => {
    const totals = sumValuations([]);
    expect(totals.total_market_value).toBe(0);
    expect(totals.total_profit).toBe(0);
    expect(totals.total_cost).toBe(0);
    expect(totals.total_profit_pct).toBeNull();
  });
});