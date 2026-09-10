// 基金定投回测回归测试：参数规范化、份额与市值计算、扣款日对比与降级处理。
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fundNavSeries } from "./helpers/fixtures";

vi.mock("@/lib/fund-data", () => ({
  getFundProfile: vi.fn(),
  getFundNav: vi.fn(),
}));

import {
  getFundDcaBacktest,
  getFundDcaPortfolioBacktest,
  normalizeFundDcaAmount,
  normalizeFundDcaAmounts,
  normalizeFundDcaCode,
  normalizeFundDcaCodes,
  normalizeFundDcaFrequency,
  normalizeFundDcaRange,
} from "@/lib/fund-dca";
import { getFundNav, getFundProfile } from "@/lib/fund-data";

const NOW = new Date("2024-08-02T00:00:00.000Z");

/** 月度净值样本：前段上涨、末段下跌，用于验证定投份额、回撤与修复状态。 */
const MONTHLY_NAV: Array<[string, number]> = [
  ["2024-01-01", 1],
  ["2024-02-01", 0.8],
  ["2024-03-01", 0.5],
  ["2024-04-01", 0.8],
  ["2024-05-01", 1],
  ["2024-06-01", 1.25],
  ["2024-07-01", 1.25],
  ["2024-08-01", 0.6],
];

/** 按基金代码返回不同净值序列；未提供的代码返回空序列。 */
function mockNavByCode(
  navByCode: Record<string, Array<[string, number]>>,
  source = "akshare",
): void {
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
    fetched_at: "2024-08-02T00:00:00.000Z",
  }));
}

beforeEach(() => {
  vi.mocked(getFundNav).mockReset();
  vi.mocked(getFundProfile).mockReset();
});

describe("定投参数规范化", () => {
  it("校验基金代码", () => {
    expect(normalizeFundDcaCode(" 510300 ")).toBe("510300");
    expect(normalizeFundDcaCode("51030")).toBeNull();
    expect(normalizeFundDcaCode(null)).toBeNull();
  });

  it("区间与频率非法时回退默认值", () => {
    expect(normalizeFundDcaRange("3m")).toBe("3m");
    expect(normalizeFundDcaRange("2y")).toBe("1y");
    expect(normalizeFundDcaFrequency("weekly")).toBe("weekly");
    expect(normalizeFundDcaFrequency("hourly")).toBe("monthly");
    expect(normalizeFundDcaFrequency(null)).toBe("monthly");
  });

  it("校验每期金额", () => {
    expect(normalizeFundDcaAmount("1000.456")).toBe(1000.46);
    expect(normalizeFundDcaAmount("0")).toBeNull();
    expect(normalizeFundDcaAmount("-100")).toBeNull();
    expect(normalizeFundDcaAmount("abc")).toBeNull();
  });

  it("校验组合代码与对应金额数量", () => {
    expect(normalizeFundDcaCodes("510300,110022")).toEqual(["510300", "110022"]);
    expect(normalizeFundDcaCodes("510300，110022")).toEqual(["510300", "110022"]);
    expect(normalizeFundDcaCodes("510300")).toBeNull();
    expect(normalizeFundDcaCodes("510300,510300")).toBeNull();
    expect(normalizeFundDcaCodes("510300,110022,003376,161725,000008,000001")).toBeNull();
    expect(normalizeFundDcaAmounts("1000,2000", 2)).toEqual([1000, 2000]);
    expect(normalizeFundDcaAmounts("1000", 2)).toBeNull();
  });
});

describe("getFundDcaBacktest", () => {
  it("按每月定投累计份额、市值与一次性买入对比", async () => {
    mockNavByCode({ "510300": MONTHLY_NAV });

    const snapshot = await getFundDcaBacktest("510300", "1y", "monthly", 1000, NOW);

    expect(getFundNav).toHaveBeenCalledWith("510300", "1y", "unit");
    expect(snapshot.available).toBe(true);
    expect(snapshot.reason).toBeNull();
    expect(snapshot.price_basis).toBe("unit");
    expect(snapshot.source).toBe("akshare");
    expect(snapshot.total_periods).toBe(8);
    expect(snapshot.total_invested).toBe(8000);
    expect(snapshot.total_shares).toBe(9766.6667);
    expect(snapshot.final_nav).toBe(0.6);
    expect(snapshot.final_value).toBe(5860);
    expect(snapshot.profit_loss).toBe(-2140);
    expect(snapshot.profit_loss_pct).toBe(-26.75);
    expect(snapshot.max_drawdown_pct).toBe(-42.12);
    expect(snapshot.current_drawdown_pct).toBe(-42.12);
    expect(snapshot.lump_sum_return_pct).toBe(-40);
    expect(snapshot.annualized_return_pct).toBe(-68.2);
    expect(snapshot.start_date).toBe("2024-01-01");
    expect(snapshot.end_date).toBe("2024-08-01");
    expect(snapshot.max_drawdown_start_date).toBe("2024-06-01");
    expect(snapshot.max_drawdown_end_date).toBe("2024-08-01");
    expect(snapshot.recovery_start_date).toBe("2024-08-01");
    expect(snapshot.recovery_end_date).toBeNull();
    expect(snapshot.recovery_complete).toBe(false);
    expect(snapshot.recovery_days).toBeNull();
    expect(snapshot.contributions).toHaveLength(8);
    expect(snapshot.equity_curve).toHaveLength(8);
    expect(snapshot.lump_sum_curve).toHaveLength(8);
    expect(snapshot.contributions[0]).toEqual({
      date: "2024-01-01",
      nav: 1,
      amount: 1000,
      shares: 1000,
      cumulative_shares: 1000,
      cumulative_invested: 1000,
      market_value: 1000,
    });
    expect(snapshot.contributions[2]).toEqual({
      date: "2024-03-01",
      nav: 0.5,
      amount: 1000,
      shares: 2000,
      cumulative_shares: 4250,
      cumulative_invested: 3000,
      market_value: 2125,
    });
    expect(snapshot.equity_curve.at(-1)).toEqual({
      date: "2024-08-01",
      market_value: 5860,
      invested_amount: 8000,
      return_pct: -26.75,
    });
  });

  it("每月定投返回不同扣款日的收益对比", async () => {
    mockNavByCode({ "510300": MONTHLY_NAV });

    const snapshot = await getFundDcaBacktest("510300", "1y", "monthly", 1000, NOW);

    expect(snapshot.payday_comparison.map((item) => item.day)).toEqual([1, 5, 10, 15, 20, 25, 28]);
    expect(snapshot.payday_comparison[0].day).toBe(1);
    expect(snapshot.payday_comparison[0].total_return_pct).toBe(-26.75);
    expect(snapshot.payday_comparison[0].annualized_return_pct).toBe(-68.2);
    expect(snapshot.payday_comparison[1].annualized_return_pct).not.toBeNull();
  });

  it("每日定投不返回逐期明细，也不计算扣款日对比", async () => {
    mockNavByCode({ "510300": MONTHLY_NAV });

    const snapshot = await getFundDcaBacktest("510300", "1y", "daily", 1000, NOW);

    expect(snapshot.available).toBe(true);
    expect(snapshot.frequency).toBe("daily");
    expect(snapshot.total_periods).toBe(8);
    expect(snapshot.contributions).toEqual([]);
    expect(snapshot.payday_comparison).toEqual([]);
  });

  it("盈利区间年化收益为正，且与区间收益同号", async () => {
    mockNavByCode({
      "510300": [
        ["2024-01-01", 1],
        ["2024-02-01", 1.05],
        ["2024-03-01", 1.1],
        ["2024-04-01", 1.15],
        ["2024-05-01", 1.2],
        ["2024-06-01", 1.25],
        ["2024-07-01", 1.3],
        ["2024-08-01", 1.35],
      ],
    });

    const snapshot = await getFundDcaBacktest("510300", "1y", "monthly", 1000, NOW);

    expect(snapshot.available).toBe(true);
    expect(snapshot.profit_loss_pct).toBeGreaterThan(0);
    expect(snapshot.annualized_return_pct).not.toBeNull();
    expect(snapshot.annualized_return_pct as number).toBeGreaterThan(0);
    expect(snapshot.payday_comparison.every((item) => item.annualized_return_pct !== null)).toBe(true);
  });

  it("净值为确定性降级时不生成回测结果", async () => {
    mockNavByCode({ "510300": MONTHLY_NAV }, "deterministic-fallback");

    const snapshot = await getFundDcaBacktest("510300", "1y", "monthly", 1000, NOW);

    expect(snapshot.available).toBe(false);
    expect(snapshot.reason).toContain("净值数据暂不可用");
    expect(snapshot.total_invested).toBeNull();
    expect(snapshot.equity_curve).toEqual([]);
    expect(snapshot.contributions).toEqual([]);
  });

  it("净值样本不足时不生成回测结果", async () => {
    mockNavByCode({ "510300": [["2024-01-01", 1]] });

    const snapshot = await getFundDcaBacktest("510300", "1y", "monthly", 1000, NOW);

    expect(snapshot.available).toBe(false);
    expect(snapshot.reason).toContain("样本不足");
    expect(snapshot.equity_curve).toEqual([]);
  });
});

describe("getFundDcaPortfolioBacktest", () => {
  it("聚合多基金组合的投入与市值曲线", async () => {
    mockNavByCode({ "510300": MONTHLY_NAV, "110022": MONTHLY_NAV });

    const snapshot = await getFundDcaPortfolioBacktest(
      ["510300", "110022"],
      "1y",
      "monthly",
      [1000, 1000],
      NOW,
    );

    expect(snapshot.available).toBe(true);
    expect(snapshot.codes).toEqual(["510300", "110022"]);
    expect(snapshot.amount_per_period).toBe(2000);
    expect(snapshot.total_invested).toBe(16000);
    expect(snapshot.total_value).toBe(11720);
    expect(snapshot.profit_loss).toBe(-4280);
    expect(snapshot.profit_loss_pct).toBe(-26.75);
    expect(snapshot.max_drawdown_pct).toBe(-42.12);
    expect(snapshot.annualized_return_pct).toBe(-68.2);
    expect(snapshot.equity_curve).toHaveLength(8);
  });

  it("部分基金净值降级时组合不可用", async () => {
    mockNavByCode({ "510300": MONTHLY_NAV, "110022": [] }, "deterministic-fallback");

    const snapshot = await getFundDcaPortfolioBacktest(
      ["510300", "110022"],
      "1y",
      "monthly",
      [1000, 1000],
      NOW,
    );

    expect(snapshot.available).toBe(false);
    expect(snapshot.reason).toContain("部分基金净值数据不可用");
    expect(snapshot.equity_curve).toEqual([]);
  });
});