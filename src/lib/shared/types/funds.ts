// 基金工作台共享类型：冻结自 docs/fund-workbench-design.md 第 6.1 节。
// 后续分支如需扩展，先在本模块新增并注明 TODO，不得破坏已冻结字段语义。

import type { MessageRole, NewsItem } from "./models";

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
  max_drawdown_recovery_start: string;
  max_drawdown_recovery_end: string | null;
  max_drawdown_recovery_complete: boolean;
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

/** 基金 AI 分析报告。 */
export interface FundAnalysisReport {
  id: string;
  code: string;
  created_at: string;
  data_snapshot: Record<string, unknown> | null;
  source_refs: Array<{ label: string; value: string }>;
  content: string;
  risk_note: string;
}

/** 基金会话。 */
export interface FundConversation {
  id: string;
  code: string;
  title: string;
  created_at: string;
}

/** 基金会话消息。 */
export interface FundMessage {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  tool_calls: Record<string, unknown>[] | null;
  created_at: string;
}

/** 基金 AI 分析流式事件类型。 */
export type FundAnalysisStreamEventType = "meta" | "delta" | "done" | "error";

/** 基金 AI 分析流式响应事件。 */
export interface FundAnalysisStreamEvent {
  type: FundAnalysisStreamEventType;
  content?: string;
  data?: {
    reportId?: string;
    message?: string;
    report?: FundAnalysisReport;
  };
}

/** 基金资讯类型。 */
export type FundNewsType = "announcement" | "report" | "market";

/** 基金资讯条目。 */
export interface FundNewsItem extends NewsItem {
  news_type: FundNewsType;
}

/** 自选基金条目：与个股自选列表隔离，仅保存展示与切换所需元数据。 */
export interface FundWatchlistItem {
  code: string;
  name: string;
  type: FundType;
  trading_mode: FundTradingMode;
  group: string;
  added_at: string;
  sort_order: number;
  note: string | null;
}

/** 基金历史复盘统计摘要。 */
export interface FundReplaySummary {
  code: string;
  period_start: string;
  period_end: string;
  total_analysis: number;
  total_chats: number;
  generated_at: string;
}

/** 基金对比单项：聚合档案、最新净值、区间表现与风险指标。 */
export interface FundComparisonItem {
  code: string;
  name: string;
  type: FundType;
  trading_mode: FundTradingMode;
  latest_nav_date: string | null;
  latest_cumulative_nav: number | null;
  latest_change_pct: number | null;
  period_return_pct: number | null;
  annualized_return_pct: number | null;
  annualized_volatility_pct: number | null;
  max_drawdown_pct: number | null;
  current_drawdown_pct: number | null;
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  source: string;
  fetched_at: string;
}

/** 基金对比返回快照。 */
export interface FundComparisonSnapshot {
  range: string;
  generated_at: string;
  items: FundComparisonItem[];
}

/** 基金组合分析模式：百分比权重或持仓份额。 */
export type FundPortfolioMode = "weight" | "shares";

/** 基金组合单项：展示权重/持仓份额与单基金同区间指标。 */
export interface FundPortfolioItem {
  code: string;
  name: string;
  weight_pct: number;
  holding_shares: number | null;
  holding_amount: number | null;
  initial_nav: number | null;
  latest_nav: number | null;
  latest_value: number | null;
  profit_loss: number | null;
  profit_loss_pct: number | null;
  period_return_pct: number | null;
  annualized_return_pct: number | null;
  annualized_volatility_pct: number | null;
  max_drawdown_pct: number | null;
  sharpe: number | null;
  calmar: number | null;
}

/** 基金组合分析摘要。 */
export interface FundPortfolioSummary {
  mode: FundPortfolioMode;
  range: string;
  generated_at: string;
  total_holding_amount: number | null;
  total_latest_value: number | null;
  total_profit_loss: number | null;
  total_return_pct: number | null;
  annualized_return_pct: number | null;
  annualized_volatility_pct: number | null;
  max_drawdown_pct: number | null;
  current_drawdown_pct: number | null;
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  items: FundPortfolioItem[];
}
