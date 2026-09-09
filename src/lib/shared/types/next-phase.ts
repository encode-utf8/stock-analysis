// 下一阶段 MVP 底座契约：只新增，不改变既有字段语义。
// 供数据源状态、调度任务与对话流式事件等后续功能分支引用。

import type { AnalysisReport } from "./models";

/** 数据源可用状态。 */
export type DataSourceState = "online" | "degraded" | "offline";

/** 数据源健康状态快照，用于后续数据源监控与降级展示。 */
export interface DataSourceStatus {
  source: string;
  state: DataSourceState;
  healthy: boolean;
  latency_ms: number | null;
  last_checked_at: string;
  last_success_at: string | null;
  consecutive_failures: number;
  message?: string;
}

/** 调度任务目标类型。 */
export type SchedulerJobTarget = "quote" | "kline" | "news";

/** 调度任务配置，用于后续管理端配置定时刷新与清理。 */
export interface SchedulerJob {
  id: string;
  name: string;
  cron: string;
  target: SchedulerJobTarget;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  next_run_at: string | null;
}

/** 对话流式事件类型。 */
export type ChatStreamEventType = "meta" | "delta" | "tool" | "done" | "error";

/** 对话流式事件中的工具调用摘要。 */
export interface ChatStreamToolCall {
  name: string;
  summary: string;
}

/** 对话流式响应事件，用于前后端约定 SSE data 字段结构。 */
export interface ChatStreamEvent {
  type: ChatStreamEventType;
  content?: string;
  data?: {
    conversationId?: string;
    messageId?: string;
    message?: string;
    sources?: Array<{ title: string; url: string }>;
    riskNote?: string;
    toolCalls?: ChatStreamToolCall[];
    aiInvoked?: boolean;
  };
}

/** AI 分析流式事件类型。 */
export type AnalysisStreamEventType = "meta" | "delta" | "done" | "error";

/** AI 分析流式响应事件，用于前后端约定 SSE data 字段结构。 */
export interface AnalysisStreamEvent {
  type: AnalysisStreamEventType;
  content?: string;
  data?: {
    reportId?: string;
    message?: string;
    report?: AnalysisReport;
  };
}
