// Agent 执行轨迹契约：供对话与分析流式链路在运行期上报步骤与耗时。
// 约定：轨迹是运行期临时数据，不落库、不回放；本模块只新增字段，不改动既有事件语义。

/** 轨迹步骤类型：区分编排层的不同行为，供前端选择图标与配色。 */
export type AgentTraceStepKind = "thinking" | "tool" | "data" | "model" | "guard" | "persist";

/** 步骤与整轮状态。 */
export type AgentTraceStatus = "running" | "success" | "failed" | "skipped" | "aborted";

/** 轨迹作用域：标明这是哪个功能的执行。 */
export type AgentTraceScope = "stock-chat" | "stock-analysis" | "fund-chat" | "fund-analysis";

/** 单步轨迹。 */
export interface AgentTraceStep {
  id: string;
  /** 从 1 开始的展示顺序。 */
  index: number;
  kind: AgentTraceStepKind;
  /** 中文可读名，例如「读取行情快照」；thinking 步骤固定为 Thinking。 */
  label: string;
  /** 参数或结果摘要，已截断，且不含密钥与原始提示词。 */
  detail?: string;
  status: AgentTraceStatus;
  /** 工具循环轮次；非多轮链路为空。 */
  round?: number;
  /** ISO 时间，服务端时钟。 */
  started_at: string;
  finished_at?: string;
  duration_ms?: number;
  /** 仅模型与 thinking 步骤：首字时延。 */
  ttft_ms?: number;
  /** 失败摘要，已截断。 */
  error?: string;
}

/** 单次执行的完整轨迹快照。 */
export interface AgentTraceRun {
  run_id: string;
  scope: AgentTraceScope;
  /** 股票 / 基金代码。 */
  target: string;
  status: AgentTraceStatus;
  started_at: string;
  finished_at?: string;
  duration_ms?: number;
  steps: AgentTraceStep[];
  /** 步骤数达到上限被截断时为 true。 */
  truncated?: boolean;
}

/** 客户端轨迹留存策略：默认结束后清除，可切换为折叠保留。 */
export type AgentTracePolicy = "ephemeral" | "keep-collapsed";
