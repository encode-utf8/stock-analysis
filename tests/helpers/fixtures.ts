// 测试夹具：为纯计算测试构造最小可用的共享类型样本。
import type { AlertObservation, AlertRule, FundNavPoint, Kline } from "@/lib/shared/types";

/** 构造单个基金净值点；unit_nav 与 cumulative_nav 取同值，便于手工验算。 */
export function fundNavPoint(nav_date: string, value: number, source = "akshare"): FundNavPoint {
  return {
    code: "510300",
    nav_date,
    unit_nav: value,
    cumulative_nav: value,
    daily_change_pct: null,
    source,
    fetched_at: `${nav_date}T08:00:00.000Z`,
  };
}

/** 按 [日期, 净值] 列表构造净值序列。 */
export function fundNavSeries(entries: Array<[string, number]>, source = "akshare"): FundNavPoint[] {
  return entries.map(([nav_date, value]) => fundNavPoint(nav_date, value, source));
}

/** 由收盘价序列构造日 K 线，最高/最低价按固定偏移生成。 */
export function klinesFromCloses(closes: number[]): Kline[] {
  const start = Date.UTC(2024, 0, 1);
  return closes.map((close, index) => ({
    code: "600519",
    period: "day",
    ts: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
    open: close,
    high: close + 0.5,
    low: close - 0.5,
    close,
    volume: 1000,
    amount: close * 1000,
    adj_type: "qfq",
  }));
}
/** 构造预警规则；默认单条件「当日涨跌幅 ≤ -3%」，用 overrides 覆盖所需字段。 */
export function alertRule(overrides: Partial<AlertRule> = {}): AlertRule {
  const stamp = "2024-03-05T02:00:00.000Z";
  return {
    id: "alert-rule-1",
    target: "stock",
    code: "600519",
    name: "贵州茅台",
    logic: "and",
    conditions: [{ metric: "change_pct", operator: "lte", threshold: -3 }],
    enabled: true,
    cooldown_hours: 12,
    created_at: stamp,
    updated_at: stamp,
    last_triggered_at: null,
    ...overrides,
  };
}

/** 构造单个指标观测值。 */
export function alertObservation(
  metric: AlertObservation["metric"],
  value: number,
  overrides: Partial<AlertObservation> = {},
): AlertObservation {
  return {
    metric,
    value,
    source: "akshare",
    observed_at: "2024-03-05T02:00:00.000Z",
    ...overrides,
  };
}