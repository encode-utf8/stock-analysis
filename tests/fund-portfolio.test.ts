// 基金组合分析回归测试：参数规范化、组合曲线、权重偏离与风险贡献。
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fundNavSeries } from "./helpers/fixtures";

vi.mock("@/lib/fund-data", () => ({
  getFundProfile: vi.fn(),
  getFundNav: vi.fn(),
}));

import {
  getFundPortfolio,
  normalizeFundPortfolioCodes,
  normalizeFundPortfolioMode,
  normalizeFundPortfolioRange,
  normalizeFundPortfolioRangeBounds,
  normalizeFundPortfolioShares,
  normalizeFundPortfolioWeights,
} from "@/lib/fund-portfolio";
import { getFundNav, getFundProfile } from "@/lib/fund-data";

const NOW = new Date("2024-01-05T00:00:00.000Z");

const A_NAV: Array<[string, number]> = [
  ["2024-01-01", 1],
  ["2024-01-02", 1.1],
  ["2024-01-03", 0.99],
];

const B_NAV: Array<[string, number]> = [
  ["2024-01-01", 2],
  ["2024-01-02", 2.2],
  ["2024-01-03", 1.8],
];

/** 按基金代码返回不同净值序列，并给出最小可用的基金档案。 */
function mockNavByCode(navByCode: Record<string, Array<[string, number]>>, source = "akshare"): void {
  vi.mocked(getFundNav).mockImplementation(async (code: string) =>
    fundNavSeries(navByCode[code] ?? [], source),
  );
  vi.mocked(getFundProfile).mockImplementation(async (code: string) => ({
    code,
    name: `基金 ${code}`,
    type: "index",
    trading_mode: "exchange",
    manager: null,
    company: null,
    benchmark: null,
    establish_date: null,
    scale: null,
    risk_level: null,
    source,
    fetched_at: "2024-01-05T00:00:00.000Z",
  }));
}

beforeEach(() => {
  vi.mocked(getFundNav).mockReset();
  vi.mocked(getFundProfile).mockReset();
});

describe("组合参数规范化", () => {
  it("校验组合基金代码数量与去重", () => {
    expect(normalizeFundPortfolioCodes("510300,110022")).toEqual(["510300", "110022"]);
    expect(normalizeFundPortfolioCodes("510300，110022，003376")).toEqual([
      "510300",
      "110022",
      "003376",
    ]);
    expect(normalizeFundPortfolioCodes("510300")).toBeNull();
    expect(normalizeFundPortfolioCodes("510300,510300")).toBeNull();
    expect(normalizeFundPortfolioCodes(null)).toBeNull();
  });

  it("权重为空时等权，非法权重返回 null", () => {
    expect(normalizeFundPortfolioWeights(null, 2)).toEqual([50, 50]);
    expect(normalizeFundPortfolioWeights(null, 4)).toEqual([25, 25, 25, 25]);
    expect(normalizeFundPortfolioWeights("60,40", 2)).toEqual([60, 40]);
    expect(normalizeFundPortfolioWeights("60,30", 2)).toBeNull();
    expect(normalizeFundPortfolioWeights("60", 2)).toBeNull();
  });

  it("份额必须与基金数量一致且大于 0", () => {
    expect(normalizeFundPortfolioShares("1000,500", 2)).toEqual([1000, 500]);
    expect(normalizeFundPortfolioShares("1000,0", 2)).toBeNull();
    expect(normalizeFundPortfolioShares(null, 2)).toBeNull();
  });

  it("目标权重区间需满足 0 <= 下限 <= 上限 <= 100", () => {
    expect(normalizeFundPortfolioRangeBounds("45,25", "65,45", 2)).toEqual({
      minWeights: [45, 25],
      maxWeights: [65, 45],
    });
    expect(normalizeFundPortfolioRangeBounds("70,10", "60,20", 2)).toBeNull();
    expect(normalizeFundPortfolioRangeBounds("45,25", "65,45,10", 2)).toBeNull();
    expect(normalizeFundPortfolioRangeBounds(null, null, 2)).toBeNull();
  });

  it("模式与区间非法时回退默认值", () => {
    expect(normalizeFundPortfolioMode("shares")).toBe("shares");
    expect(normalizeFundPortfolioMode("amount")).toBe("shares");
    expect(normalizeFundPortfolioMode("range")).toBe("range");
    expect(normalizeFundPortfolioMode("unknown")).toBe("weight");
    expect(normalizeFundPortfolioMode(null)).toBe("weight");
    expect(normalizeFundPortfolioRange("6m")).toBe("6m");
    expect(normalizeFundPortfolioRange("bad")).toBe("1y");
  });
});

describe("getFundPortfolio", () => {
  it("按权重合成组合曲线并计算权重偏离与风险贡献", async () => {
    mockNavByCode({ "510300": A_NAV, "110022": B_NAV });

    const summary = await getFundPortfolio(
      ["510300", "110022"],
      "1y",
      { mode: "weight", weights: [60, 40], shares: null, ranges: null },
      NOW,
    );

    expect(summary.mode).toBe("weight");
    expect(summary.portfolio_curve).toHaveLength(3);
    expect(summary.portfolio_curve[0]).toEqual({
      date: "2024-01-01",
      cumulative_nav: 1,
      return_pct: 0,
      drawdown_pct: 0,
    });
    expect(summary.portfolio_curve[1].return_pct).toBe(10);
    expect(summary.portfolio_curve[2].return_pct).toBe(-4.6);
    expect(summary.portfolio_curve[2].drawdown_pct).toBe(-13.27);
    expect(summary.total_return_pct).toBe(-4.6);
    expect(summary.items[0].weight_pct).toBe(60);
    expect(summary.items[1].weight_pct).toBe(40);
    expect(summary.items[0].rebalance_status).toBe("above");
    expect(summary.items[0].rebalance_drift_pct).toBe(2.26);
    expect(summary.items[1].rebalance_status).toBe("below");

    const contributions = summary.items.map((item) => item.risk_contribution_pct ?? 0);
    expect(contributions.every((value) => value > 0)).toBe(true);
    expect(contributions.reduce((sum, value) => sum + value, 0)).toBeCloseTo(100, 1);
  });

  it("按持仓份额推导权重并汇总持仓市值", async () => {
    mockNavByCode({ "510300": A_NAV, "110022": B_NAV });

    const summary = await getFundPortfolio(
      ["510300", "110022"],
      "1y",
      { mode: "shares", weights: null, shares: [1000, 500], ranges: null },
      NOW,
    );

    expect(summary.mode).toBe("shares");
    expect(summary.total_holding_amount).toBe(2000);
    expect(summary.total_latest_value).toBe(1890);
    expect(summary.total_profit_loss).toBe(-110);
    expect(summary.items[0].weight_pct).toBe(50);
    expect(summary.items[0].holding_shares).toBe(1000);
    expect(summary.items[0].holding_amount).toBe(1000);
    expect(summary.items[0].latest_value).toBe(990);
    expect(summary.items[0].profit_loss).toBe(-10);
    expect(summary.items[0].profit_loss_pct).toBe(-1);
    expect(summary.items[1].holding_amount).toBe(1000);
    expect(summary.items[1].latest_value).toBe(900);
    expect(summary.items[1].profit_loss).toBe(-100);
  });

  it("目标权重区间取中点归一化并判定再平衡状态", async () => {
    mockNavByCode({ "510300": A_NAV, "110022": B_NAV });

    const summary = await getFundPortfolio(
      ["510300", "110022"],
      "1y",
      { mode: "range", weights: null, shares: null, ranges: { minWeights: [45, 25], maxWeights: [65, 45] } },
      NOW,
    );

    expect(summary.mode).toBe("range");
    expect(summary.items[0].target_weight_pct).toBe(61.11);
    expect(summary.items[1].target_weight_pct).toBe(38.89);
    expect(summary.items[0].target_weight_min_pct).toBe(45);
    expect(summary.items[0].target_weight_max_pct).toBe(65);
    expect(summary.items[0].rebalance_status).toBe("within");
    expect(summary.items[0].rebalance_drift_pct).toBe(0);
  });

  it("没有共同交易日时返回空曲线与空指标", async () => {
    mockNavByCode({
      "510300": [
        ["2024-01-01", 1],
        ["2024-01-02", 1.1],
      ],
      "110022": [
        ["2024-02-01", 2],
        ["2024-02-02", 2.2],
      ],
    });

    const summary = await getFundPortfolio(
      ["510300", "110022"],
      "1y",
      { mode: "weight", weights: [50, 50], shares: null, ranges: null },
      NOW,
    );

    expect(summary.portfolio_curve).toEqual([]);
    expect(summary.total_return_pct).toBeNull();
    expect(summary.max_drawdown_pct).toBeNull();
    expect(summary.items).toHaveLength(2);
  });
});