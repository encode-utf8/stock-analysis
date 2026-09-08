// 基金对话助手编排：围绕当前基金数据做多轮中文问答，并持久化到基金内存仓库。
import { getFundProfile } from "@/lib/fund-data";
import { getFundIntraday } from "@/lib/fund-intraday";
import { getFundHoldings } from "@/lib/fund-holdings";
import { getFundMetrics } from "@/lib/fund-metrics";
import { fundAiStore } from "@/lib/fund-ai-store";
import { recordExternalCall, recordTaskRun } from "@/lib/observability";
import type { ChatStreamEvent, FundConversation, FundMessage } from "@/lib/shared/types";

const RISK_NOTE =
  "以上内容仅供学习参考，不构成投资建议；基金数据可能存在延迟或估算误差，请独立决策并自行承担盈亏。";
const FUND_CHAT_TIMEOUT_MS = 45_000;

export interface FundChatRequest {
  code: string;
  conversationId?: string;
  message: string;
}

function shortId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function deepSeekEnabled(): boolean {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  return Boolean(apiKey && apiKey !== "replace-me");
}

function deepSeekBaseUrl(): string {
  return (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
}

function deepSeekModel(): string {
  return process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
}

function numberText(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "暂无";
  }
  return value.toFixed(digits);
}

function percent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "暂无";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

async function resolveConversation(code: string, conversationId?: string): Promise<FundConversation> {
  if (conversationId) {
    const existing = await fundAiStore.conversations.getById(conversationId);
    if (existing) {
      return existing;
    }
  }

  const conversation: FundConversation = {
    id: shortId("fund-conv"),
    code,
    title: `${code} 基金讨论`,
    created_at: new Date().toISOString(),
  };
  await fundAiStore.conversations.create(conversation);
  return conversation;
}

function buildHistoryMessages(messages: FundMessage[]): Array<{ role: "user" | "assistant"; content: string }> {
  return messages.slice(-12).map((item) => ({
    role: item.role === "user" ? "user" : "assistant",
    content: item.content,
  }));
}

async function buildFundContext(code: string): Promise<Record<string, unknown>> {
  const [profile, intraday, holdings, metrics] = await Promise.all([
    getFundProfile(code),
    getFundIntraday(code),
    getFundHoldings(code),
    getFundMetrics(code, "1y"),
  ]);
  return { profile, intraday, holdings, one_year_metrics: metrics };
}

function buildSystemPrompt(context: Record<string, unknown>): string {
  const profile = context.profile as { name?: string; code?: string; type?: string } | undefined;
  const intraday = context.intraday as { mode?: string; change_pct?: number | null } | undefined;
  const holdings = context.holdings as { report_date?: string; top_holdings?: unknown[] } | undefined;

  const facts = [
    `当前基金：${profile?.name ?? ""}（${profile?.code ?? ""}），类型 ${profile?.type ?? "未知"}。`,
    intraday?.mode === "realtime"
      ? "场内实时行情数据已提供。"
      : "场外盘中估算数据已提供，估算值不等于官方净值。",
    `持仓报告期：${holdings?.report_date ?? "暂无"}；持仓披露存在滞后。`,
    `前十大持仓条数：${holdings?.top_holdings?.length ?? 0}。`,
  ].join("\n");

  return [
    "你是基金学习与对话助手，使用中文 Markdown 回答。",
    "只能基于当前基金上下文与历史对话回答，不得编造基金数据；必须说明数据来源和时效性。",
    "禁止输出“必涨、必跌、稳赚、包赚、保本、一定涨、一定跌”等确定性收益承诺。",
    "回答结构建议：核心结论、数据依据、风险提示。",
    facts,
  ].join("\n");
}

function buildUserMessage(context: Record<string, unknown>, history: Array<{ role: "user" | "assistant"; content: string }>, message: string): Array<{ role: string; content: string }> {
  return [
    { role: "system", content: buildSystemPrompt(context) },
    ...history,
    { role: "user", content: `基金上下文：${JSON.stringify(context)}\n用户问题：${message}` },
  ];
}

interface DeepSeekStreamResponse {
  choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
}

async function* streamDeepSeekFundChat(messages: Array<{ role: string; content: string }>, signal?: AbortSignal): AsyncGenerator<string> {
  if (!deepSeekEnabled()) {
    return;
  }

  const controller = new AbortController();
  const abortFromSignal = () => controller.abort();
  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", abortFromSignal, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), FUND_CHAT_TIMEOUT_MS);

  try {
    const response = await fetch(`${deepSeekBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: deepSeekModel(),
        messages,
        temperature: 0.4,
        max_tokens: 1800,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`DeepSeek 响应异常：${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        for (const line of block.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) {
            continue;
          }
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") {
            continue;
          }
          const event = JSON.parse(payload) as DeepSeekStreamResponse;
          const content = event.choices?.[0]?.delta?.content;
          if (content) {
            yield content;
          }
        }
      }
    }
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith("data:")) {
        const payload = trimmed.slice(5).trim();
        if (payload && payload !== "[DONE]") {
          const event = JSON.parse(payload) as DeepSeekStreamResponse;
          const content = event.choices?.[0]?.delta?.content;
          if (content) {
            yield content;
          }
        }
      }
    }
    recordExternalCall(true);
  } catch (error) {
    recordExternalCall(false);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromSignal);
  }
}

function buildFallbackReply(request: FundChatRequest, context: Record<string, unknown>): string {
  const profile = context.profile as { name?: string; code?: string; manager?: string | null; company?: string | null } | undefined;
  const intraday = context.intraday as { mode?: string; change_pct?: number | null; price?: number | null; estimated_nav?: number | null } | undefined;
  const metrics = context.one_year_metrics as { max_drawdown_pct?: number; current_drawdown_pct?: number; annualized_return_pct?: number | null } | undefined;

  const intradayText = intraday?.mode === "realtime"
    ? `最新价 ${numberText(intraday.price, 4)}，涨跌幅 ${percent(intraday.change_pct)}`
    : `盘中估算涨跌幅 ${percent(intraday?.change_pct)}，非官方净值`;

  return [
    `### ${profile?.name ?? ""}（${profile?.code ?? ""}）基金问答`,
    "",
    "> 本次 AI 调用未成功，已降级为本地基金数据摘要。",
    "",
    `- 当日表现：${intradayText}。`,
    `- 近 1 年最大回撤：${metrics?.max_drawdown_pct !== undefined ? `${numberText(metrics.max_drawdown_pct)}%` : "暂无"}。`,
    `- 当前回撤：${metrics?.current_drawdown_pct !== undefined ? `${numberText(metrics.current_drawdown_pct)}%` : "暂无"}。`,
    `- 近 1 年年化收益：${percent(metrics?.annualized_return_pct)}。`,
    "",
    `用户问题：${request.message}`,
    "",
    RISK_NOTE,
  ].join("\n");
}

/** 流式基金对话入口。 */
export async function* streamFundChat(
  request: FundChatRequest,
  signal?: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
  recordTaskRun("chat");
  const conversation = await resolveConversation(request.code, request.conversationId);
  const history = await fundAiStore.messages.listByConversation(conversation.id);
  const context = await buildFundContext(request.code);

  const userMessage: FundMessage = {
    id: shortId("fund-msg"),
    conversation_id: conversation.id,
    role: "user",
    content: request.message,
    tool_calls: null,
    created_at: new Date().toISOString(),
  };
  await fundAiStore.messages.insert(userMessage);

  yield { type: "meta", data: { conversationId: conversation.id, messageId: userMessage.id } };

  let content = "";
  if (deepSeekEnabled()) {
    try {
      const messages = buildUserMessage(context, buildHistoryMessages(history), request.message);
      for await (const chunk of streamDeepSeekFundChat(messages, signal)) {
        content += chunk;
        yield { type: "delta", content: chunk };
      }
    } catch {
      content = "";
    }
  }

  if (!content.trim()) {
    content = buildFallbackReply(request, context);
    yield { type: "delta", content };
  }

  const assistantMessage: FundMessage = {
    id: shortId("fund-msg"),
    conversation_id: conversation.id,
    role: "assistant",
    content,
    tool_calls: [],
    created_at: new Date().toISOString(),
  };
  await fundAiStore.messages.insert(assistantMessage);

  yield {
    type: "done",
    data: {
      conversationId: conversation.id,
      messageId: assistantMessage.id,
      sources: [],
      riskNote: RISK_NOTE,
    },
  };
}

/** 获取基金会话时间线。 */
export async function getFundConversationTimeline(conversationId: string): Promise<{
  conversation: FundConversation;
  messages: FundMessage[];
} | null> {
  const conversation = await fundAiStore.conversations.getById(conversationId);
  if (!conversation) {
    return null;
  }
  const messages = await fundAiStore.messages.listByConversation(conversationId);
  return { conversation, messages };
}

/** 获取基金历史会话列表。 */
export async function listFundConversations(code: string): Promise<FundConversation[]> {
  return fundAiStore.conversations.listByCode(code);
}

/** 删除基金会话及消息。 */
export async function deleteFundConversation(conversationId: string): Promise<boolean> {
  const conversation = await fundAiStore.conversations.getById(conversationId);
  if (!conversation) {
    return false;
  }
  await fundAiStore.messages.deleteByConversation(conversationId);
  await fundAiStore.conversations.delete(conversationId);
  return true;
}
