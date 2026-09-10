// 基金风险指标纯计算回归测试：区间收益、波动、最大回撤与修复进度。
import { describe, expect, it } from "vitest";

import { fundNavSeries } from "./helpers/fixtures";

import { calculateFundRiskMetrics, findMaxDrawdownIndices } from "@/lib/fund-metrics";

describe("calculateFundRiskMetrics", () => {
  it("有效净值点少于两个时返回 null", () => {
    expect(calculateFundRiskMetrics("510300", "1y", [])).toBeNull();
    expect(calculateFundRiskMetrics("510300", "1y", fundNavSeries([["2024-01-01", 1]]))).toBeNull();
    expect(
      calculateFundRiskMetrics("510300", "1y", fundNavSeries([["2024-01-01", 0], ["2024-01-02", 1]])),
    ).toBeNull();
  });

  it("识别最大回撤区间，并在回到前高后标记修复完成", () => {
    const nav = fundNavSeries([
      ["2024-01-01", 1],
      ["2024-01-02", 1.1],
      ["2024-01-03", 0.88],
      ["2024-01-04", 1.1],
      ["2024-01-05", 1.21],
    ]);
    const metrics = calculateFundRiskMetrics("510300", "1y", nav);

    expect(metrics).not.toBeNull();
    expect(metrics!.code).toBe("510300");
    expect(metrics!.range).toBe("1y");
    expect(metrics!.start_date).toBe("2024-01-01");
    expect(metrics!.end_date).toBe("2024-01-05");
    expect(metrics!.max_drawdown_pct).toBe(20);
    expect(metrics!.max_drawdown_start).toBe("2024-01-02");
    expect(metrics!.max_drawdown_end).toBe("2024-01-03");
    expect(metrics!.max_drawdown_recovery_start).toBe("2024-01-03");
    expect(metrics!.max_drawdown_recovery_end).toBe("2024-01-04");
    expect(metrics!.max_drawdown_recovery_complete).toBe(true);
    expect(metrics!.longest_recovery_days).toBe(2);
    expect(metrics!.average_recovery_days).toBe(2);
    expect(metrics!.current_drawdown_pct).toBe(0);
    expect(metrics!.current_recovery_progress_pct).toBe(100);
    expect(metrics!.annualized_return_pct).not.toBeNull();
    expect(metrics!.calmar).not.toBeNull();
  });

  it("回撤尚未修复时给出进行中的修复进度", () => {
    const nav = fundNavSeries([
      ["2024-01-01", 1],
      ["2024-01-02", 1.1],
      ["2024-01-03", 0.88],
      ["2024-01-04", 0.9],
    ]);
    const metrics = calculateFundRiskMetrics("510300", "1y", nav)!;

    expect(metrics.max_drawdown_pct).toBe(20);
    expect(metrics.max_drawdown_recovery_complete).toBe(false);
    expect(metrics.max_drawdown_recovery_end).toBeNull();
    expect(metrics.longest_recovery_days).toBeNull();
    expect(metrics.current_drawdown_pct).toBe(18.18);
    expect(metrics.current_recovery_progress_pct).toBe(9.09);
  });

  it("过滤无效净值、按日期排序，无回撤时最大回撤为 0", () => {
    const nav = fundNavSeries([
      ["2024-01-03", 1.1],
      ["2024-01-01", 1],
      ["2024-01-02", 0],
    ]);
    const metrics = calculateFundRiskMetrics("510300", "1y", nav)!;

    expect(metrics.start_date).toBe("2024-01-01");
    expect(metrics.end_date).toBe("2024-01-03");
    expect(metrics.max_drawdown_pct).toBe(0);
    expect(metrics.calmar).toBeNull();
  });

  it("净值恒定时收益与波动为 0，风险调整指标为 null", () => {
    const nav = fundNavSeries([
      ["2024-01-01", 1],
      ["2024-01-02", 1],
      ["2024-01-03", 1],
    ]);
    const metrics = calculateFundRiskMetrics("510300", "1y", nav)!;

    expect(metrics.annualized_return_pct).toBe(0);
    expect(metrics.annualized_volatility_pct).toBe(0);
    expect(metrics.sharpe).toBeNull();
    expect(metrics.sortino).toBeNull();
    expect(metrics.calmar).toBeNull();
  });
});

describe("findMaxDrawdownIndices", () => {
  it("把回撤区间映射为净值序列下标", () => {
    const nav = fundNavSeries([
      ["2024-01-01", 1],
      ["2024-01-02", 1.1],
      ["2024-01-03", 0.88],
      ["2024-01-04", 1.1],
      ["2024-01-05", 1.21],
    ]);
    const metrics = calculateFundRiskMetrics("510300", "1y", nav);

    expect(findMaxDrawdownIndices(nav, metrics)).toEqual({ startIndex: 1, endIndex: 2 });
  });

  it("指标或序列为空时返回空下标", () => {
    expect(findMaxDrawdownIndices([], null)).toEqual({ startIndex: null, endIndex: null });
    expect(
      findMaxDrawdownIndices([], calculateFundRiskMetrics("510300", "1y", [])),
    ).toEqual({ startIndex: null, endIndex: null });
  });
});