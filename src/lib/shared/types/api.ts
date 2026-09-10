// 统一 API 响应与错误类型：冻结自 docs/design.md 第 7 节统一返回约定。
// 所有 mock 路由与后续真实实现都必须使用这里的包装结构。

import type {
  AdjustType,
  AnalysisReport,
  Conversation,
  JobRun,
  Kline,
  KlinePeriod,
  MarketQuote,
  NewsItem,
  Stock,
} from "./models";

/** 统一成功响应。 */
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

/** 统一错误码：各模块可在需要时扩展具体枚举值。 */
export type ApiErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CODE_NOT_FOUND"
  | "UPSTREAM_ERROR"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

/** 统一错误响应。 */
export interface ApiError {
  success: false;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

/** 所有 JSON 接口的统一响应。 */
export type ApiResponse<T> = ApiSuccess<T> | ApiError;

/** 技术指标快照（盘面展示接口的返回结构，非持久化模型）。 */
export interface TechnicalIndicators {
  code: string;
  period: KlinePeriod;
  updated_at: string;
  ma: {
    ma5: number | null;
    ma10: number | null;
    ma20: number | null;
    ma60: number | null;
  };
  macd: {
    dif: number | null;
    dea: number | null;
    histogram: number | null;
  };
  kdj: {
    k: number | null;
    d: number | null;
    j: number | null;
  };
  rsi: {
    rsi6: number | null;
    rsi12: number | null;
    rsi24: number | null;
  };
  boll: {
    upper: number | null;
    middle: number | null;
    lower: number | null;
  };
}

/** K 线查询参数。 */
export interface KlineQuery {
  period?: KlinePeriod;
  adjust?: AdjustType;
  limit?: number;
}

/** 触发 AI 分析的请求体。 */
export interface AnalysisRequest {
  prompt?: string;
}

/** 管理任务刷新请求体。 */
export interface AdminRefreshRequest {
  code?: string;
  target?: "quote" | "kline" | "news";
}

/** 管理任务清理请求体。 */
export interface AdminCleanupRequest {
  before?: string;
  dry_run?: boolean;
}

/** 冻结后的接口返回类型别名，便于后续分支直接引用。 */
export type StockResponse = ApiResponse<Stock>;
export type QuoteResponse = ApiResponse<MarketQuote>;
export type KlineResponse = ApiResponse<Kline[]>;
export type IndicatorsResponse = ApiResponse<TechnicalIndicators>;
export type NewsListResponse = ApiResponse<NewsItem[]>;
export type AnalysisResponse = ApiResponse<AnalysisReport>;
export type ReportsResponse = ApiResponse<AnalysisReport[]>;
export type ConversationResponse = ApiResponse<Conversation>;
export type AdminJobResponse = ApiResponse<JobRun>;

