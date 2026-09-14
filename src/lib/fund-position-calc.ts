// 基金持仓口径计算（纯函数，不依赖网络与数据库，便于单元测试）。
//
// 口径（详见 docs/fund-position-caliber-plan.md）：
//   录入     持有金额 marketValue 与累计收益 totalProfit 是「同一口径的一对」
//            含当日 include_today：两者都已包含今日盈亏（marketValue 即当前市值）
//            不含当日 exclude_today：两者都是上一交易日收盘口径
//   推算本金 costAmount = 录入持有金额 − 录入累计收益（两种口径等价，且不依赖行情）
//   上一日市值 prevMarketValue：不含当日取录入值；含当日 = 当前市值 / (1 + 涨跌幅 / 100)
//   当前市值 marketValue：含当日取录入值；不含当日 = 录入值 × (1 + 涨跌幅 / 100)
//   当日收益 dayProfit = 当前市值 − 上一交易日市值
//   累计收益 totalProfit = 市值 − 本金（当前与上一交易日同源推得）
//   累计收益率 totalProfitPct = totalProfit / costAmount × 100（本金非正时为空）
// 恒等式：prevTotalProfit + dayProfit === totalProfit（两种口径按定义均成立）。
// 当日行情不可用时只置空依赖它的字段，不用 0 冒充。

import type { FundProfitCaliber } from "@/lib/shared/types";

/** 累计收益口径缺省值：含当日收益，与历史数据语义一致。 */
export const DEFAULT_FUND_PROFIT_CALIBER: FundProfitCaliber = "include_today";

/** 运行时判断入参是否为合法的累计收益口径。 */
export function isFundProfitCaliber(value: unknown): value is FundProfitCaliber {
  return value === "include_today" || value === "exclude_today";
}

/** 归一化累计收益口径：缺失或非法一律按缺省「含当日收益」处理（用于兼容历史数据）。 */
export function normalizeFundProfitCaliber(value: unknown): FundProfitCaliber {
  return isFundProfitCaliber(value) ? value : DEFAULT_FUND_PROFIT_CALIBER;
}

/** 涨跌幅绝对值上限：超过视为脏数据，不做当日收益推导。 */
export const MAX_ABS_CHANGE_PCT = 100;

/** 保留两位小数，避免浮点误差扩散到展示层。 */
export function round2(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 100) / 100;
}

/** 百分比保留两位小数；非有限值返回 null。 */
export function roundPct(value: number): number | null {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

/** 解析用户输入的数值（支持数字或带千分位的字符串）；非法返回 null。 */
export function parseNumericInput(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/,/g, "");
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** 单只基金的持仓口径入参。 */
export interface FundPositionMathInput {
  /** 当前持有金额（市值），用户录入。 */
  marketValue: number;
  /** 用户录入的累计收益，可为负；含义由 profitCaliber 决定。 */
  totalProfit: number;
  /** 当日涨跌幅（百分比）；取不到传 null。 */
  changePct: number | null;
  /** 累计收益口径；缺省按「含当日收益」处理。 */
  profitCaliber?: FundProfitCaliber;
}

/** 单只基金的持仓口径结果（金额与百分比均已按两位小数取整）。 */
export interface FundPositionMathResult {
  /** 当前市值（含当日盈亏）；不含当日口径且涨跌幅不可用时为 null。 */
  marketValue: number | null;
  /** 上一交易日市值；含当日口径且涨跌幅不可用时为 null。 */
  prevMarketValue: number | null;
  /** 推算本金 = 录入持有金额 − 录入累计收益（与口径无关，也不依赖行情）。 */
  costAmount: number;
  /** 累计收益率（百分比）；推算本金非正或当前累计收益不可用时为 null。 */
  totalProfitPct: number | null;
  /** 当日实时收益；涨跌幅不可用时为 null。 */
  dayProfit: number | null;
  /** 上一交易日累计收益；含当日口径且涨跌幅不可用时为 null（不含当日口径恒等于录入值）。 */
  prevTotalProfit: number | null;
  /** 当前累计收益（含当日收益）；不含当日口径且涨跌幅不可用时为 null。 */
  totalProfit: number | null;
  /** 本次计算采用的口径（缺省时回填缺省值），便于调用方回显。 */
  profitCaliber: FundProfitCaliber;
}

/** 计算单只基金的推算本金、当日收益与累计收益率。 */
export function computeFundPositionMath(input: FundPositionMathInput): FundPositionMathResult {
  const { marketValue, totalProfit, changePct } = input;
  const profitCaliber = input.profitCaliber ?? DEFAULT_FUND_PROFIT_CALIBER;

  // 涨跌幅缺失或超出合理区间时不推导当日收益，避免把脏数据放大成不可信的数字。
  const validChange =
    changePct !== null &&
    Number.isFinite(changePct) &&
    Math.abs(changePct) <= MAX_ABS_CHANGE_PCT &&
    changePct > -100;

  const rate = validChange ? (changePct as number) / 100 : null;

  // 录入的持有金额与累计收益是同一口径的一对，因此推算本金只依赖录入值：
  //   本金 = 录入市值 − 录入累计收益（含当日 / 不含当日两种口径等价，且不依赖行情）。
  const costAmount = round2(marketValue - totalProfit);

  // 上一交易日市值：不含当日口径直接取录入值（不依赖行情）；含当日口径需要按涨跌幅反推。
  const prevMarketValue =
    profitCaliber === "exclude_today"
      ? round2(marketValue)
      : rate === null
        ? null
        : round2(marketValue / (1 + rate));

  // 当前市值：含当日口径直接取录入值；不含当日口径需要按涨跌幅折算。
  // 行情不可用时不含当日口径无从折算，留空而不是假设当日收益为 0。
  const currentMarketValue =
    profitCaliber === "include_today"
      ? round2(marketValue)
      : rate === null
        ? null
        : round2(marketValue * (1 + rate));

  // 当日收益 = 当前市值 − 上一交易日市值；任一端不可用则留空。
  const dayProfit =
    currentMarketValue === null || prevMarketValue === null
      ? null
      : round2(currentMarketValue - prevMarketValue);

  // 累计收益 = 市值 − 本金，当前与上一交易日同源推得，恒等式天然成立。
  const currentTotalProfit =
    currentMarketValue === null ? null : round2(currentMarketValue - costAmount);
  const prevTotalProfit = prevMarketValue === null ? null : round2(prevMarketValue - costAmount);

  return {
    marketValue: currentMarketValue,
    prevMarketValue,
    costAmount,
    totalProfitPct:
      currentTotalProfit !== null && costAmount > 0
        ? roundPct((currentTotalProfit / costAmount) * 100)
        : null,
    dayProfit,
    prevTotalProfit,
    totalProfit: currentTotalProfit,
    profitCaliber,
  };
}

/**
 * 按持有金额计算持仓占比（百分比）；总持有金额为 0 时全部返回 0。
 * 任一持仓金额不可用（例如不含当日口径且行情缺失）时整列返回 null，避免用部分合计算出失真占比。
 */
export function computeWeights(marketValues: Array<number | null>): Array<number | null> {
  if (marketValues.some((value) => value === null)) {
    return marketValues.map(() => null);
  }

  const values = marketValues as number[];
  const total = values.reduce((sum, value) => (Number.isFinite(value) ? sum + value : sum), 0);
  if (!(total > 0)) {
    return values.map(() => 0);
  }
  return values.map((value) => roundPct(((Number.isFinite(value) ? value : 0) / total) * 100) ?? 0);
}

/**
 * 汇总合计口径；传入已计算完成的 Valuation（仅取金额相关字段）。
 * 市值/累计收益合计不做「部分求和」：任一只不可用时整体留空，避免少算误导；空组合仍按 0 汇总。
 * 推算本金只依赖录入值，任何情况下都可合计。当日收益合计维持既有约定（按可计算部分求和）。
 */
export function sumValuations(
  items: Array<{
    market_value: number | null;
    cost_amount: number;
    total_profit: number | null;
    day_profit: number | null;
  }>,
): {
  total_market_value: number | null;
  total_cost: number;
  total_profit: number | null;
  total_profit_pct: number | null;
  total_day_profit: number | null;
} {
  const totalMarketValue = items.some((item) => item.market_value === null)
    ? null
    : round2(items.reduce((sum, item) => sum + (item.market_value as number), 0));
  const totalCost = round2(items.reduce((sum, item) => sum + item.cost_amount, 0));
  const totalProfit = items.some((item) => item.total_profit === null)
    ? null
    : round2(items.reduce((sum, item) => sum + (item.total_profit as number), 0));
  const dayItems = items.filter((item) => item.day_profit !== null);

  return {
    total_market_value: totalMarketValue,
    total_cost: totalCost,
    total_profit: totalProfit,
    total_profit_pct:
      totalCost > 0 && totalProfit !== null ? roundPct((totalProfit / totalCost) * 100) : null,
    total_day_profit:
      dayItems.length === 0
        ? null
        : round2(dayItems.reduce((sum, item) => sum + (item.day_profit as number), 0)),
  };
}