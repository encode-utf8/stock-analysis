// 个股策略回测引擎（纯计算）。
// 输入已排序的前复权 K 线，输出信号、成交明细、净值曲线与绩效指标，
// 不依赖网络与数据库，便于单元测试与复用。
//
// 简化假设（界面需同步标注）：
// 1. 单标的策略为「满仓 / 空仓」两态，允许小数股，避免 100 股一手导致高价股无法建仓。
// 2. 信号在当根 K 线收盘后产生，下一根 K 线开盘价成交，避免用未来数据。
// 3. 费用按成交金额比例计（不设最低佣金），卖出加收印花税，滑点按成交价比例双向计入。
// 4. 不考虑分红送股（已用前复权价近似），不考虑停牌与涨跌停无法成交的情况。

import { calculateRsiSeries } from "@/lib/indicators";
import type { Kline } from "@/lib/shared/types";
import type {
  BacktestMetrics,
  BacktestPoint,
  BacktestRebalance,
  BacktestTrade,
} from "@/lib/shared/types";

const TRADING_DAYS_PER_YEAR = 252;
const RISK_FREE_RATE = 0.02;

/** 回测用的最小 K 线结构。 */
export interface BacktestBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** 单根 K 线上的操作信号；null 表示不操作。 */
export type BarSignal = "buy" | "sell" | null;

/** 单标的回测入参。 */
export interface SingleAssetBacktestInput {
  code: string;
  bars: BacktestBar[];
  signals: BarSignal[];
  initialCapital: number;
  feeRate: number;
  stampDutyRate: number;
  slippageRate: number;
}

/** 组合再平衡回测入参。 */
export interface PortfolioBacktestInput {
  items: Array<{ code: string; weight: number }>;
  /** 各标的的 K 线，键为代码；调用方需保证已按日期升序排列。 */
  barsByCode: Record<string, BacktestBar[]>;
  rebalance: BacktestRebalance;
  initialCapital: number;
  feeRate: number;
  stampDutyRate: number;
  slippageRate: number;
}

/** 单标的回测输出。 */
export interface SingleAssetBacktestOutput {
  metrics: BacktestMetrics;
  equityCurve: BacktestPoint[];
  trades: BacktestTrade[];
  warnings: string[];
}

/** 把共享 K 线模型转换为回测用结构。 */
export function toBacktestBars(klines: Kline[]): BacktestBar[] {
  return klines
    .filter(
      (item) =>
        typeof item.ts === "string" &&
        Number.isFinite(item.open) &&
        Number.isFinite(item.high) &&
        Number.isFinite(item.low) &&
        Number.isFinite(item.close) &&
        item.close > 0,
    )
    .map((item) => ({
      date: item.ts.slice(0, 10),
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

/**
 * 判断一批 K 线是否可用于回测。
 * 侧车真实数据一定带 source（tencent/akshare）；确定性降级数据不带 source 或标记为
 * deterministic-fallback，必须拒绝，避免用演示数据跑出看似可信的回测结论。
 */
export function isUsableBacktestKlines(klines: Kline[]): boolean {
  return (
    klines.length > 0 &&
    klines.every(
      (item) => typeof item.source === "string" && item.source !== "deterministic-fallback",
    )
  );
}

function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 简单移动平均序列；不足窗口的位置为 null。 */
export function smaSeries(values: number[], period: number): Array<number | null> {
  const result: Array<number | null> = [];
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index];
    if (index >= period) {
      sum -= values[index - period];
    }
    result.push(index + 1 >= period ? sum / period : null);
  }
  return result;
}

/** 指数移动平均序列；不足窗口的位置为 null，与 indicators.ts 的 EMA 口径一致。 */
export function emaSeries(values: number[], period: number): Array<number | null> {
  const factor = 2 / (period + 1);
  const result: Array<number | null> = [];
  let current: number | null = null;

  for (let index = 0; index < values.length; index += 1) {
    if (index + 1 < period) {
      result.push(null);
      continue;
    }
    if (current === null) {
      current = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
    } else {
      current = values[index] * factor + current * (1 - factor);
    }
    result.push(current);
  }

  return result;
}

/** 布林带序列（周期与标准差倍数均可调）。 */
export function bollSeries(
  values: number[],
  period: number,
  multiplier: number,
): Array<{ upper: number; middle: number; lower: number } | null> {
  const result: Array<{ upper: number; middle: number; lower: number } | null> = [];
  for (let index = 0; index < values.length; index += 1) {
    if (index + 1 < period) {
      result.push(null);
      continue;
    }
    const slice = values.slice(index - period + 1, index + 1);
    const average = slice.reduce((sum, value) => sum + value, 0) / period;
    const variance = slice.reduce((sum, value) => sum + (value - average) ** 2, 0) / period;
    const deviation = Math.sqrt(variance);
    result.push({
      upper: average + multiplier * deviation,
      middle: average,
      lower: average - multiplier * deviation,
    });
  }
  return result;
}

/** 判断两条序列是否在 index 处发生上穿（前值小于等于、当前值大于）。 */
function crossAbove(
  left: Array<number | null>,
  right: Array<number | null>,
  index: number,
): boolean {
  if (index < 1) {
    return false;
  }
  const leftPrev = left[index - 1];
  const rightPrev = right[index - 1];
  const leftNow = left[index];
  const rightNow = right[index];
  if (leftPrev === null || rightPrev === null || leftNow === null || rightNow === null) {
    return false;
  }
  return leftPrev <= rightPrev && leftNow > rightNow;
}

/** 判断两条序列是否在 index 处发生下穿。 */
function crossBelow(
  left: Array<number | null>,
  right: Array<number | null>,
  index: number,
): boolean {
  if (index < 1) {
    return false;
  }
  const leftPrev = left[index - 1];
  const rightPrev = right[index - 1];
  const leftNow = left[index];
  const rightNow = right[index];
  if (leftPrev === null || rightPrev === null || leftNow === null || rightNow === null) {
    return false;
  }
  return leftPrev >= rightPrev && leftNow < rightNow;
}

/** 双均线金叉死叉信号：快线上穿慢线买入，下穿卖出。 */
export function buildMaCrossSignals(closes: number[], fast: number, slow: number): BarSignal[] {
  const fastSeries = smaSeries(closes, fast);
  const slowSeries = smaSeries(closes, slow);
  return closes.map((_, index) => {
    if (crossAbove(fastSeries, slowSeries, index)) {
      return "buy";
    }
    if (crossBelow(fastSeries, slowSeries, index)) {
      return "sell";
    }
    return null;
  });
}

/** MACD 金叉死叉信号：DIF 上穿 DEA 买入，下穿卖出。 */
export function buildMacdCrossSignals(
  closes: number[],
  fast: number,
  slow: number,
  signal: number,
): BarSignal[] {
  const fastSeries = emaSeries(closes, fast);
  const slowSeries = emaSeries(closes, slow);
  const difSeries = closes.map((_, index) =>
    fastSeries[index] !== null && slowSeries[index] !== null
      ? (fastSeries[index] as number) - (slowSeries[index] as number)
      : null,
  );
  // DEA 为 DIF 的 EMA；DIF 为 null 的头部不参与均值计算。
  const validDif = difSeries.filter((value): value is number => value !== null);
  const deaOnValid = emaSeries(validDif, signal);
  const deaSeries: Array<number | null> = [];
  let cursor = 0;
  for (const value of difSeries) {
    if (value === null) {
      deaSeries.push(null);
      continue;
    }
    deaSeries.push(deaOnValid[cursor] ?? null);
    cursor += 1;
  }

  return closes.map((_, index) => {
    if (crossAbove(difSeries, deaSeries, index)) {
      return "buy";
    }
    if (crossBelow(difSeries, deaSeries, index)) {
      return "sell";
    }
    return null;
  });
}

/** RSI 反转信号：从超卖区上穿买入，从超买区下穿卖出。 */
export function buildRsiReversalSignals(
  closes: number[],
  period: number,
  oversold: number,
  overbought: number,
): BarSignal[] {
  const rsiValues = calculateRsiSeries(closes, period);
  // 序列长度与收盘价不一致时（样本不足）统一返回空信号，避免按下标错位取值。
  if (rsiValues.length !== closes.length) {
    return closes.map(() => null);
  }
  return closes.map((_, index) => {
    if (index < 1) {
      return null;
    }
    const previous = rsiValues[index - 1];
    const current = rsiValues[index];
    if (previous === null || current === null) {
      return null;
    }
    if (previous <= oversold && current > oversold) {
      return "buy";
    }
    if (previous >= overbought && current < overbought) {
      return "sell";
    }
    return null;
  });
}

/** 布林带信号：收盘价回到下轨上方买入（脱离超跌），回到中轨上方卖出。 */
export function buildBollBreakoutSignals(
  closes: number[],
  period: number,
  multiplier: number,
): BarSignal[] {
  const bands = bollSeries(closes, period, multiplier);
  return closes.map((_, index) => {
    if (index < 1) {
      return null;
    }
    const previous = bands[index - 1];
    const current = bands[index];
    if (!previous || !current) {
      return null;
    }
    if (closes[index - 1] < previous.lower && closes[index] >= current.lower) {
      return "buy";
    }
    if (closes[index - 1] < previous.middle && closes[index] >= current.middle) {
      return "sell";
    }
    return null;
  });
}

function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  return Math.max(Math.round((end - start) / 86_400_000), 0);
}

/** 依据净值曲线与成交明细计算绩效指标。 */
export function calculateBacktestMetrics(
  equityCurve: BacktestPoint[],
  trades: BacktestTrade[],
  initialCapital: number,
  strategyValues: "closed-trades" | "rebalance",
): BacktestMetrics {
  const first = equityCurve[0];
  const last = equityCurve.at(-1);
  if (!first || !last) {
    throw new Error("净值曲线为空，无法计算回测指标。");
  }

  const totalReturn = last.strategy / initialCapital - 1;
  const totalDays = Math.max(daysBetween(first.date, last.date), 1);
  const annualizedReturn = (1 + totalReturn) ** (365 / totalDays) - 1;

  const dailyReturns: number[] = [];
  for (let index = 1; index < equityCurve.length; index += 1) {
    const previous = equityCurve[index - 1].strategy;
    const current = equityCurve[index].strategy;
    if (previous > 0) {
      dailyReturns.push(current / previous - 1);
    }
  }

  const mean = dailyReturns.length > 0
    ? dailyReturns.reduce((sum, value) => sum + value, 0) / dailyReturns.length
    : null;
  const variance = dailyReturns.length > 1 && mean !== null
    ? dailyReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (dailyReturns.length - 1)
    : null;
  const dailyVolatility = variance === null ? null : Math.sqrt(variance);
  const annualizedVolatility = dailyVolatility === null
    ? null
    : dailyVolatility * Math.sqrt(TRADING_DAYS_PER_YEAR);

  const downside = dailyReturns.length > 0
    ? Math.sqrt(
        dailyReturns.reduce((sum, value) => sum + (value < 0 ? value * value : 0), 0) /
          dailyReturns.length,
      ) * Math.sqrt(TRADING_DAYS_PER_YEAR)
    : null;

  let peak = first.strategy;
  let peakDate = first.date;
  let maxDrawdown = 0;
  let maxDrawdownStart = first.date;
  let maxDrawdownEnd = first.date;
  let maxDrawdownPeakValue = first.strategy;
  let currentPeak = first.strategy;

  for (const point of equityCurve) {
    if (point.strategy >= currentPeak) {
      currentPeak = point.strategy;
    }
    if (point.strategy >= peak) {
      peak = point.strategy;
      peakDate = point.date;
      continue;
    }
    const drawdown = point.strategy / peak - 1;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownStart = peakDate;
      maxDrawdownEnd = point.date;
      maxDrawdownPeakValue = peak;
    }
  }

  let recoveryEnd: string | null = null;
  const troughIndex = equityCurve.findIndex((point) => point.date === maxDrawdownEnd);
  if (troughIndex >= 0) {
    for (let index = troughIndex + 1; index < equityCurve.length; index += 1) {
      if (equityCurve[index].strategy >= maxDrawdownPeakValue) {
        recoveryEnd = equityCurve[index].date;
        break;
      }
    }
  }

  const sharpe =
    annualizedVolatility !== null && annualizedVolatility > 0
      ? round((annualizedReturn - RISK_FREE_RATE) / annualizedVolatility)
      : null;
  const sortino =
    downside !== null && downside > 0
      ? round((annualizedReturn - RISK_FREE_RATE) / downside)
      : null;
  const calmar = maxDrawdown < 0 ? round(annualizedReturn / Math.abs(maxDrawdown)) : null;

  const closedTrades = trades.filter((trade) => trade.exit_reason !== "组合再平衡调仓");
  const winning = closedTrades.filter((trade) => trade.pnl > 0);
  const winRate = closedTrades.length > 0 ? round((winning.length / closedTrades.length) * 100) : null;
  const averageHoldingDays =
    closedTrades.length > 0
      ? Math.round(
          closedTrades.reduce((sum, trade) => sum + trade.holding_days, 0) / closedTrades.length,
        )
      : null;

  const benchmarkReturn = last.benchmark / initialCapital - 1;

  return {
    start_date: first.date,
    end_date: last.date,
    bars: equityCurve.length,
    total_return_pct: round(totalReturn * 100),
    annualized_return_pct: round(annualizedReturn * 100),
    annualized_volatility_pct: annualizedVolatility === null ? null : round(annualizedVolatility * 100),
    max_drawdown_pct: round(Math.abs(maxDrawdown) * 100),
    max_drawdown_start: maxDrawdownStart,
    max_drawdown_end: maxDrawdownEnd,
    max_drawdown_recovery_end: recoveryEnd,
    max_drawdown_recovery_complete: recoveryEnd !== null,
    sharpe,
    sortino,
    calmar,
    trade_count: strategyValues === "rebalance" ? trades.length : closedTrades.length,
    win_rate_pct: strategyValues === "rebalance" ? null : winRate,
    average_holding_days: strategyValues === "rebalance" ? null : averageHoldingDays,
    final_equity: round(last.strategy),
    benchmark_return_pct: round(benchmarkReturn * 100),
  };
}

/** 单标的策略回测：满仓买入 / 清仓卖出，信号次日开盘成交。 */
export function runSingleAssetBacktest(input: SingleAssetBacktestInput): SingleAssetBacktestOutput {
  const { bars, signals, initialCapital, feeRate, stampDutyRate, slippageRate } = input;
  const warnings: string[] = [];

  let cash = initialCapital;
  let shares = 0;
  let entryDate = "";
  let entryPrice = 0;
  let entryAmount = 0;
  const trades: BacktestTrade[] = [];
  const equityCurve: BacktestPoint[] = [];

  const firstClose = bars[0]?.close ?? 0;

  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    const previousSignal = index > 0 ? signals[index - 1] : null;

    if (previousSignal === "buy" && shares === 0 && cash > 0) {
      const price = bar.open * (1 + slippageRate);
      if (price > 0) {
        const fee = cash * feeRate;
        const investable = cash - fee;
        shares = investable / price;
        entryDate = bar.date;
        entryPrice = price;
        entryAmount = cash;
        cash = 0;
      }
    } else if (previousSignal === "sell" && shares > 0) {
      const price = bar.open * (1 - slippageRate);
      const proceeds = shares * price;
      const fee = proceeds * (feeRate + stampDutyRate);
      cash = proceeds - fee;
      trades.push({
        code: input.code,
        entry_date: entryDate,
        entry_price: round(entryPrice, 4),
        exit_date: bar.date,
        exit_price: round(price, 4),
        amount: round(entryAmount),
        pnl: round(cash - entryAmount),
        pnl_pct: entryAmount > 0 ? round(((cash - entryAmount) / entryAmount) * 100) : 0,
        holding_days: daysBetween(entryDate, bar.date),
        exit_reason: "策略卖出信号",
      });
      shares = 0;
      entryDate = "";
      entryPrice = 0;
      entryAmount = 0;
    }

    equityCurve.push({
      date: bar.date,
      strategy: round(cash + shares * bar.close),
      benchmark: round((initialCapital / firstClose) * bar.close),
    });
  }

  // 回测结束时仍有持仓：按最后收盘价结算，保证绩效口径完整。
  if (shares > 0) {
    const lastBar = bars[bars.length - 1];
    const price = lastBar.close * (1 - slippageRate);
    const proceeds = shares * price;
    const fee = proceeds * (feeRate + stampDutyRate);
    cash = proceeds - fee;
    trades.push({
      code: input.code,
      entry_date: entryDate,
      entry_price: round(entryPrice, 4),
      exit_date: lastBar.date,
      exit_price: round(price, 4),
      amount: round(entryAmount),
      pnl: round(cash - entryAmount),
      pnl_pct: entryAmount > 0 ? round(((cash - entryAmount) / entryAmount) * 100) : 0,
      holding_days: daysBetween(entryDate, lastBar.date),
      exit_reason: "回测结束强制平仓",
    });
    const lastPoint = equityCurve.at(-1);
    if (lastPoint) {
      lastPoint.strategy = round(cash);
    }
    warnings.push("回测结束时仍有持仓，已按最后收盘价强制结算，实际交易请自行决定平仓时机。");
  }

  if (bars.length < 60) {
    warnings.push(`样本仅 ${bars.length} 根 K 线，统计意义有限，建议拉长回测区间。`);
  }

  return {
    metrics: calculateBacktestMetrics(equityCurve, trades, initialCapital, "closed-trades"),
    equityCurve,
    trades,
    warnings,
  };
}

/** 生成调仓周期标识，用于判断是否跨周期。 */
function periodKey(date: string, rebalance: BacktestRebalance): string | null {
  if (rebalance === "none") {
    return null;
  }
  const [year, month] = date.split("-");
  if (rebalance === "yearly") {
    return year;
  }
  if (rebalance === "quarterly") {
    return `${year}-Q${Math.floor((Number(month) - 1) / 3) + 1}`;
  }
  return `${year}-${month}`;
}

/** 组合权重再平衡回测：按期调回目标权重，基准为不再平衡的买入持有。 */
export function runPortfolioRebalanceBacktest(
  input: PortfolioBacktestInput,
): SingleAssetBacktestOutput {
  const { items, barsByCode, rebalance, initialCapital, feeRate, stampDutyRate, slippageRate } = input;
  const warnings: string[] = [];

  // 只保留所有标的都有行情的交易日，避免对齐错位。
  const dateMaps = new Map<string, Map<string, BacktestBar>>();
  for (const item of items) {
    const bars = barsByCode[item.code] ?? [];
    dateMaps.set(item.code, new Map(bars.map((bar) => [bar.date, bar])));
  }
  const referenceCode = items[0]?.code ?? "";
  const referenceDates = (barsByCode[referenceCode] ?? []).map((bar) => bar.date);
  const commonDates = referenceDates.filter((date) =>
    items.every((item) => dateMaps.get(item.code)?.has(date)),
  );

  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);

  const shares = new Map<string, number>();
  let cash = initialCapital;
  // 建仓：按目标权重买入，计一次买入费用。
  for (const item of items) {
    const bar = dateMaps.get(item.code)?.get(commonDates[0]);
    if (!bar) {
      continue;
    }
    const target = (initialCapital * item.weight) / totalWeight;
    const price = bar.open * (1 + slippageRate);
    const fee = target * feeRate;
    shares.set(item.code, (target - fee) / price);
    cash -= target;
  }

  const equityCurve: BacktestPoint[] = [];
  const trades: BacktestTrade[] = [];
  let previousPeriodKey = periodKey(commonDates[0] ?? "", rebalance);
  let equityAtLastRebalance = initialCapital;
  let lastRebalanceDate = commonDates[0] ?? "";

  for (const date of commonDates) {
    const currentPeriodKey = periodKey(date, rebalance);
    const shouldRebalance =
      rebalance !== "none" && currentPeriodKey !== null && currentPeriodKey !== previousPeriodKey;

    if (shouldRebalance) {
      // 调仓价与估值口径统一使用开盘价（含滑点），避免用收盘价估值却在开盘价成交。
      const prices = new Map<string, number>();
      let equityBefore = cash;
      for (const item of items) {
        const bar = dateMaps.get(item.code)?.get(date);
        if (!bar) {
          continue;
        }
        const price = bar.open * (1 + slippageRate);
        prices.set(item.code, price);
        equityBefore += (shares.get(item.code) ?? 0) * price;
      }

      // 先按目标权重算名义调仓金额与费用，再按「权益 − 费用」等比缩放实际买入金额，
      // 否则调仓后现金会变成负数，净值口径也会与交易成本不一致。
      let tradedNotional = 0;
      // 调仓卖出部分需要额外计印花税，买入部分不计。
      let sellNotional = 0;
      const targets = items.map((item) => {
        const price = prices.get(item.code) ?? 0;
        const targetValue = (equityBefore * item.weight) / totalWeight;
        const delta = targetValue - (shares.get(item.code) ?? 0) * price;
        tradedNotional += Math.abs(delta);
        if (delta < 0) {
          sellNotional += Math.abs(delta);
        }
        return { code: item.code, price, targetValue };
      });
      const cost = tradedNotional * (feeRate + slippageRate) + sellNotional * stampDutyRate;
      const scale = equityBefore > 0 ? Math.max(equityBefore - cost, 0) / equityBefore : 1;
      for (const target of targets) {
        if (target.price > 0) {
          shares.set(target.code, (target.targetValue * scale) / target.price);
        }
      }
      cash = 0;

      trades.push({
        code: items.map((item) => item.code).join("+"),
        entry_date: lastRebalanceDate,
        entry_price: 0,
        exit_date: date,
        exit_price: 0,
        amount: round(tradedNotional),
        pnl: round(-cost),
        pnl_pct:
          equityAtLastRebalance > 0 ? round((-cost / equityAtLastRebalance) * 100) : 0,
        holding_days: daysBetween(lastRebalanceDate, date),
        exit_reason: "组合再平衡调仓",
      });
      equityAtLastRebalance = equityBefore - cost;
      lastRebalanceDate = date;
      previousPeriodKey = currentPeriodKey;
    }

    let equity = cash;
    let benchmark = 0;
    for (const item of items) {
      const bar = dateMaps.get(item.code)?.get(date);
      if (!bar) {
        continue;
      }
      equity += (shares.get(item.code) ?? 0) * bar.close;
      const firstBar = dateMaps.get(item.code)?.get(commonDates[0]);
      const firstPrice = firstBar?.close ?? bar.close;
      benchmark +=
        ((initialCapital * item.weight) / totalWeight) * (bar.close / firstPrice);
    }

    equityCurve.push({ date, strategy: round(equity), benchmark: round(benchmark) });
  }

  if (rebalance !== "none") {
    warnings.push("组合再平衡模式的交易明细为调仓记录，胜率与平均持有天数不适用。");
  }
  if (commonDates.length < 60) {
    warnings.push(`共同交易日仅 ${commonDates.length} 天，统计意义有限，建议拉长回测区间。`);
  }

  return {
    metrics: calculateBacktestMetrics(equityCurve, trades, initialCapital, "rebalance"),
    equityCurve,
    trades,
    warnings,
  };
}