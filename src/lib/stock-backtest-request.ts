// 回测请求解析与校验：把接口入参整理成引擎可直接消费的规格。
// 与引擎分离，便于单独单测校验规则，也避免路由层堆积业务逻辑。

import { normalizeStockCode } from "@/lib/market";
import { BACKTEST_LIMITS, BACKTEST_STRATEGY_DEFAULTS } from "@/lib/shared/types";
import type {
  BacktestPeriod,
  BacktestRebalance,
  BacktestRequest,
  BacktestStrategyId,
} from "@/lib/shared/types";
import {
  buildBollBreakoutSignals,
  buildMacdCrossSignals,
  buildMaCrossSignals,
  buildRsiReversalSignals,
  type BarSignal,
} from "@/lib/stock-backtest";

const STRATEGIES: BacktestStrategyId[] = [
  "ma-cross",
  "macd-cross",
  "rsi-reversal",
  "boll-breakout",
  "portfolio-rebalance",
];
const REBALANCE_OPTIONS: BacktestRebalance[] = ["none", "monthly", "quarterly", "yearly"];
const MIN_BARS = BACKTEST_LIMITS.min_bars;

/** 归一化后的回测规格。 */
export interface NormalizedBacktestRequest {
  strategy: BacktestStrategyId;
  period: BacktestPeriod;
  /** 单标的策略的代码；组合策略为 null。 */
  code: string | null;
  /** 需要拉取行情的全部代码。 */
  codes: string[];
  /** 组合策略的标的与权重；单标的策略为空数组。 */
  items: Array<{ code: string; weight: number }>;
  /** 组合再平衡频率；单标的策略为 null。 */
  rebalance: BacktestRebalance | null;
  start: string | null;
  end: string | null;
  limit: number;
  initialCapital: number;
  feeRate: number;
  stampDutyRate: number;
  slippageRate: number;
  paramsLabel: string;
  /** 依据收盘价生成信号，供引擎调用。 */
  buildSignals: (closes: number[]) => BarSignal[];
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 解析数字参数，缺失时用默认值，非法时返回 null。 */
function resolveNumber(value: unknown, fallback: number): number | null {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/** 解析整数参数并做区间校验，越界返回 null。 */
function resolveInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number | null {
  const resolved = resolveNumber(value, fallback);
  if (resolved === null || !Number.isInteger(resolved) || resolved < min || resolved > max) {
    return null;
  }
  return resolved;
}

/** 按周期与区间推算需要拉取的 K 线根数。 */
export function resolveKlineLimit(
  period: BacktestPeriod,
  start: string | null,
  end: string | null,
): number {
  const endTime = end ? new Date(`${end}T00:00:00Z`).getTime() : Date.now();
  const startTime = start
    ? new Date(`${start}T00:00:00Z`).getTime()
    : endTime - 2 * 365 * 86_400_000;
  const days = Math.max((endTime - startTime) / 86_400_000, 30);
  // 交易日约占自然日的 70%，再加 40 根缓冲给均线与指标预热。
  const bars = period === "day" ? days * 0.7 : (days / 7) * 0.72;
  return Math.min(Math.max(Math.ceil(bars) + 40, BACKTEST_LIMITS.limit.min), BACKTEST_LIMITS.limit.max);
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** 校验并归一化回测请求。 */
export function normalizeBacktestRequest(
  input: unknown,
): { value: NormalizedBacktestRequest } | { error: string } {
  const body = (input ?? {}) as BacktestRequest;
  const strategy = body.strategy;
  if (!STRATEGIES.includes(strategy)) {
    return { error: "不支持的策略，可选值：双均线、MACD、RSI、布林带、组合再平衡。" };
  }

  const period: BacktestPeriod = body.period === "week" ? "week" : "day";

  const initialCapital = resolveNumber(body.initial_capital, 100_000);
  if (initialCapital === null || initialCapital < 10_000 || initialCapital > 1e9) {
    return { error: "初始资金需在 1 万到 10 亿之间。" };
  }

  const feeRate = resolveNumber(body.fee_rate, 0.00025);
  const stampDutyRate = resolveNumber(body.stamp_duty_rate, 0.0005);
  const slippageRate = resolveNumber(body.slippage_rate, 0.001);
  for (const [label, rate] of [
    ["手续费率", feeRate],
    ["印花税率", stampDutyRate],
    ["滑点率", slippageRate],
  ] as const) {
    if (rate === null || rate < 0 || rate > 0.01) {
      return { error: `${label}需在 0 到 1% 之间。` };
    }
  }

  if (body.start !== undefined && body.start !== null && !isDate(body.start)) {
    return { error: "起始日期格式应为 YYYY-MM-DD。" };
  }
  if (body.end !== undefined && body.end !== null && !isDate(body.end)) {
    return { error: "结束日期格式应为 YYYY-MM-DD。" };
  }
  const start = (body.start as string | null | undefined) ?? null;
  const end = (body.end as string | null | undefined) ?? null;
  if (start && end && start > end) {
    return { error: "起始日期不能晚于结束日期。" };
  }

  const params = body.params ?? {};

  if (strategy === "portfolio-rebalance") {
    const defaults = BACKTEST_STRATEGY_DEFAULTS["portfolio-rebalance"];
    const rebalance = params.rebalance ?? defaults.rebalance ?? "quarterly";
    if (!REBALANCE_OPTIONS.includes(rebalance)) {
      return { error: "再平衡频率只支持 不再平衡 / 每月 / 每季度 / 每年。" };
    }

    const rawItems = Array.isArray(params.items) ? params.items : [];
    if (
      rawItems.length < BACKTEST_LIMITS.min_portfolio_items ||
      rawItems.length > BACKTEST_LIMITS.max_portfolio_items
    ) {
      return {
        error: `组合再平衡需要 ${BACKTEST_LIMITS.min_portfolio_items}-${BACKTEST_LIMITS.max_portfolio_items} 个标的。`,
      };
    }

    const items: Array<{ code: string; weight: number }> = [];
    for (const raw of rawItems) {
      const code = typeof raw?.code === "string" ? normalizeStockCode(raw.code) : null;
      if (!code) {
        return { error: "组合中存在非法的沪深北 A 股 6 位代码。" };
      }
      if (items.some((item) => item.code === code)) {
        return { error: `组合中代码 ${code} 重复。` };
      }
      const weight = resolveNumber(raw?.weight, Number.NaN);
      if (weight === null || !Number.isFinite(weight) || weight <= 0 || weight > 100) {
        return { error: `代码 ${code} 的权重需为 0 到 100 之间的数字。` };
      }
      items.push({ code, weight: round(weight) });
    }

    const limit = resolveKlineLimit(period, start, end);
    const rebalanceLabel =
      rebalance === "none"
        ? "不再平衡"
        : rebalance === "monthly"
          ? "每月再平衡"
          : rebalance === "quarterly"
            ? "每季度再平衡"
            : "每年再平衡";

    return {
      value: {
        strategy,
        period,
        code: null,
        codes: items.map((item) => item.code),
        items,
        rebalance,
        start,
        end,
        limit,
        initialCapital: round(initialCapital),
        feeRate: feeRate ?? 0,
        stampDutyRate: stampDutyRate ?? 0,
        slippageRate: slippageRate ?? 0,
        paramsLabel: `${rebalanceLabel}｜${items
          .map((item) => `${item.code} ${item.weight}%`)
          .join(" / ")}`,
        buildSignals: () => [],
      },
    };
  }

  const code = typeof body.code === "string" ? normalizeStockCode(body.code) : null;
  if (!code) {
    return { error: "请输入合法的沪深北 A 股 6 位代码。" };
  }

  const buildWithLabel = (
    label: string,
    build: (closes: number[]) => BarSignal[],
  ): { value: NormalizedBacktestRequest } => ({
    value: {
      strategy,
      period,
      code,
      codes: [code],
      items: [],
      rebalance: null,
      start,
      end,
      limit: resolveKlineLimit(period, start, end),
      initialCapital: round(initialCapital),
      feeRate: feeRate ?? 0,
      stampDutyRate: stampDutyRate ?? 0,
      slippageRate: slippageRate ?? 0,
      paramsLabel: label,
      buildSignals: build,
    },
  });

  if (strategy === "ma-cross") {
    const defaults = BACKTEST_STRATEGY_DEFAULTS["ma-cross"];
    const fast = resolveInteger(params.fast, defaults.fast ?? 5, BACKTEST_LIMITS.fast.min, BACKTEST_LIMITS.fast.max);
    const slow = resolveInteger(params.slow, defaults.slow ?? 20, BACKTEST_LIMITS.slow.min, BACKTEST_LIMITS.slow.max);
    if (fast === null || slow === null) {
      return { error: "均线周期超出允许范围（快线 2-120，慢线 3-250）。" };
    }
    if (fast >= slow) {
      return { error: "快线周期必须小于慢线周期。" };
    }
    return buildWithLabel(`MA${fast}/MA${slow}`, (closes) => buildMaCrossSignals(closes, fast, slow));
  }

  if (strategy === "macd-cross") {
    const defaults = BACKTEST_STRATEGY_DEFAULTS["macd-cross"];
    const fast = resolveInteger(params.fast, defaults.fast ?? 12, BACKTEST_LIMITS.fast.min, BACKTEST_LIMITS.fast.max);
    const slow = resolveInteger(params.slow, defaults.slow ?? 26, BACKTEST_LIMITS.slow.min, BACKTEST_LIMITS.slow.max);
    const signal = resolveInteger(params.signal, defaults.signal ?? 9, BACKTEST_LIMITS.signal.min, BACKTEST_LIMITS.signal.max);
    if (fast === null || slow === null || signal === null) {
      return { error: "MACD 周期超出允许范围（快线 2-120，慢线 3-250，信号线 2-60）。" };
    }
    if (fast >= slow) {
      return { error: "MACD 快线周期必须小于慢线周期。" };
    }
    return buildWithLabel(`MACD ${fast}/${slow}/${signal}`, (closes) =>
      buildMacdCrossSignals(closes, fast, slow, signal),
    );
  }

  if (strategy === "rsi-reversal") {
    const defaults = BACKTEST_STRATEGY_DEFAULTS["rsi-reversal"];
    const rsiPeriod = resolveInteger(params.period, defaults.period ?? 14, BACKTEST_LIMITS.period.min, BACKTEST_LIMITS.period.max);
    const oversold = resolveInteger(params.oversold, defaults.oversold ?? 30, BACKTEST_LIMITS.oversold.min, BACKTEST_LIMITS.oversold.max);
    const overbought = resolveInteger(params.overbought, defaults.overbought ?? 70, BACKTEST_LIMITS.overbought.min, BACKTEST_LIMITS.overbought.max);
    if (rsiPeriod === null || oversold === null || overbought === null) {
      return { error: "RSI 参数超出允许范围（周期 2-120，超卖 5-45，超买 55-95）。" };
    }
    if (oversold >= overbought) {
      return { error: "超卖阈值必须小于超买阈值。" };
    }
    return buildWithLabel(`RSI${rsiPeriod} 超卖${oversold}/超买${overbought}`, (closes) =>
      buildRsiReversalSignals(closes, rsiPeriod, oversold, overbought),
    );
  }

  const defaults = BACKTEST_STRATEGY_DEFAULTS["boll-breakout"];
  const bollPeriod = resolveInteger(params.period, defaults.period ?? 20, BACKTEST_LIMITS.period.min, BACKTEST_LIMITS.period.max);
  const multiplier = resolveNumber(params.multiplier, defaults.multiplier ?? 2);
  if (bollPeriod === null || multiplier === null || multiplier < BACKTEST_LIMITS.multiplier.min || multiplier > BACKTEST_LIMITS.multiplier.max) {
    return { error: "布林带参数超出允许范围（周期 2-120，倍数 1-4）。" };
  }
  return buildWithLabel(`BOLL ${bollPeriod}×${round(multiplier)}`, (closes) =>
    buildBollBreakoutSignals(closes, bollPeriod, multiplier),
  );
}

export { MIN_BARS };