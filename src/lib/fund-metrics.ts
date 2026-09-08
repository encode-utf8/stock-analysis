// 基金风险指标本地计算：基于历史累计净值计算收益、波动、回撤与修复指标。

import { cacheGet, cacheInvalidatePrefix, cacheSet } from "@/lib/cache";
import { getFundNav, type FundNavRange } from "@/lib/fund-data";
import { fundDataStore } from "@/lib/fund-data-store";
import type { FundNavPoint, FundRiskMetrics } from "@/lib/shared/types";

export type FundMetricsRange = FundNavRange;

const METRICS_TTL_MS = 60 * 60_000;
const TRADING_DAYS_PER_YEAR = 252;
const RISK_FREE_RATE = 0.02;

const fundMetricsStore = new Map<string, FundRiskMetrics>();

function round(value: number | null, digits = 2): number | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number | null {
  if (values.length < 2) {
    return null;
  }
  const average = mean(values);
  if (average === null) {
    return null;
  }
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  return Math.max((end - start) / 86_400_000, 1);
}

/** 按日期在净值序列中查找最近的一个索引。 */
function findNavIndex(nav: FundNavPoint[], date: string): number | null {
  const index = nav.findIndex((point) => point.nav_date >= date);
  if (index >= 0) {
    return index;
  }
  return nav.length > 0 ? nav.length - 1 : null;
}

/** 根据累计净值序列计算基金风险指标。 */
export function calculateFundRiskMetrics(
  code: string,
  range: FundMetricsRange,
  nav: FundNavPoint[],
): FundRiskMetrics | null {
  const points = nav
    .filter((point) => Number.isFinite(point.cumulative_nav) && point.cumulative_nav > 0)
    .sort((left, right) => left.nav_date.localeCompare(right.nav_date));

  if (points.length < 2) {
    return null;
  }

  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) {
    return null;
  }

  const startDate = first.nav_date;
  const endDate = last.nav_date;
  const totalDays = daysBetween(startDate, endDate);
  const intervalReturn = last.cumulative_nav / first.cumulative_nav - 1;
  const annualizedReturn =
    (1 + intervalReturn) ** (365 / totalDays) - 1;
  const annualizedReturnPct = round(annualizedReturn * 100);

  const dailyReturns: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1].cumulative_nav;
    const current = points[index].cumulative_nav;
    if (previous > 0) {
      dailyReturns.push(current / previous - 1);
    }
  }

  const dailyVolatility = standardDeviation(dailyReturns);
  const annualizedVolatilityPct =
    dailyVolatility === null
      ? null
      : round(dailyVolatility * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100);

  const downsideDeviation =
    dailyReturns.length === 0
      ? null
      : Math.sqrt(
          dailyReturns.reduce(
            (sum, value) => sum + (value < 0 ? value * value : 0),
            0,
          ) / dailyReturns.length,
        ) * Math.sqrt(TRADING_DAYS_PER_YEAR);

  let peak = first.cumulative_nav;
  let peakDate = first.nav_date;
  let peakIndex = 0;
  let maxDrawdown = 0;
  let maxDrawdownStart = first.nav_date;
  let maxDrawdownEnd = first.nav_date;
  let maxDrawdownPeakValue = first.cumulative_nav;
  const recoveryDays: number[] = [];
  let inDrawdown = false;
  let currentPeak = first.cumulative_nav;
  let currentTroughSincePeak = first.cumulative_nav;
  let currentInDrawdown = false;

  points.forEach((point, index) => {
    const value = point.cumulative_nav;
    if (value >= currentPeak) {
      currentPeak = value;
      currentTroughSincePeak = value;
      currentInDrawdown = false;
    } else {
      currentInDrawdown = true;
      currentTroughSincePeak = Math.min(currentTroughSincePeak, value);
    }

    if (value >= peak) {
      if (inDrawdown && index > peakIndex) {
        recoveryDays.push(index - peakIndex);
      }
      peak = value;
      peakDate = point.nav_date;
      peakIndex = index;
      inDrawdown = false;
      return;
    }

    inDrawdown = true;
    const drawdown = value / peak - 1;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownStart = peakDate;
      maxDrawdownEnd = point.nav_date;
      maxDrawdownPeakValue = peak;
    }
  });

  const currentValue = last.cumulative_nav;
  const currentDrawdownPct = round(Math.abs(currentValue / currentPeak - 1) * 100);
  let currentRecoveryProgressPct: number | null;
  if (!currentInDrawdown || currentValue >= currentPeak) {
    currentRecoveryProgressPct = 100;
  } else {
    const denominator = currentPeak - currentTroughSincePeak;
    currentRecoveryProgressPct =
      denominator > 0
        ? round(
            Math.min(100, Math.max(0, ((currentValue - currentTroughSincePeak) / denominator) * 100)),
          )
        : 0;
  }

  const recoveryStartIndex = points.findIndex((point) => point.nav_date === maxDrawdownEnd);
  let maxDrawdownRecoveryEnd: string | null = null;
  let maxDrawdownRecoveryComplete = false;
  if (recoveryStartIndex >= 0) {
    for (let index = recoveryStartIndex + 1; index < points.length; index += 1) {
      if (points[index].cumulative_nav >= maxDrawdownPeakValue) {
        maxDrawdownRecoveryEnd = points[index].nav_date;
        maxDrawdownRecoveryComplete = true;
        break;
      }
    }
  }

  const longestRecoveryDays =
    recoveryDays.length > 0 ? Math.max(...recoveryDays) : null;
  const averageRecoveryDays = recoveryDays.length > 0 ? mean(recoveryDays) : null;

  const sharpe =
    annualizedVolatilityPct !== null && annualizedVolatilityPct > 0
      ? round((annualizedReturn - RISK_FREE_RATE) / (annualizedVolatilityPct / 100))
      : null;
  const sortino =
    downsideDeviation !== null && downsideDeviation > 0
      ? round((annualizedReturn - RISK_FREE_RATE) / downsideDeviation)
      : null;
  const calmar =
    maxDrawdown < 0
      ? round(annualizedReturn / Math.abs(maxDrawdown))
      : null;

  return {
    code,
    range,
    start_date: startDate,
    end_date: endDate,
    max_drawdown_pct: round(Math.abs(maxDrawdown) * 100) ?? 0,
    max_drawdown_start: maxDrawdownStart,
    max_drawdown_end: maxDrawdownEnd,
    current_drawdown_pct: currentDrawdownPct ?? 0,
    max_drawdown_recovery_start: maxDrawdownEnd,
    max_drawdown_recovery_end: maxDrawdownRecoveryEnd,
    max_drawdown_recovery_complete: maxDrawdownRecoveryComplete,
    longest_recovery_days:
      longestRecoveryDays === null ? null : Math.round(longestRecoveryDays),
    average_recovery_days:
      averageRecoveryDays === null ? null : Math.round(averageRecoveryDays),
    current_recovery_progress_pct: currentRecoveryProgressPct,
    annualized_return_pct: annualizedReturnPct ?? 0,
    annualized_volatility_pct: annualizedVolatilityPct,
    sharpe,
    sortino,
    calmar,
    updated_at: new Date().toISOString(),
  };
}

/** 获取基金风险指标，带缓存与确定性净值回退。 */
export async function getFundMetrics(
  code: string,
  range: FundMetricsRange,
  forceRefresh = false,
): Promise<FundRiskMetrics | null> {
  const cacheKey = `fund:metrics:${code}:${range}:cumulative`;
  if (forceRefresh) {
    cacheInvalidatePrefix(cacheKey);
  }

  const cached = cacheGet<FundRiskMetrics>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const saved = fundMetricsStore.get(cacheKey);
  if (!forceRefresh && saved) {
    return saved;
  }

  if (!forceRefresh) {
    const persisted = await fundDataStore.metrics.getByRange(code, range);
    if (persisted) {
      fundMetricsStore.set(cacheKey, persisted);
      return persisted;
    }
  }

  const nav = await getFundNav(code, range, "cumulative", forceRefresh);
  const metrics = calculateFundRiskMetrics(code, range, nav);
  if (!metrics) {
    return null;
  }

  const isFallback = nav[0]?.source === "deterministic-fallback";
  fundMetricsStore.set(cacheKey, metrics);
  await fundDataStore.metrics.upsert(metrics);
  if (!isFallback) {
    cacheSet(cacheKey, metrics, METRICS_TTL_MS);
  }
  return metrics;
}

/** 供净值曲线叠加最大回撤区间使用。 */
export function findMaxDrawdownIndices(
  nav: FundNavPoint[],
  metrics: FundRiskMetrics | null,
): { startIndex: number | null; endIndex: number | null } {
  if (!metrics) {
    return { startIndex: null, endIndex: null };
  }
  return {
    startIndex: findNavIndex(nav, metrics.max_drawdown_start),
    endIndex: findNavIndex(nav, metrics.max_drawdown_end),
  };
}
