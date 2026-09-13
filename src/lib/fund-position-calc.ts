// 基金持仓口径计算（纯函数，不依赖网络与数据库，便于单元测试）。
//
// 口径（详见 docs/fund-positions-plan.md §3）：
//   录入      当前持有金额 marketValue、当前累计收益 totalProfit
//   推算本金  costAmount = marketValue − totalProfit
//   当日收益  dayProfit  = marketValue − marketValue / (1 + changePct / 100)
//   上一交易日累计收益 prevTotalProfit = totalProfit − dayProfit
//   累计收益率 totalProfitPct = totalProfit / costAmount × 100（本金非正时为空）
// 恒等式：prevTotalProfit + dayProfit === totalProfit（按定义成立）。

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
  /** 当前累计收益，用户录入，可为负。 */
  totalProfit: number;
  /** 当日涨跌幅（百分比）；取不到传 null。 */
  changePct: number | null;
}

/** 单只基金的持仓口径结果（金额与百分比均已按两位小数取整）。 */
export interface FundPositionMathResult {
  /** 推算本金 = 持有金额 − 累计收益。 */
  costAmount: number;
  /** 累计收益率（百分比）；推算本金非正时为 null。 */
  totalProfitPct: number | null;
  /** 当日实时收益；涨跌幅不可用时为 null。 */
  dayProfit: number | null;
  /** 上一交易日累计收益；涨跌幅不可用时为 null。 */
  prevTotalProfit: number | null;
  totalProfit: number;
}

/** 计算单只基金的推算本金、当日收益与累计收益率。 */
export function computeFundPositionMath(input: FundPositionMathInput): FundPositionMathResult {
  const { marketValue, totalProfit, changePct } = input;

  const costAmountRaw = marketValue - totalProfit;

  // 涨跌幅缺失或超出合理区间时不推导当日收益，避免把脏数据放大成不可信的数字。
  const validChange =
    changePct !== null &&
    Number.isFinite(changePct) &&
    Math.abs(changePct) <= MAX_ABS_CHANGE_PCT &&
    changePct > -100;

  const dayProfit = validChange ? round2(marketValue - marketValue / (1 + (changePct as number) / 100)) : null;

  return {
    costAmount: round2(costAmountRaw),
    totalProfitPct: costAmountRaw > 0 ? roundPct((totalProfit / costAmountRaw) * 100) : null,
    dayProfit,
    prevTotalProfit: dayProfit === null ? null : round2(totalProfit - dayProfit),
    totalProfit: round2(totalProfit),
  };
}

/** 按持有金额计算持仓占比（百分比）；总持有金额为 0 时全部返回 0。 */
export function computeWeights(marketValues: number[]): number[] {
  const total = marketValues.reduce((sum, value) => (Number.isFinite(value) ? sum + value : sum), 0);
  if (!(total > 0)) {
    return marketValues.map(() => 0);
  }
  return marketValues.map((value) => roundPct(((Number.isFinite(value) ? value : 0) / total) * 100) ?? 0);
}

/** 汇总合计口径；传入已计算完成的 Valuation（仅取金额相关字段）。 */
export function sumValuations(
  items: Array<{ market_value: number; total_profit: number; day_profit: number | null }>,
): {
  total_market_value: number;
  total_cost: number;
  total_profit: number;
  total_profit_pct: number | null;
  total_day_profit: number | null;
} {
  const totalMarketValue = round2(items.reduce((sum, item) => sum + item.market_value, 0));
  const totalProfit = round2(items.reduce((sum, item) => sum + item.total_profit, 0));
  const totalCost = round2(totalMarketValue - totalProfit);
  const dayItems = items.filter((item) => item.day_profit !== null);

  return {
    total_market_value: totalMarketValue,
    total_cost: totalCost,
    total_profit: totalProfit,
    total_profit_pct: totalCost > 0 ? roundPct((totalProfit / totalCost) * 100) : null,
    total_day_profit:
      dayItems.length === 0
        ? null
        : round2(dayItems.reduce((sum, item) => sum + (item.day_profit as number), 0)),
  };
}