// 基金定投回测：按用户指定频率、金额与区间，基于真实单位净值计算定投结果。
// 净值为确定性回退或数据不足时明确不可用，不生成演示回测结果。
import { getFundNav, getFundProfile, type FundNavRange } from "@/lib/fund-data";
import { normalizeFundCode } from "@/lib/fund-market";
import type {
  FundDcaContribution,
  FundDcaEquityPoint,
  FundDcaFrequency,
  FundDcaPaydayComparison,
  FundDcaPortfolioSnapshot,
  FundDcaSnapshot,
  FundNavPoint,
} from "@/lib/shared/types";

const VALID_RANGES: FundNavRange[] = ["1m", "3m", "6m", "1y", "3y", "all"];
const VALID_FREQUENCIES: FundDcaFrequency[] = ["daily", "weekly", "biweekly", "monthly"];
const MAX_EQUITY_POINTS = 400;
const RANGE_DAYS: Record<Exclude<FundNavRange, "all">, number> = {
  "1m": 30,
  "3m": 90,
  "6m": 180,
  "1y": 365,
  "3y": 1095,
};

/** 规范化定投基金代码；非法输入返回 null。 */
export function normalizeFundDcaCode(raw: string | null): string | null {
  return raw ? normalizeFundCode(raw) : null;
}

/** 规范化定投区间；非法时回退到 1y。 */
export function normalizeFundDcaRange(raw: string | null): FundNavRange {
  return VALID_RANGES.includes(raw as FundNavRange) ? (raw as FundNavRange) : "1y";
}

/** 规范化定投频率；非法时回退到每月定投。 */
export function normalizeFundDcaFrequency(raw: string | null): FundDcaFrequency {
  return VALID_FREQUENCIES.includes(raw as FundDcaFrequency)
    ? (raw as FundDcaFrequency)
    : "monthly";
}

/** 规范化每期定投金额；非法时返回 null。 */
export function normalizeFundDcaAmount(raw: string | null): number | null {
  const amount = Number(raw);
  return Number.isFinite(amount) && amount > 0 && amount <= 10_000_000
    ? Math.round(amount * 100) / 100
    : null;
}

/** ??????????????? 2-5 ???????? */
export function normalizeFundDcaCodes(raw: string | null): string[] | null {
  if (!raw) {
    return null;
  }
  const codes = Array.from(
    new Set(
      raw
        .split(/[,?\s]+/)
        .map((code) => normalizeFundCode(code))
        .filter((code): code is string => Boolean(code)),
    ),
  );
  return codes.length >= 2 && codes.length <= 5 ? codes : null;
}

/** ???????????????????????????? 0? */
export function normalizeFundDcaAmounts(raw: string | null, count: number): number[] | null {
  if (!raw) {
    return null;
  }
  const values = raw
    .split(/[,?\s]+/)
    .filter(Boolean)
    .map((value) => Number(value));
  if (
    values.length !== count ||
    values.some((value) => !Number.isFinite(value) || value <= 0 || value > 10_000_000)
  ) {
    return null;
  }
  return values.map((value) => Math.round(value * 100) / 100);
}

function round(value: number | null, digits = 2): number | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 将收益率曲线均匀抽样到指定点数，避免成立以来数据量过大拖慢图表。 */
function downsampleEquityCurve<T>(items: T[], maxPoints: number): T[] {
  if (items.length <= maxPoints) {
    return items;
  }
  const step = (items.length - 1) / (maxPoints - 1);
  const sampled: T[] = [];
  for (let index = 0; index < maxPoints; index += 1) {
    sampled.push(items[Math.round(index * step)]);
  }
  sampled[maxPoints - 1] = items[items.length - 1];
  return sampled;
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addPeriod(value: Date, frequency: FundDcaFrequency): Date {
  const next = new Date(value);
  if (frequency === "daily") {
    next.setDate(next.getDate() + 1);
    return next;
  }
  if (frequency === "weekly") {
    next.setDate(next.getDate() + 7);
    return next;
  }
  if (frequency === "biweekly") {
    next.setDate(next.getDate() + 14);
    return next;
  }
  next.setMonth(next.getMonth() + 1);
  return next;
}

/** 按频率生成定投日；每个目标日取最近一个可交易净值日。 */
function buildContributionDates(nav: FundNavPoint[], frequency: FundDcaFrequency): string[] {
  if (nav.length === 0) {
    return [];
  }

  const firstDate = parseDate(nav[0].nav_date);
  const lastDate = parseDate(nav.at(-1)!.nav_date);
  const selected = new Set<string>();
  let scheduledDate = new Date(firstDate);

  while (scheduledDate.getTime() <= lastDate.getTime()) {
    const target = formatDate(scheduledDate);
    const point = nav.find((item) => item.nav_date >= target);
    if (!point) {
      break;
    }
    selected.add(point.nav_date);
    const nextScheduledDate = addPeriod(scheduledDate, frequency);
    if (nextScheduledDate.getTime() <= scheduledDate.getTime()) {
      break;
    }
    scheduledDate = nextScheduledDate;
  }

  return Array.from(selected).sort((left, right) => left.localeCompare(right));
}

/** 用牛顿法近似计算定投现金流内部收益率。 */
function calculateDcaXirr(
  contributions: FundDcaContribution[],
  finalDate: string,
  finalValue: number,
): number | null {
  if (contributions.length === 0 || finalValue <= 0) {
    return null;
  }

  const startDate = contributions[0].date;
  const startMs = parseDate(startDate).getTime();
  const finalMs = parseDate(finalDate).getTime();
  const yearsFromStart = (date: string) => (parseDate(date).getTime() - startMs) / (365 * 24 * 60 * 60_000);
  const finalYears = (finalMs - startMs) / (365 * 24 * 60 * 60_000);
  if (finalYears <= 0) {
    return null;
  }

  let rate = 0.1;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    let value = 0;
    let derivative = 0;
    for (const contribution of contributions) {
      const years = yearsFromStart(contribution.date);
      const discount = (1 + rate) ** years;
      value += -contribution.amount / discount;
      derivative += (years * contribution.amount) / ((1 + rate) ** (years + 1));
    }
    value += finalValue / (1 + rate) ** finalYears;
    derivative -= (finalYears * finalValue) / ((1 + rate) ** (finalYears + 1));

    if (Math.abs(derivative) < 1e-10) {
      break;
    }
    const nextRate = rate - value / derivative;
    if (!Number.isFinite(nextRate) || Math.abs(nextRate - rate) < 1e-9) {
      rate = nextRate;
      break;
    }
    rate = nextRate;
  }

  return Number.isFinite(rate) && rate > -0.99 ? round(rate * 100, 2) : null;
}

/** ?????????????????????? */
function calculateDcaDrawdownRecovery(equityCurve: FundDcaEquityPoint[]) {
  if (equityCurve.length < 2) {
    return {
      maxDrawdownStart: null,
      maxDrawdownEnd: null,
      recoveryStart: null,
      recoveryEnd: null,
      recoveryComplete: false,
      recoveryDays: null,
    };
  }

  let peak = equityCurve[0].market_value;
  let peakDate = equityCurve[0].date;
  let maxDrawdown = 0;
  let maxDrawdownStart: string | null = null;
  let maxDrawdownEnd: string | null = null;
  let peakAtStart = 0;

  for (let index = 1; index < equityCurve.length; index += 1) {
    const point = equityCurve[index];
    if (point.market_value >= peak) {
      peak = point.market_value;
      peakDate = point.date;
      continue;
    }
    const drawdown = point.market_value / peak - 1;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownStart = peakDate;
      maxDrawdownEnd = point.date;
      peakAtStart = peak;
    }
  }

  if (!maxDrawdownStart || !maxDrawdownEnd || peakAtStart <= 0) {
    return {
      maxDrawdownStart,
      maxDrawdownEnd,
      recoveryStart: maxDrawdownEnd,
      recoveryEnd: null,
      recoveryComplete: false,
      recoveryDays: null,
    };
  }

  const recoveryStart = maxDrawdownEnd;
  let recoveryEnd: string | null = null;
  let recoveryComplete = false;
  const recoveryStartIndex = equityCurve.findIndex((point) => point.date === recoveryStart);
  if (recoveryStartIndex >= 0) {
    for (let index = recoveryStartIndex + 1; index < equityCurve.length; index += 1) {
      if (equityCurve[index].market_value >= peakAtStart) {
        recoveryEnd = equityCurve[index].date;
        recoveryComplete = true;
        break;
      }
    }
  }

  const recoveryDays =
    recoveryEnd === null
      ? null
      : Math.max(
          1,
          (parseDate(recoveryEnd).getTime() - parseDate(recoveryStart).getTime()) / 86_400_000,
        );

  return {
    maxDrawdownStart,
    maxDrawdownEnd,
    recoveryStart,
    recoveryEnd,
    recoveryComplete,
    recoveryDays,
  };
}

/** ????????????????????? */
function calculatePaydayComparison(
  nav: FundNavPoint[],
  frequency: FundDcaFrequency,
  amountPerPeriod: number,
): FundDcaPaydayComparison[] {
  if (frequency !== "monthly" || nav.length < 2) {
    return [];
  }

  const firstDate = parseDate(nav[0].nav_date);
  const lastDate = parseDate(nav.at(-1)!.nav_date);
  const candidateDays = [1, 5, 10, 15, 20, 25, 28];

  return candidateDays.map((day) => {
    const scheduledDates = new Set<string>();
    const cursor = new Date(firstDate.getFullYear(), firstDate.getMonth(), day);
    while (cursor.getTime() <= lastDate.getTime()) {
      const point = nav.find((item) => item.nav_date >= formatDate(cursor));
      if (point) {
        scheduledDates.add(point.nav_date);
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }

    const contributionDates = Array.from(scheduledDates).sort((left, right) => left.localeCompare(right));
    if (contributionDates.length === 0) {
      return { day, total_return_pct: null, annualized_return_pct: null };
    }

    const contributionDateSet = new Set(contributionDates);
    const contributions: FundDcaContribution[] = [];
    let cumulativeShares = 0;
    let cumulativeInvested = 0;
    for (const point of nav) {
      if (contributionDateSet.has(point.nav_date)) {
        const shares = amountPerPeriod / point.unit_nav;
        cumulativeShares += shares;
        cumulativeInvested += amountPerPeriod;
        contributions.push({
          date: point.nav_date,
          nav: round(point.unit_nav, 4) ?? point.unit_nav,
          amount: amountPerPeriod,
          shares: round(shares, 6) ?? shares,
          cumulative_shares: round(cumulativeShares, 6) ?? cumulativeShares,
          cumulative_invested: round(cumulativeInvested) ?? cumulativeInvested,
          market_value: round(cumulativeShares * point.unit_nav) ?? cumulativeShares * point.unit_nav,
        });
      }
    }

    const finalPoint = nav.at(-1)!;
    const finalValue = cumulativeShares * finalPoint.unit_nav;
    const totalReturnPct =
      cumulativeInvested > 0 ? round((finalValue / cumulativeInvested - 1) * 100) : null;
    const annualized = calculateDcaXirr(contributions, finalPoint.nav_date, finalValue);
    return { day, total_return_pct: totalReturnPct, annualized_return_pct: annualized };
  });
}

function unavailableSnapshot(
  code: string,
  name: string,
  range: FundNavRange,
  frequency: FundDcaFrequency,
  amountPerPeriod: number,
  source: string,
  reason: string,
  now = new Date(),
): FundDcaSnapshot {
  return {
    code,
    name,
    range,
    frequency,
    amount_per_period: amountPerPeriod,
    price_basis: "unit",
    available: false,
    reason,
    total_periods: 0,
    total_invested: null,
    total_shares: null,
    final_nav: null,
    final_value: null,
    profit_loss: null,
    profit_loss_pct: null,
    annualized_return_pct: null,
    max_drawdown_pct: null,
    current_drawdown_pct: null,
    lump_sum_return_pct: null,
    lump_sum_curve: [],
    start_date: null,
    end_date: null,
    max_drawdown_start_date: null,
    max_drawdown_end_date: null,
    recovery_start_date: null,
    recovery_end_date: null,
    recovery_complete: false,
    recovery_days: null,
    payday_comparison: [],
    contributions: [],
    equity_curve: [],
    source,
    generated_at: now.toISOString(),
  };
}

/** 计算基金定投回测结果。 */
export async function getFundDcaBacktest(
  code: string,
  range: FundNavRange,
  frequency: FundDcaFrequency,
  amountPerPeriod: number,
  now = new Date(),
): Promise<FundDcaSnapshot> {
  const [profile, rawNav] = await Promise.all([
    getFundProfile(code),
    getDcaNav(code, range),
  ]);
  const source = rawNav[0]?.source ?? profile.source;
  const reasonBase = `${code} 的净值数据暂不可用`;

  if (rawNav.length === 0 || rawNav.some((item) => item.source === "deterministic-fallback")) {
    return unavailableSnapshot(
      code,
      profile.name,
      range,
      frequency,
      amountPerPeriod,
      source,
      `${reasonBase}，因此不展示定投回测。`,
      now,
    );
  }

  const nav = rawNav
    .filter((item) => item.unit_nav > 0)
    .sort((left, right) => left.nav_date.localeCompare(right.nav_date));
  if (nav.length < 2) {
    return unavailableSnapshot(
      code,
      profile.name,
      range,
      frequency,
      amountPerPeriod,
      source,
      `${reasonBase}，样本不足，因此不展示定投回测。`,
      now,
    );
  }

  const contributionDates = buildContributionDates(nav, frequency);
  if (contributionDates.length === 0) {
    return unavailableSnapshot(
      code,
      profile.name,
      range,
      frequency,
      amountPerPeriod,
      source,
      "当前区间内没有可执行的定投日期，请更换区间后重试。",
      now,
    );
  }

  const contributionDateSet = new Set(contributionDates);
  const contributions: FundDcaContribution[] = [];
  let cumulativeShares = 0;
  let cumulativeInvested = 0;

  for (const point of nav) {
    if (contributionDateSet.has(point.nav_date)) {
      const shares = amountPerPeriod / point.unit_nav;
      cumulativeShares += shares;
      cumulativeInvested += amountPerPeriod;
      contributions.push({
        date: point.nav_date,
        nav: round(point.unit_nav, 4) ?? point.unit_nav,
        amount: amountPerPeriod,
        shares: round(shares, 6) ?? shares,
        cumulative_shares: round(cumulativeShares, 6) ?? cumulativeShares,
        cumulative_invested: round(cumulativeInvested) ?? cumulativeInvested,
        market_value: round(cumulativeShares * point.unit_nav) ?? cumulativeShares * point.unit_nav,
      });
    }
  }

  const contributionByDate = new Map(contributions.map((item) => [item.date, item]));
  const equityCurve: FundDcaEquityPoint[] = [];
  let peakValue = 0;
  let maxDrawdown = 0;
  let curveShares = 0;
  let curveInvested = 0;
  for (const point of nav) {
    const contribution = contributionByDate.get(point.nav_date);
    if (contribution) {
      curveShares = contribution.cumulative_shares;
      curveInvested = contribution.cumulative_invested;
    }
    const marketValue = curveShares * point.unit_nav;
    equityCurve.push({
      date: point.nav_date,
      market_value: round(marketValue) ?? marketValue,
      invested_amount: round(curveInvested) ?? curveInvested,
      return_pct: curveInvested > 0 ? round((marketValue / curveInvested - 1) * 100, 2) ?? 0 : 0,
    });
    peakValue = Math.max(peakValue, marketValue);
    if (peakValue > 0) {
      maxDrawdown = Math.min(maxDrawdown, (marketValue / peakValue - 1) * 100);
    }
  }

  const finalPoint = nav.at(-1)!;
  const totalShares = contributions.at(-1)?.cumulative_shares ?? 0;
  const totalInvested = contributions.at(-1)?.cumulative_invested ?? 0;
  const finalValue = totalShares * finalPoint.unit_nav;
  const profitLoss = finalValue - totalInvested;
  const profitLossPct = totalInvested > 0 ? (finalValue / totalInvested - 1) * 100 : null;
  const annualizedReturn = calculateDcaXirr(contributions, finalPoint.nav_date, finalValue);
  const currentDrawdown = peakValue > 0 ? (finalValue / peakValue - 1) * 100 : null;

  const firstContributionDate = contributions[0]?.date ?? nav[0].nav_date;
  const firstContributionPoint =
    nav.find((point) => point.nav_date === firstContributionDate) ??
    nav.find((point) => point.nav_date >= firstContributionDate);
  let lumpSumReturnPct: number | null = null;
  let lumpSumCurve: FundDcaEquityPoint[] = [];
  if (firstContributionPoint && firstContributionPoint.unit_nav > 0 && totalInvested > 0) {
    const lumpShares = totalInvested / firstContributionPoint.unit_nav;
    const lumpPoints: FundDcaEquityPoint[] = [];
    let started = false;
    for (const point of nav) {
      if (!started && point.nav_date < firstContributionDate) {
        continue;
      }
      started = true;
      const marketValue = lumpShares * point.unit_nav;
      lumpPoints.push({
        date: point.nav_date,
        market_value: round(marketValue) ?? marketValue,
        invested_amount: totalInvested,
        return_pct: round((marketValue / totalInvested - 1) * 100, 2) ?? 0,
      });
    }

    lumpSumCurve = downsampleEquityCurve(lumpPoints, MAX_EQUITY_POINTS);
    const finalLumpValue = lumpShares * finalPoint.unit_nav;
    lumpSumReturnPct = round((finalLumpValue / totalInvested - 1) * 100);
  }

  const drawdownRecovery = calculateDcaDrawdownRecovery(equityCurve);
  const paydayComparison = calculatePaydayComparison(nav, frequency, amountPerPeriod);

  return {
    code,
    name: profile.name,
    range,
    frequency,
    amount_per_period: amountPerPeriod,
    price_basis: "unit",
    available: true,
    reason: null,
    total_periods: contributions.length,
    total_invested: round(totalInvested),
    total_shares: round(totalShares, 4),
    final_nav: round(finalPoint.unit_nav, 4),
    final_value: round(finalValue),
    profit_loss: round(profitLoss),
    profit_loss_pct: round(profitLossPct),
    annualized_return_pct: annualizedReturn,
    max_drawdown_pct: round(maxDrawdown),
    current_drawdown_pct: round(currentDrawdown),
    lump_sum_return_pct: lumpSumReturnPct,
    lump_sum_curve: lumpSumCurve,
    start_date: nav[0].nav_date,
    end_date: finalPoint.nav_date,
    max_drawdown_start_date: drawdownRecovery.maxDrawdownStart,
    max_drawdown_end_date: drawdownRecovery.maxDrawdownEnd,
    recovery_start_date: drawdownRecovery.recoveryStart,
    recovery_end_date: drawdownRecovery.recoveryEnd,
    recovery_complete: drawdownRecovery.recoveryComplete,
    recovery_days: round(drawdownRecovery.recoveryDays, 0),
    payday_comparison: paydayComparison,
    contributions: frequency === "daily" ? [] : contributions,
    equity_curve: downsampleEquityCurve(equityCurve, MAX_EQUITY_POINTS),
    source,
    generated_at: now.toISOString(),
  };
}

/** 获取定投所需净值；长期区间避免命中旧缓存，必要时强制刷新。 */
async function getDcaNav(code: string, range: FundNavRange): Promise<FundNavPoint[]> {
  const nav = await getFundNav(code, range, "unit");
  if (range === "all") {
    return getFundNav(code, range, "unit", true);
  }

  const expectedStart = new Date();
  expectedStart.setDate(expectedStart.getDate() - RANGE_DAYS[range]);
  const expectedStartText = expectedStart.toISOString().slice(0, 10);
  const firstDate = nav[0]?.nav_date;
  if (firstDate && firstDate > expectedStartText) {
    return getFundNav(code, range, "unit", true);
  }
  return nav;
}

/** ??????????????????????? */
function buildSingleFundDcaCurve(
  nav: FundNavPoint[],
  frequency: FundDcaFrequency,
  amountPerPeriod: number,
) {
  const contributionDates = buildContributionDates(nav, frequency);
  const contributionDateSet = new Set(contributionDates);
  const contributions: FundDcaContribution[] = [];
  let cumulativeShares = 0;
  let cumulativeInvested = 0;

  for (const point of nav) {
    if (contributionDateSet.has(point.nav_date)) {
      const shares = amountPerPeriod / point.unit_nav;
      cumulativeShares += shares;
      cumulativeInvested += amountPerPeriod;
      contributions.push({
        date: point.nav_date,
        nav: round(point.unit_nav, 4) ?? point.unit_nav,
        amount: amountPerPeriod,
        shares: round(shares, 6) ?? shares,
        cumulative_shares: round(cumulativeShares, 6) ?? cumulativeShares,
        cumulative_invested: round(cumulativeInvested) ?? cumulativeInvested,
        market_value: round(cumulativeShares * point.unit_nav) ?? cumulativeShares * point.unit_nav,
      });
    }
  }

  const contributionByDate = new Map(contributions.map((item) => [item.date, item]));
  const curve: FundDcaEquityPoint[] = [];
  let peakValue = 0;
  let maxDrawdown = 0;
  let curveShares = 0;
  let curveInvested = 0;
  for (const point of nav) {
    const contribution = contributionByDate.get(point.nav_date);
    if (contribution) {
      curveShares = contribution.cumulative_shares;
      curveInvested = contribution.cumulative_invested;
    }
    const marketValue = curveShares * point.unit_nav;
    curve.push({
      date: point.nav_date,
      market_value: round(marketValue) ?? marketValue,
      invested_amount: round(curveInvested) ?? curveInvested,
      return_pct: curveInvested > 0 ? round((marketValue / curveInvested - 1) * 100, 2) ?? 0 : 0,
    });
    peakValue = Math.max(peakValue, marketValue);
    if (peakValue > 0) {
      maxDrawdown = Math.min(maxDrawdown, (marketValue / peakValue - 1) * 100);
    }
  }

  const finalPoint = nav.at(-1)!;
  const totalShares = contributions.at(-1)?.cumulative_shares ?? 0;
  const totalInvested = contributions.at(-1)?.cumulative_invested ?? 0;
  const finalValue = totalShares * finalPoint.unit_nav;

  return {
    curve,
    contributions,
    totalInvested,
    finalValue,
    annualizedReturn: calculateDcaXirr(contributions, finalPoint.nav_date, finalValue),
    maxDrawdown,
  };
}

/** ???????????????????????? */
export async function getFundDcaPortfolioBacktest(
  codes: string[],
  range: FundNavRange,
  frequency: FundDcaFrequency,
  amounts: number[],
  now = new Date(),
): Promise<FundDcaPortfolioSnapshot> {
  const [profiles, rawNavSeries] = await Promise.all([
    Promise.all(codes.map((code) => getFundProfile(code))),
    Promise.all(codes.map((code) => getDcaNav(code, range))),
  ]);
  const source = rawNavSeries[0]?.[0]?.source ?? profiles[0]?.source ?? "computed";

  if (
    rawNavSeries.some(
      (nav) => nav.length < 2 || nav.some((item) => item.source === "deterministic-fallback"),
    )
  ) {
    return {
      codes,
      name: "???????",
      range,
      frequency,
      amount_per_period: amounts.reduce((sum, value) => sum + value, 0),
      available: false,
      reason: "???????????????????????",
      total_invested: null,
      total_value: null,
      profit_loss: null,
      profit_loss_pct: null,
      annualized_return_pct: null,
      max_drawdown_pct: null,
      current_drawdown_pct: null,
      equity_curve: [],
      source,
      generated_at: now.toISOString(),
    };
  }

  const navSeries = rawNavSeries.map((nav) =>
    nav
      .filter((item) => item.unit_nav > 0)
      .sort((left, right) => left.nav_date.localeCompare(right.nav_date)),
  );
  if (navSeries.some((nav) => nav.length < 2)) {
    return {
      codes,
      name: "???????",
      range,
      frequency,
      amount_per_period: amounts.reduce((sum, value) => sum + value, 0),
      available: false,
      reason: "??????????????????????",
      total_invested: null,
      total_value: null,
      profit_loss: null,
      profit_loss_pct: null,
      annualized_return_pct: null,
      max_drawdown_pct: null,
      current_drawdown_pct: null,
      equity_curve: [],
      source,
      generated_at: now.toISOString(),
    };
  }

  const singleFunds = navSeries.map((nav, index) =>
    buildSingleFundDcaCurve(nav, frequency, amounts[index]),
  );
  const curveMaps = singleFunds.map((fund) => new Map(fund.curve.map((point) => [point.date, point])));

  const dateSet = new Set<string>();
  for (const nav of navSeries) {
    for (const point of nav) {
      dateSet.add(point.nav_date);
    }
  }
  const allDates = Array.from(dateSet).sort((left, right) => left.localeCompare(right));

  const lastValues = singleFunds.map(() => ({ marketValue: 0, investedAmount: 0 }));
  const equityCurve: FundDcaEquityPoint[] = [];
  let peakValue = 0;
  let maxDrawdown = 0;
  for (const date of allDates) {
    let marketValue = 0;
    let investedAmount = 0;
    for (let index = 0; index < singleFunds.length; index += 1) {
      const point = curveMaps[index].get(date);
      if (point) {
        lastValues[index] = { marketValue: point.market_value, investedAmount: point.invested_amount };
      }
      marketValue += lastValues[index].marketValue;
      investedAmount += lastValues[index].investedAmount;
    }
    equityCurve.push({
      date,
      market_value: round(marketValue) ?? marketValue,
      invested_amount: round(investedAmount) ?? investedAmount,
      return_pct: investedAmount > 0 ? round((marketValue / investedAmount - 1) * 100, 2) ?? 0 : 0,
    });
    peakValue = Math.max(peakValue, marketValue);
    if (peakValue > 0) {
      maxDrawdown = Math.min(maxDrawdown, (marketValue / peakValue - 1) * 100);
    }
  }

  const finalPoint = equityCurve.at(-1)!;
  const totalInvested = singleFunds.reduce((sum, fund) => sum + fund.totalInvested, 0);
  const totalValue = finalPoint.market_value;
  const profitLoss = totalValue - totalInvested;
  const profitLossPct = totalInvested > 0 ? (totalValue / totalInvested - 1) * 100 : null;
  const currentDrawdown = peakValue > 0 ? (totalValue / peakValue - 1) * 100 : null;

  const contributionDateSet = new Set<string>();
  const contributionAmountByDate = new Map<string, number>();
  for (let index = 0; index < navSeries.length; index += 1) {
    const dates = buildContributionDates(navSeries[index], frequency);
    for (const date of dates) {
      contributionDateSet.add(date);
      contributionAmountByDate.set(date, (contributionAmountByDate.get(date) ?? 0) + amounts[index]);
    }
  }
  const aggregateContributions: FundDcaContribution[] = Array.from(contributionDateSet)
    .sort((left, right) => left.localeCompare(right))
    .map((date) => ({
      date,
      nav: 1,
      amount: contributionAmountByDate.get(date) ?? 0,
      shares: 0,
      cumulative_shares: 0,
      cumulative_invested: 0,
      market_value: 0,
    }));

  return {
    codes,
    name: "???????",
    range,
    frequency,
    amount_per_period: round(amounts.reduce((sum, value) => sum + value, 0)) ?? 0,
    available: true,
    reason: null,
    total_invested: round(totalInvested),
    total_value: round(totalValue),
    profit_loss: round(profitLoss),
    profit_loss_pct: round(profitLossPct),
    annualized_return_pct: calculateDcaXirr(aggregateContributions, finalPoint.date, totalValue),
    max_drawdown_pct: round(maxDrawdown),
    current_drawdown_pct: round(currentDrawdown),
    equity_curve: downsampleEquityCurve(equityCurve, MAX_EQUITY_POINTS),
    source,
    generated_at: now.toISOString(),
  };
}
