// 基金对比数据编排：基于现有基金档案、净值、行情与风险指标聚合多只基金同口径对比。
import { getFundIntraday } from "@/lib/fund-intraday";
import { getFundMetrics } from "@/lib/fund-metrics";
import { getFundNav, getFundProfile, type FundNavRange } from "@/lib/fund-data";
import { normalizeFundCode } from "@/lib/fund-market";
import type {
  FundComparisonItem,
  FundComparisonSnapshot,
  FundNavPoint,
} from "@/lib/shared/types";

const VALID_RANGES: FundNavRange[] = ["1m", "3m", "6m", "1y", "3y", "all"];

/** 规范化对比基金代码列表；非法输入返回 null。 */
export function normalizeFundComparisonCodes(raw: string | null): string[] | null {
  if (!raw) {
    return null;
  }

  const codes = raw
    .split(/[,，\s]+/)
    .map((code) => normalizeFundCode(code))
    .filter((code): code is string => Boolean(code));
  const uniqueCodes = Array.from(new Set(codes));
  if (uniqueCodes.length < 2 || uniqueCodes.length > 5) {
    return null;
  }
  return uniqueCodes;
}

/** 校验对比区间；非法时回退到 1y。 */
export function normalizeFundComparisonRange(raw: string | null): FundNavRange {
  return VALID_RANGES.includes(raw as FundNavRange) ? (raw as FundNavRange) : "1y";
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

/** 聚合指定基金在指定区间内的可对比指标。 */
export async function getFundComparison(
  codes: string[],
  range: FundNavRange,
  now = new Date(),
): Promise<FundComparisonSnapshot> {
  const items = await Promise.all(
    codes.map(async (code): Promise<FundComparisonItem> => {
      const [profile, nav, metrics, intraday] = await Promise.all([
        getFundProfile(code),
        getFundNav(code, range, "cumulative"),
        getFundMetrics(code, range),
        getFundIntraday(code),
      ]);

      const latest = nav.at(-1) ?? null;
      return {
        code,
        name: profile.name,
        type: profile.type,
        trading_mode: profile.trading_mode,
        latest_nav_date: latest?.nav_date ?? null,
        latest_cumulative_nav: latest ? round(latest.cumulative_nav, 4) : null,
        latest_change_pct: intraday.change_pct,
        period_return_pct: periodReturn(nav),
        annualized_return_pct: metrics?.annualized_return_pct ?? null,
        annualized_volatility_pct: metrics?.annualized_volatility_pct ?? null,
        max_drawdown_pct: metrics?.max_drawdown_pct ?? null,
        current_drawdown_pct: metrics?.current_drawdown_pct ?? null,
        sharpe: metrics?.sharpe ?? null,
        sortino: metrics?.sortino ?? null,
        calmar: metrics?.calmar ?? null,
        source: profile.source,
        fetched_at: profile.fetched_at,
      };
    }),
  );

  return {
    range,
    generated_at: now.toISOString(),
    items,
  };
}
