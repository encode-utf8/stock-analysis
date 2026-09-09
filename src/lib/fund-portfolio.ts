// 基金组合分析：按用户指定权重合成基金组合，并复用本地风险指标计算同口径结果。
import { getFundNav, getFundProfile, type FundNavRange } from "@/lib/fund-data";
import { calculateFundRiskMetrics } from "@/lib/fund-metrics";
import { normalizeFundCode } from "@/lib/fund-market";
import type {
  FundNavPoint,
  FundPortfolioItem,
  FundPortfolioMode,
  FundPortfolioSummary,
} from "@/lib/shared/types";

const VALID_RANGES: FundNavRange[] = ["1m", "3m", "6m", "1y", "3y", "all"];

/** 规范化组合基金代码；非法输入返回 null。 */
export function normalizeFundPortfolioCodes(raw: string | null): string[] | null {
  if (!raw) {
    return null;
  }

  const codes = raw
    .split(/[,，\s]+/)
    .map((code) => normalizeFundCode(code))
    .filter((code): code is string => Boolean(code));
  const uniqueCodes = Array.from(new Set(codes));
  return uniqueCodes.length >= 2 && uniqueCodes.length <= 5 ? uniqueCodes : null;
}

/** 规范化组合区间；非法时回退到 1y。 */
export function normalizeFundPortfolioRange(raw: string | null): FundNavRange {
  return VALID_RANGES.includes(raw as FundNavRange) ? (raw as FundNavRange) : "1y";
}

/** 规范化组合分析模式；未提供时默认按百分比权重。 */
export function normalizeFundPortfolioMode(raw: string | null): FundPortfolioMode {
  return raw === "shares" || raw === "amount" ? "shares" : "weight";
}

/** 规范化组合权重；未提供时等权，否则必须是 2-5 个权重且合计约等于 100。 */
export function normalizeFundPortfolioWeights(
  raw: string | null,
  count: number,
): number[] | null {
  if (!raw) {
    const equalWeight = 100 / count;
    return Array.from({ length: count }, () => equalWeight);
  }

  const values = raw
    .split(/[,，\s]+/)
    .filter(Boolean)
    .map((value) => Number(value));
  if (values.length !== count || values.some((value) => !Number.isFinite(value) || value < 0)) {
    return null;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 100) > 0.01) {
    return null;
  }
  return values;
}

/** 规范化组合持仓份额；份额模式必须提供与基金数量一致且均大于 0 的份额。 */
export function normalizeFundPortfolioShares(
  raw: string | null,
  count: number,
): number[] | null {
  if (!raw) {
    return null;
  }

  const values = raw
    .split(/[,，\s]+/)
    .filter(Boolean)
    .map((value) => Number(value));
  if (
    values.length !== count ||
    values.some((value) => !Number.isFinite(value) || value <= 0)
  ) {
    return null;
  }
  return values;
}

function round(value: number | null, digits = 2): number | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function periodReturn(nav: FundNavPoint[]): number | null {
  if (nav.length < 2) {
    return null;
  }
  const first = nav[0];
  const last = nav.at(-1);
  if (!first || !last || first.cumulative_nav <= 0) {
    return null;
  }
  return round((last.cumulative_nav / first.cumulative_nav - 1) * 100);
}

/** 计算多只基金共有的交易日，按日期升序返回。 */
function commonDatesForSeries(navSeries: FundNavPoint[][]): string[] {
  const dateSets = navSeries.map((nav) => new Set(nav.map((point) => point.nav_date)));
  return Array.from(dateSets[0] ?? [])
    .filter((date) => dateSets.every((set) => set.has(date)))
    .sort((left, right) => left.localeCompare(right));
}

/** 将多只基金按共同交易日合成一条组合净值序列。 */
function buildPortfolioNav(
  navSeries: FundNavPoint[][],
  weights: number[],
): FundNavPoint[] {
  const commonDates = commonDatesForSeries(navSeries);
  if (commonDates.length === 0) {
    return [];
  }

  const navByCode = navSeries.map((nav) => new Map(nav.map((point) => [point.nav_date, point])));
  const points: FundNavPoint[] = [];
  let portfolioValue = 1;

  commonDates.forEach((date, index) => {
    if (index === 0) {
      points.push({
        code: "portfolio",
        nav_date: date,
        unit_nav: 1,
        cumulative_nav: 1,
        daily_change_pct: 0,
        source: "本地组合计算",
        fetched_at: new Date().toISOString(),
      });
      return;
    }

    const previousDate = commonDates[index - 1];
    let portfolioReturn = 0;
    for (let fundIndex = 0; fundIndex < navSeries.length; fundIndex += 1) {
      const previousPoint = navByCode[fundIndex]?.get(previousDate);
      const currentPoint = navByCode[fundIndex]?.get(date);
      if (!previousPoint || !currentPoint || previousPoint.cumulative_nav <= 0) {
        continue;
      }
      const fundReturn = currentPoint.cumulative_nav / previousPoint.cumulative_nav - 1;
      portfolioReturn += (weights[fundIndex] / 100) * fundReturn;
    }

    portfolioValue *= 1 + portfolioReturn;
    points.push({
      code: "portfolio",
      nav_date: date,
      unit_nav: portfolioValue,
      cumulative_nav: portfolioValue,
      daily_change_pct: round(portfolioReturn * 100),
      source: "本地组合计算",
      fetched_at: new Date().toISOString(),
    });
  });

  return points;
}

/** 计算基金组合摘要与单基金指标。 */
export async function getFundPortfolio(
  codes: string[],
  range: FundNavRange,
  options: {
    mode: FundPortfolioMode;
    weights: number[] | null;
    shares: number[] | null;
  },
  now = new Date(),
): Promise<FundPortfolioSummary> {
  const { mode, weights: rawWeights, shares } = options;
  const [profiles, navSeries] = await Promise.all([
    Promise.all(codes.map((code) => getFundProfile(code))),
    Promise.all(codes.map((code) => getFundNav(code, range, "cumulative"))),
  ]);

  const commonDates = commonDatesForSeries(navSeries);
  const firstCommonDate = commonDates[0] ?? null;

  let weights: number[];
  if (mode === "shares" && shares) {
    const initialValues = shares.map((share, index) => {
      const nav = navSeries[index];
      const firstPoint = firstCommonDate
        ? nav.find((point) => point.nav_date === firstCommonDate)
        : null;
      const initialNav = firstPoint?.cumulative_nav ?? null;
      return initialNav !== null && initialNav > 0 ? share * initialNav : 0;
    });
    const totalInitialValue = initialValues.reduce((sum, value) => sum + value, 0);
    weights =
      totalInitialValue > 0
        ? initialValues.map((value) => (value / totalInitialValue) * 100)
        : codes.map(() => 100 / codes.length);
  } else {
    weights = rawWeights ?? codes.map(() => 100 / codes.length);
  }

  const portfolioNav = buildPortfolioNav(navSeries, weights);
  const portfolioMetrics = calculateFundRiskMetrics("portfolio", range, portfolioNav);

  const items: FundPortfolioItem[] = codes.map((code, index) => {
    const nav = navSeries[index];
    const metrics = calculateFundRiskMetrics(code, range, nav);
    const profile = profiles[index];
    const firstPoint = firstCommonDate
      ? nav.find((point) => point.nav_date === firstCommonDate)
      : null;
    const latestPoint = nav.at(-1) ?? null;
    const initialNav = firstPoint ? round(firstPoint.cumulative_nav, 4) : null;
    const latestNav = latestPoint ? round(latestPoint.cumulative_nav, 4) : null;
    const holdingShares = mode === "shares" && shares ? round(shares[index], 4) : null;
    const holdingAmount =
      holdingShares !== null && initialNav !== null && initialNav > 0
        ? round(holdingShares * initialNav)
        : null;
    const latestValue =
      holdingShares !== null && latestNav !== null ? round(holdingShares * latestNav) : null;
    const profitLoss =
      latestValue !== null && holdingAmount !== null ? round(latestValue - holdingAmount) : null;
    const profitLossPct =
      initialNav !== null && latestNav !== null && initialNav > 0
        ? round((latestNav / initialNav - 1) * 100)
        : null;

    return {
      code,
      name: profile.name,
      weight_pct: round(weights[index]) ?? 0,
      holding_shares: holdingShares,
      holding_amount: holdingAmount,
      initial_nav: initialNav,
      latest_nav: latestNav,
      latest_value: latestValue,
      profit_loss: profitLoss,
      profit_loss_pct: profitLossPct,
      period_return_pct: periodReturn(nav),
      annualized_return_pct: metrics?.annualized_return_pct ?? null,
      annualized_volatility_pct: metrics?.annualized_volatility_pct ?? null,
      max_drawdown_pct: metrics?.max_drawdown_pct ?? null,
      sharpe: metrics?.sharpe ?? null,
      calmar: metrics?.calmar ?? null,
    };
  });

  const totalHoldingAmount =
    mode === "shares"
      ? round(items.reduce((sum, item) => sum + (item.holding_amount ?? 0), 0))
      : null;
  const totalLatestValue =
    mode === "shares"
      ? round(items.reduce((sum, item) => sum + (item.latest_value ?? 0), 0))
      : null;
  const totalProfitLoss =
    totalLatestValue !== null && totalHoldingAmount !== null
      ? round(totalLatestValue - totalHoldingAmount)
      : null;

  return {
    mode,
    range,
    generated_at: now.toISOString(),
    total_holding_amount: totalHoldingAmount,
    total_latest_value: totalLatestValue,
    total_profit_loss: totalProfitLoss,
    total_return_pct: periodReturn(portfolioNav),
    annualized_return_pct: portfolioMetrics?.annualized_return_pct ?? null,
    annualized_volatility_pct: portfolioMetrics?.annualized_volatility_pct ?? null,
    max_drawdown_pct: portfolioMetrics?.max_drawdown_pct ?? null,
    current_drawdown_pct: portfolioMetrics?.current_drawdown_pct ?? null,
    sharpe: portfolioMetrics?.sharpe ?? null,
    sortino: portfolioMetrics?.sortino ?? null,
    calmar: portfolioMetrics?.calmar ?? null,
    items,
  };
}
