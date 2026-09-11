// 个股策略回测共享契约：仅新增，不修改既有字段语义。
// 回测为纯历史数据推演，仅用于学习，不构成任何投资建议。

/** 单标的策略标识。 */
export type BacktestStrategyId =
  | "ma-cross"
  | "macd-cross"
  | "rsi-reversal"
  | "boll-breakout"
  | "portfolio-rebalance";

/** 回测 K 线周期：只支持日线与周线，避免分钟级噪声与上游压力。 */
export type BacktestPeriod = "day" | "week";

/** 组合再平衡频率。 */
export type BacktestRebalance = "none" | "monthly" | "quarterly" | "yearly";

/** 回测参数集合：按策略取用其中若干字段，未使用字段会被忽略。 */
export interface BacktestParams {
  /** 双均线快线周期。 */
  fast?: number;
  /** 双均线慢线周期 / MACD 慢线周期。 */
  slow?: number;
  /** MACD 信号线周期。 */
  signal?: number;
  /** RSI / 布林带统计周期。 */
  period?: number;
  /** RSI 超卖阈值。 */
  oversold?: number;
  /** RSI 超买阈值。 */
  overbought?: number;
  /** 布林带标准差倍数。 */
  multiplier?: number;
  /** 组合再平衡频率。 */
  rebalance?: BacktestRebalance;
  /** 组合标的与目标权重（百分比口径）。 */
  items?: Array<{ code: string; weight: number }>;
}

/** 回测请求。 */
export interface BacktestRequest {
  /** 单标的策略必填；组合再平衡策略改用 params.items。 */
  code?: string;
  strategy: BacktestStrategyId;
  period: BacktestPeriod;
  /** 起始日期（YYYY-MM-DD），缺省表示按 limit 取最近若干根。 */
  start?: string | null;
  /** 结束日期（YYYY-MM-DD），缺省表示到最新一根。 */
  end?: string | null;
  /** 单标的请求的 K 线根数上限，缺省按区间自动推算。 */
  limit?: number;
  initial_capital?: number;
  fee_rate?: number;
  stamp_duty_rate?: number;
  slippage_rate?: number;
  params?: BacktestParams;
}

/** 一笔完整交易（含回测结束时的强制平仓）。 */
export interface BacktestTrade {
  code: string;
  entry_date: string;
  entry_price: number;
  exit_date: string;
  exit_price: number;
  /** 该笔投入金额。 */
  amount: number;
  pnl: number;
  pnl_pct: number;
  holding_days: number;
  exit_reason: string;
}

/** 回测绩效指标。 */
export interface BacktestMetrics {
  start_date: string;
  end_date: string;
  bars: number;
  total_return_pct: number;
  annualized_return_pct: number;
  annualized_volatility_pct: number | null;
  max_drawdown_pct: number;
  max_drawdown_start: string;
  max_drawdown_end: string;
  max_drawdown_recovery_end: string | null;
  max_drawdown_recovery_complete: boolean;
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  trade_count: number;
  win_rate_pct: number | null;
  average_holding_days: number | null;
  final_equity: number;
  /** 同期买入持有收益，用于对照策略是否真的更优。 */
  benchmark_return_pct: number;
}

/** 净值曲线上的一个点：策略与基准都按同一初始资金折算。 */
export interface BacktestPoint {
  date: string;
  strategy: number;
  benchmark: number;
}

/** 回测结果。 */
export interface BacktestResult {
  strategy: BacktestStrategyId;
  strategy_label: string;
  period: BacktestPeriod;
  /** 单标的策略返回该代码，组合策略返回 null。 */
  code: string | null;
  codes: string[];
  params_label: string;
  /** 复权口径固定为前复权，避免除权跳空造成假信号。 */
  adjust: "qfq";
  initial_capital: number;
  fee_rate: number;
  stamp_duty_rate: number;
  slippage_rate: number;
  metrics: BacktestMetrics;
  equity_curve: BacktestPoint[];
  trades: BacktestTrade[];
  warnings: string[];
  generated_at: string;
}

/** 策略中文名。 */
export const BACKTEST_STRATEGY_LABELS: Record<BacktestStrategyId, string> = {
  "ma-cross": "双均线金叉死叉",
  "macd-cross": "MACD 金叉死叉",
  "rsi-reversal": "RSI 超买超卖反转",
  "boll-breakout": "布林带突破",
  "portfolio-rebalance": "组合权重再平衡",
};

/** 策略默认参数，界面与校验共用同一份默认值。 */
export const BACKTEST_STRATEGY_DEFAULTS: Record<BacktestStrategyId, BacktestParams> = {
  "ma-cross": { fast: 5, slow: 20 },
  "macd-cross": { fast: 12, slow: 26, signal: 9 },
  "rsi-reversal": { period: 14, oversold: 30, overbought: 70 },
  "boll-breakout": { period: 20, multiplier: 2 },
  "portfolio-rebalance": { rebalance: "quarterly", items: [] },
};

/** 交易成本与资金默认值（A 股常见口径的简化假设）。 */
export const BACKTEST_DEFAULTS = {
  initial_capital: 100_000,
  min_initial_capital: 10_000,
  fee_rate: 0.00025,
  stamp_duty_rate: 0.0005,
  slippage_rate: 0.001,
} as const;

/** 参数合法区间，供接口校验与界面输入约束共用。 */
export const BACKTEST_LIMITS = {
  fast: { min: 2, max: 120 },
  slow: { min: 3, max: 250 },
  signal: { min: 2, max: 60 },
  period: { min: 2, max: 120 },
  oversold: { min: 5, max: 45 },
  overbought: { min: 55, max: 95 },
  multiplier: { min: 1, max: 4 },
  limit: { min: 60, max: 1500 },
  min_bars: 30,
  max_portfolio_items: 5,
  min_portfolio_items: 2,
} as const;
