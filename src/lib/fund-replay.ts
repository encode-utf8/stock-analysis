// 基金历史复盘：汇总某基金在时间窗口内的 AI 分析与对话记录。
// 统计口径仅用于学习，不提供收益承诺，也不引入资讯方向命中率等误导性结论。
import { fundAiStore } from "@/lib/fund-ai-store";
import { normalizeFundCode } from "@/lib/fund-market";
import type {
  FundAnalysisReport,
  FundConversation,
  FundMessage,
  FundReplaySummary,
} from "@/lib/shared/types";

/** 基金复盘时间线中的分析事件。 */
export interface FundReplayAnalysisEvent {
  type: "analysis";
  id: string;
  code: string;
  occurred_at: string;
  report: FundAnalysisReport;
}

/** 基金复盘时间线中的对话事件。 */
export interface FundReplayConversationEvent {
  type: "conversation";
  id: string;
  code: string;
  occurred_at: string;
  conversation: FundConversation;
  messages: FundMessage[];
}

/** 基金复盘时间线事件联合类型。 */
export type FundReplayTimelineEvent =
  | FundReplayAnalysisEvent
  | FundReplayConversationEvent;

/** 基金复盘时间线返回结构。 */
export interface FundReplayTimeline {
  code: string;
  period_start: string;
  period_end: string;
  generated_at: string;
  events: FundReplayTimelineEvent[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 将 days 参数规范化为 1-365 的整数。 */
export function normalizeFundReplayDays(raw: string | null, fallback = 30): number {
  const parsed = Number(raw ?? fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(parsed), 1), 365);
}

/** 构造最近 N 天的复盘窗口。 */
export function getFundReplayWindow(days: number, now = new Date()): {
  period_start: string;
  period_end: string;
} {
  const endMs = now.getTime();
  return {
    period_start: new Date(endMs - days * DAY_MS).toISOString(),
    period_end: now.toISOString(),
  };
}

function isInWindow(value: string, startMs: number, endMs: number): boolean {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp >= startMs && timestamp <= endMs;
}

/** 汇总某基金在时间窗口内的复盘统计。 */
export async function getFundReplaySummary(
  code: string,
  days: number,
  now = new Date(),
): Promise<FundReplaySummary> {
  const normalizedCode = normalizeFundCode(code);
  if (!normalizedCode) {
    throw new Error("请输入合法的 6 位基金代码。");
  }

  const { period_start, period_end } = getFundReplayWindow(days, now);
  const [reports, conversations] = await Promise.all([
    fundAiStore.reports.listByCode(normalizedCode),
    fundAiStore.conversations.listByCode(normalizedCode),
  ]);

  const startMs = new Date(period_start).getTime();
  const endMs = new Date(period_end).getTime();

  return {
    code: normalizedCode,
    period_start,
    period_end,
    total_analysis: reports.filter((item) => isInWindow(item.created_at, startMs, endMs)).length,
    total_chats: conversations.filter((item) => isInWindow(item.created_at, startMs, endMs)).length,
    generated_at: now.toISOString(),
  };
}

/** 获取某基金在时间窗口内的分析与对话时间线。 */
export async function getFundReplayTimeline(
  code: string,
  days: number,
  now = new Date(),
): Promise<FundReplayTimeline> {
  const normalizedCode = normalizeFundCode(code);
  if (!normalizedCode) {
    throw new Error("请输入合法的 6 位基金代码。");
  }

  const { period_start, period_end } = getFundReplayWindow(days, now);
  const [reports, conversations] = await Promise.all([
    fundAiStore.reports.listByCode(normalizedCode),
    fundAiStore.conversations.listByCode(normalizedCode),
  ]);

  const startMs = new Date(period_start).getTime();
  const endMs = new Date(period_end).getTime();
  const reportsInWindow = reports.filter((item) => isInWindow(item.created_at, startMs, endMs));
  const conversationsInWindow = conversations.filter((item) =>
    isInWindow(item.created_at, startMs, endMs),
  );

  const conversationEvents: FundReplayConversationEvent[] = await Promise.all(
    conversationsInWindow.map(async (conversation) => {
      const messages = await fundAiStore.messages.listByConversation(conversation.id);
      return {
        type: "conversation",
        id: conversation.id,
        code: conversation.code,
        occurred_at: conversation.created_at,
        conversation,
        messages: messages.filter((message) =>
          isInWindow(message.created_at, startMs, endMs),
        ),
      };
    }),
  );

  const analysisEvents: FundReplayAnalysisEvent[] = reportsInWindow.map((report) => ({
    type: "analysis",
    id: report.id,
    code: report.code,
    occurred_at: report.created_at,
    report,
  }));

  const events: FundReplayTimelineEvent[] = [...analysisEvents, ...conversationEvents].sort(
    (a, b) => b.occurred_at.localeCompare(a.occurred_at),
  );

  return {
    code: normalizedCode,
    period_start,
    period_end,
    generated_at: now.toISOString(),
    events,
  };
}
