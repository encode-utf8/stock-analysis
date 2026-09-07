// 基金工作台共享类型：冻结自 docs/fund-workbench-design.md 第 6.1 节。
// 后续分支如需扩展，先在本模块新增并注明 TODO，不得破坏已冻结字段语义。

/** 基金类型。 */
export type FundType =
  | "stock"
  | "hybrid"
  | "index"
  | "bond"
  | "qdii"
  | "fof"
  | "reits"
  | "other";

/** 基金交易模式：场外申赎或场内交易。 */
export type FundTradingMode = "otc" | "exchange";

/** 基金当日行情模式：场内实时或场外盘中估算。 */
export type FundIntradayMode = "realtime" | "estimate";

/** 基金档案。 */
export interface FundProfile {
  code: string;
  name: string;
  type: FundType;
  trading_mode: FundTradingMode;
  manager: string | null;
  company: string | null;
  benchmark: string | null;
  establish_date: string | null;
  scale: number | null;
  risk_level: string | null;
  source: string;
  fetched_at: string;
}

/** 历史净值数据点。 */
export interface FundNavPoint {
  code: string;
  nav_date: string;
  unit_nav: number;
  cumulative_nav: number;
  daily_change_pct: number | null;
  source: string;
  fetched_at: string;
}

/** 基金当日行情：场内实时价或场外估算净值。 */
export interface FundIntraday {
  code: string;
  mode: FundIntradayMode;
  ts: string;
  price: number | null;
  estimated_nav: number | null;
  change_pct: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  amount: number | null;
  iopv: number | null;
  premium_rate: number | null;
  official_nav: number | null;
  official_nav_date: string | null;
  source: string;
  fetched_at: string;
}

/** 基金前十大持仓单项。 */
export interface FundHoldingItem {
  code: string | null;
  name: string;
  weight_pct: number;
  change_pct: number | null;
  industry: string | null;
}

/** 最新季度持仓与资产配置。 */
export interface FundHoldings {
  code: string;
  report_date: string;
  published_at: string | null;
  top_holdings: FundHoldingItem[];
  asset_allocation: Record<string, number>;
  industry_allocation: Record<string, number>;
  top10_weight_pct: number | null;
  top1_weight_pct: number | null;
  source: string;
  fetched_at: string;
}

/** 基于历史净值本地计算的基金风险指标。 */
export interface FundRiskMetrics {
  code: string;
  range: string;
  start_date: string;
  end_date: string;
  max_drawdown_pct: number;
  max_drawdown_start: string;
  max_drawdown_end: string;
  current_drawdown_pct: number;
  longest_recovery_days: number | null;
  average_recovery_days: number | null;
  current_recovery_progress_pct: number | null;
  annualized_return_pct: number | null;
  annualized_volatility_pct: number | null;
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  updated_at: string;
}
