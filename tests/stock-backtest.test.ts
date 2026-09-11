// 个股回测引擎测试：覆盖信号识别、次日开盘成交、费用滑点与再平衡口径。
import { describe, expect, it } from "vitest";

import {
  buildMaCrossSignals,
  isUsableBacktestKlines,
  calculateBacktestMetrics,
  runPortfolioRebalanceBacktest,
  runSingleAssetBacktest,
  smaSeries,
  type BacktestBar,
} from "@/lib/stock-backtest";
import { normalizeBacktestRequest, resolveKlineLimit } from "@/lib/stock-backtest-request";
import type { BacktestPoint, Kline } from "@/lib/shared/types";

/** 由收盘价构造 K 线；开盘价与收盘价取同值，便于手工验算。 */
function bars(closes: number[], startDate = "2024-01-01"): BacktestBar[] {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  return closes.map((close, index) => ({
    date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
    open: close,
    high: close,
    low: close,
    close,
  }));
}

const NO_COST = { initialCapital: 1_000, feeRate: 0, stampDutyRate: 0, slippageRate: 0 };

describe("smaSeries", () => {
  it("窗口不足处为 null", () => {
    expect(smaSeries([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
  });
});

describe("buildMaCrossSignals", () => {
  it("快线上穿慢线买入、下穿卖出", () => {
    const closes = [10, 10, 10, 20, 30, 40, 50, 40, 30, 20, 10];
    const signals = buildMaCrossSignals(closes, 2, 3);
    expect(signals[3]).toBe("buy");
    expect(signals[8]).toBe("sell");
    expect(signals.filter(Boolean)).toEqual(["buy", "sell"]);
  });
});

describe("runSingleAssetBacktest", () => {
  it("信号在下一根 K 线开盘价成交，不使用未来数据", () => {
    const input = {
      code: "600519",
      bars: bars([10, 10, 10, 20, 30, 40, 50]),
      signals: buildMaCrossSignals([10, 10, 10, 20, 30, 40, 50], 2, 3),
      ...NO_COST,
    };
    const output = runSingleAssetBacktest(input);

    // 买点在 index 3，成交价应为 index 4 的开盘价 30，而非 index 3 的 20。
    expect(output.trades).toHaveLength(1);
    expect(output.trades[0].entry_date).toBe(input.bars[4].date);
    expect(output.trades[0].entry_price).toBe(30);
    expect(output.metrics.final_equity).toBeCloseTo((1_000 / 30) * 50, 2);
    expect(output.equityCurve).toHaveLength(7);
  });

  it("手续费与滑点会降低最终权益", () => {
    const input = {
      code: "600519",
      bars: bars([10, 10, 10, 20, 30, 40, 50]),
      signals: buildMaCrossSignals([10, 10, 10, 20, 30, 40, 50], 2, 3),
    };
    const free = runSingleAssetBacktest({ ...input, ...NO_COST });
    const costly = runSingleAssetBacktest({
      ...input,
      initialCapital: 1_000,
      feeRate: 0.001,
      stampDutyRate: 0.001,
      slippageRate: 0.001,
    });
    expect(costly.metrics.final_equity).toBeLessThan(free.metrics.final_equity);
  });

  it("回测结束仍有持仓时按最后收盘价强制结算", () => {
    const closes = [10, 10, 10, 20, 30, 40];
    const output = runSingleAssetBacktest({
      code: "600519",
      bars: bars(closes),
      signals: buildMaCrossSignals(closes, 2, 3),
      ...NO_COST,
    });
    expect(output.trades).toHaveLength(1);
    expect(output.trades[0].exit_reason).toBe("回测结束强制平仓");
    expect(output.warnings.some((item) => item.includes("强制结算"))).toBe(true);
  });
});

describe("runPortfolioRebalanceBacktest", () => {
  const dates = bars([100, 102, 104, 106, 108, 110, 112, 114, 116, 118], "2024-01-31").map(
    (bar) => bar.date,
  );

  it("同涨幅标的下再平衡不改变组合净值，且与买入持有基准一致", () => {
    const first = bars([100, 102, 104, 106, 108, 110, 112, 114, 116, 118], "2024-01-31");
    const second = bars([50, 51, 52, 53, 54, 55, 56, 57, 58, 59], "2024-01-31");
    const output = runPortfolioRebalanceBacktest({
      items: [
        { code: "600519", weight: 60 },
        { code: "000001", weight: 40 },
      ],
      barsByCode: { "600519": first, "000001": second },
      rebalance: "monthly",
      ...NO_COST,
    });

    expect(output.equityCurve).toHaveLength(dates.length);
    const last = output.equityCurve.at(-1);
    expect(last?.strategy).toBeCloseTo(last?.benchmark ?? 0, 0);
    // 两个标的都是 100 → 118（+18%），组合净值应同步增长 18%。
    expect(last?.strategy).toBeCloseTo(1_180, 0);
  });

  it("再平衡记录以调仓口径写入 trades，且不适用胜率", () => {
    const first = bars([100, 130, 90, 140, 95, 150, 100, 160, 105, 170], "2024-01-31");
    const second = bars([50, 50, 50, 50, 50, 50, 50, 50, 50, 50], "2024-01-31");
    const output = runPortfolioRebalanceBacktest({
      items: [
        { code: "600519", weight: 60 },
        { code: "000001", weight: 40 },
      ],
      barsByCode: { "600519": first, "000001": second },
      rebalance: "quarterly",
      ...NO_COST,
    });

    expect(output.trades.every((trade) => trade.exit_reason === "组合再平衡调仓")).toBe(true);
    expect(output.metrics.trade_count).toBe(output.trades.length);
    expect(output.metrics.win_rate_pct).toBeNull();
    expect(output.warnings.some((item) => item.includes("调仓记录"))).toBe(true);
  });
});

describe("calculateBacktestMetrics", () => {
  it("计算总收益、最大回撤与修复完成情况", () => {
    const curve: BacktestPoint[] = [
      { date: "2024-01-01", strategy: 100, benchmark: 100 },
      { date: "2024-01-11", strategy: 80, benchmark: 95 },
      { date: "2024-01-21", strategy: 120, benchmark: 110 },
    ];
    const metrics = calculateBacktestMetrics(curve, [], 100, "closed-trades");

    expect(metrics.total_return_pct).toBe(20);
    expect(metrics.max_drawdown_pct).toBe(20);
    expect(metrics.max_drawdown_start).toBe("2024-01-01");
    expect(metrics.max_drawdown_end).toBe("2024-01-11");
    expect(metrics.max_drawdown_recovery_end).toBe("2024-01-21");
    expect(metrics.max_drawdown_recovery_complete).toBe(true);
    expect(metrics.benchmark_return_pct).toBe(10);
  });
});

describe("normalizeBacktestRequest", () => {
  it("缺省参数下生成 MA5/MA20 规格", () => {
    const parsed = normalizeBacktestRequest({ code: "600519", strategy: "ma-cross", period: "day" });
    expect("value" in parsed).toBe(true);
    if ("value" in parsed) {
      expect(parsed.value.paramsLabel).toBe("MA5/MA20");
      expect(parsed.value.codes).toEqual(["600519"]);
      expect(parsed.value.initialCapital).toBe(100_000);
    }
  });

  it("快线不小于慢线时报错", () => {
    const parsed = normalizeBacktestRequest({
      code: "600519",
      strategy: "ma-cross",
      period: "day",
      params: { fast: 30, slow: 20 },
    });
    expect(parsed).toEqual({ error: "快线周期必须小于慢线周期。" });
  });

  it("组合权重非法或代码重复时报错", () => {
    expect(
      normalizeBacktestRequest({
        strategy: "portfolio-rebalance",
        period: "day",
        params: { items: [{ code: "600519", weight: 100 }] },
      }),
    ).toEqual({ error: "组合再平衡需要 2-5 个标的。" });

    expect(
      normalizeBacktestRequest({
        strategy: "portfolio-rebalance",
        period: "day",
        params: {
          items: [
            { code: "600519", weight: 60 },
            { code: "600519", weight: 40 },
          ],
        },
      }),
    ).toEqual({ error: "组合中代码 600519 重复。" });
  });

  it("区间与周期决定拉取根数，且受上下限约束", () => {
    expect(resolveKlineLimit("day", "2025-01-01", "2025-12-31")).toBeGreaterThan(200);
    expect(resolveKlineLimit("day", "2024-01-01", "2025-12-31")).toBe(551);
    // 区间过长时受上限约束，区间极短时受下限约束。
    expect(resolveKlineLimit("day", "2000-01-01", "2025-12-31")).toBe(1500);
    expect(resolveKlineLimit("week", null, null)).toBeGreaterThanOrEqual(60);
    expect(resolveKlineLimit("day", "2025-12-01", "2025-12-31")).toBe(61);
  });
});

describe("isUsableBacktestKlines", () => {
  /** 构造带来源标记的 K 线。 */
  function kline(source?: string): Kline {
    return {
      code: "600519",
      period: "day",
      ts: "2026-01-05T00:00:00+08:00",
      open: 10,
      high: 11,
      low: 9,
      close: 10,
      volume: 100,
      amount: 1000,
      adj_type: "qfq",
      ...(source ? { source } : {}),
    };
  }

  it("侧车真实数据可用", () => {
    expect(isUsableBacktestKlines([kline("akshare"), kline("tencent")])).toBe(true);
  });

  it("确定性降级数据与缺失来源的数据都不可用", () => {
    expect(isUsableBacktestKlines([kline("deterministic-fallback")])).toBe(false);
    expect(isUsableBacktestKlines([kline("akshare"), kline()])).toBe(false);
    expect(isUsableBacktestKlines([])).toBe(false);
  });
});