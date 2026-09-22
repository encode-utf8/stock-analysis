// 数据模型共享类型：冻结自 docs/design.md 第 6 节。
// 后续分支如需扩展，先在本模块新增并注明 TODO，不得破坏已有字段语义。

import type { DegradedSnapshotInfo } from "./datasource";

/** 股票市场标识。 */
export type ExchangeCode = "SH" | "SZ" | "BJ";

/** K 线周期。 */
export type KlinePeriod = "day" | "week" | "month" | "minute";

/** K 线复权类型。 */
export type AdjustType = "qfq" | "hfq" | "none";

/** 资讯情感倾向。 */
export type NewsSentiment = "positive" | "negative" | "neutral";

/** 资讯生命周期状态。 */
export type NewsStatus = "active" | "expired" | "archived" | "pending";

/** 对话消息角色。 */
export type MessageRole = "user" | "assistant" | "system";

/** 定时任务运行状态。 */
export type JobStatus = "pending" | "running" | "success" | "failed";

/** 股票元数据。 */
export interface Stock {
  code: string;
  name: string;
  exchange: ExchangeCode;
  industry: string | null;
  meta: Record<string, unknown> | null;
}

/** 当前行情快照。 */
export interface MarketQuote {
  code: string;
  ts: string;
  price: number;
  change_pct: number;
  open: number;
  high: number;
  low: number;
  prev_close: number;
  volume: number;
  amount: number;
  turnover_rate: number | null;
  pe: number | null;
  pb: number | null;
  market_cap: number | null;
  float_cap: number | null;
  source: string;
  fetched_at: string;
  /** 数据源故障、回退本地官方快照时的降级标注。 */
  degraded_snapshot?: DegradedSnapshotInfo;
}

/** K 线数据点。 */
export interface Kline {
  code: string;
  period: KlinePeriod;
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
  adj_type: AdjustType;
  /** 数据来源；旧数据或降级数据可能缺失。 */
  source?: string;
  /** 抓取时间；旧数据或降级数据可能缺失。 */
  fetched_at?: string;
  /** 数据源故障、回退本地官方快照时的降级标注。 */
  degraded_snapshot?: DegradedSnapshotInfo;
}

/** 资讯条目。 */
export interface NewsItem {
  id: string;
  code: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  published_at: string;
  fetched_at: string;
  sentiment: NewsSentiment;
  confidence: number;
  impact_days: number;
  expire_at: string;
  tags: string[];
  status: NewsStatus;
  pinned: boolean;
  /** 数据源故障、回退本地官方资讯快照时的降级标注。 */
  degraded_snapshot?: DegradedSnapshotInfo;
}

/** AI 分析报告。 */
export interface AnalysisReport {
  id: string;
  code: string;
  created_at: string;
  data_snapshot: Record<string, unknown> | null;
  news_refs: string[];
  content: string;
  risk_note: string;
}

/** 会话。 */
export interface Conversation {
  id: string;
  code: string;
  title: string;
  created_at: string;
}

/** 会话消息。 */
export interface Message {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  tool_calls: Record<string, unknown>[] | null;
  created_at: string;
}

/** 定时任务运行记录。 */
export interface JobRun {
  id: string;
  job_name: string;
  status: JobStatus;
  started_at: string;
  finished_at: string | null;
  detail: Record<string, unknown> | null;
}
