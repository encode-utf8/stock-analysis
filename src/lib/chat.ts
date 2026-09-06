// 对话助手编排：多轮上下文 + DeepSeek 流式输出 + function calling。
import { runAnalysis } from "@/lib/analysis";
import { getIndicators, getKlines, getMarketQuote, getStock } from "@/lib/market-data";
import { getNews } from "@/lib/news";
import { store } from "@/lib/store";
import type {
  AdjustType,
  AnalysisReport,
  Conversation,
  Kline,
  KlinePeriod,
  Message,
  NewsItem,
} from "@/lib/shared/types";
import type { ChatStreamEvent } from "@/lib/shared/types";

/** 对话请求结构。 */
export interface ChatRequest {
  code: string;
  conversationId?: string;
  message: string;
}

/** 对话回复结构，供 SSE 路由与页面使用。 */
export interface ChatReply {
  conversationId: string;
  messageId: string;
  content: string;
  sources: Array<{ title: string; url: string }>;
  riskNote: string;
  toolCalls: Array<{ name: string; summary: string }>;
}

const RISK_NOTE =
  "以上内容仅供学习参考，不构成投资建议；市场存在不确定性，请独立决策并自行承担盈亏。";

const MAX_TOOL_ROUNDS = 4;

type OpenAiRole = "system" | "user" | "assistant" | "tool";

interface OpenAiToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAiMessage {
  role: OpenAiRole;
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

interface ToolExecution {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  summary: string;
  resultText: string;
  sources: Array<{ title: string; url: string }>;
}

type DeepSeekStreamChunk =
  | { type: "delta"; content: string }
  | { type: "tool_calls"; toolCalls: RawToolCallDelta[] }
  | { type: "finish"; finishReason: string | null };

interface RawToolCallDelta {
  index: number;
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface DeepSeekResponseChoice {
  delta?: {
    content?: string | null;
    tool_calls?: RawToolCallDelta[];
  };
  finish_reason?: string | null;
}

interface DeepSeekResponse {
  choices?: DeepSeekResponseChoice[];
}

/** 生成短 id。 */
function shortId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 获取或创建会话。 */
async function resolveConversation(code: string, conversationId?: string): Promise<Conversation> {
  if (conversationId) {
    const existing = await store.conversations.getById(conversationId);
    if (existing) {
      return existing;
    }
  }

  const conversation: Conversation = {
    id: shortId("conv"),
    code,
    title: `${code} 盘面讨论`,
    created_at: new Date().toISOString(),
  };
  await store.conversations.create(conversation);
  return conversation;
}

/** 将历史消息整理为 LLM 上下文，保留时间线顺序。 */
function buildHistoryMessages(messages: Message[]): OpenAiMessage[] {
  return messages.slice(-12).map((item) => ({
    role: item.role === "user" ? "user" : "assistant",
    content: item.content,
  }));
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

const SYSTEM_PROMPT = [
  "你是股票盘面分析对话助手，使用中文 Markdown 回答。",
  "只能依据工具返回的真实数据作答，不得编造数据；必须标注数据来源，并在末尾附风险提示。",
  "禁止输出“必涨、必跌、稳赚、包赚、保本、一定涨、一定跌”等确定性收益承诺。",
  "用户询问行情、K 线、指标、新闻、报告或要求保存报告时，先调用对应工具，再基于结果作答。",
  "回答结构建议：核心结论、数据依据（带来源）、风险提示。",
].join("\n");

/** OpenAI/DeepSeek 兼容的 function calling 工具定义。 */
const CHAT_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_quote",
      description: "获取指定股票的最新行情快照，包括最新价、涨跌幅、成交额、估值等。",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "6 位股票代码；留空则使用当前股票" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_kline",
      description: "获取指定股票的历史 K 线数据，用于观察趋势、支撑与压力。",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "6 位股票代码；留空则使用当前股票" },
          period: { type: "string", enum: ["day", "week", "month", "minute"] },
          adjust: { type: "string", enum: ["qfq", "hfq", "none"] },
          limit: { type: "number", description: "K 线数量，默认 60" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_indicators",
      description: "获取 MA、MACD、KDJ、RSI、BOLL 等技术指标。",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "6 位股票代码；留空则使用当前股票" },
          period: { type: "string", enum: ["day", "week", "month", "minute"] },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_news",
      description: "搜索指定股票相关资讯，返回标题、来源、发布时间、情感倾向与链接。",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "6 位股票代码；留空则使用当前股票" },
          query: { type: "string", description: "搜索关键词，可为空" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_report",
      description: "读取指定股票已保存的分析报告。",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "6 位股票代码；留空则使用当前股票" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_report",
      description: "生成并保存一份新的分析报告，返回报告 ID 与摘要。",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "6 位股票代码；留空则使用当前股票" },
          prompt: { type: "string", description: "报告关注点或用户原始问题" },
        },
        required: [],
      },
    },
  },
] as const;

type ChatToolName = (typeof CHAT_TOOLS)[number]["function"]["name"];

/** 根据股票代码返回对应交易所官网链接，作为数据来源入口。 */
function exchangeSourceUrl(code: string): string {
  if (code.startsWith("6")) {
    return "https://www.sse.com.cn/";
  }
  if (code.startsWith("0") || code.startsWith("3")) {
    return "https://www.szse.cn/";
  }
  if (code.startsWith("4") || code.startsWith("8")) {
    return "https://www.bse.cn/";
  }
  return "https://www.sse.com.cn/";
}

function marketSource(code: string, label: string): Array<{ title: string; url: string }> {
  return [{ title: label, url: exchangeSourceUrl(code) }];
}

function numberText(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined || Number.isNaN(value) ? "暂无" : value.toFixed(digits);
}

function summarizeKlines(klines: Kline[]): string {
  if (klines.length === 0) {
    return "暂无 K 线数据。";
  }
  const recent = klines.slice(-10).map((item) => ({
    date: item.ts.slice(0, 10),
    close: item.close,
    high: item.high,
    low: item.low,
    volume: item.volume,
  }));
  return JSON.stringify({ count: klines.length, recent });
}

function summarizeNews(news: NewsItem[]): string {
  return JSON.stringify(
    news.map((item) => ({
      title: item.title,
      source: item.source,
      published_at: item.published_at,
      sentiment: item.sentiment,
      impact_days: item.impact_days,
      url: item.url,
    })),
  );
}

function summarizeReport(report: AnalysisReport | null): string {
  if (!report) {
    return JSON.stringify({ message: "暂无历史报告" });
  }
  return JSON.stringify({
    id: report.id,
    created_at: report.created_at,
    content_excerpt: report.content.slice(0, 500),
    risk_note: report.risk_note,
    news_refs_count: report.news_refs.length,
  });
}

/** 执行真实工具并返回可追踪记录。 */
async function executeTool(
  name: ChatToolName,
  rawArguments: string,
  request: ChatRequest,
): Promise<ToolExecution> {
  const argumentsObject = parseToolArguments(rawArguments);
  const code = request.code;

  if (name === "get_quote") {
    const [stock, quote] = await Promise.all([getStock(code), getMarketQuote(code)]);
    const summary = `${stock.name} 最新价 ${quote.price.toFixed(2)}，涨跌幅 ${quote.change_pct.toFixed(2)}%，来源 ${quote.source}`;
    return {
      id: shortId("call"),
      name,
      arguments: argumentsObject,
      summary,
      resultText: JSON.stringify({ code, name: stock.name, quote }),
      sources: marketSource(code, `${stock.name} 行情快照（${quote.source}）`),
    };
  }

  if (name === "get_kline") {
    const stock = await getStock(code);
    const period = toKlinePeriod(argumentsObject.period);
    const adjust = toAdjustType(argumentsObject.adjust);
    const limit = toLimit(argumentsObject.limit, 60);
    const klines = await getKlines(code, period, adjust, limit);
    return {
      id: shortId("call"),
      name,
      arguments: argumentsObject,
      summary: `读取 ${stock.name} ${klines.length} 条 ${period} K 线`,
      resultText: JSON.stringify({ code, name: stock.name, period, adjust, klines: JSON.parse(summarizeKlines(klines)) }),
      sources: marketSource(code, `${stock.name} ${period} K 线数据`),
    };
  }

  if (name === "get_indicators") {
    const stock = await getStock(code);
    const period = toKlinePeriod(argumentsObject.period);
    const indicators = await getIndicators(code, period);
    return {
      id: shortId("call"),
      name,
      arguments: argumentsObject,
      summary: `读取 MA/MACD/KDJ/RSI/BOLL 指标，MA5=${numberText(indicators.ma.ma5)}，RSI6=${numberText(indicators.rsi.rsi6, 1)}`,
      resultText: JSON.stringify({ code, name: stock.name, period, indicators }),
      sources: marketSource(code, `${stock.name} 技术指标`),
    };
  }

  if (name === "search_news") {
    const stock = await getStock(code);
    const news = await getNews(code);
    const sources = news.slice(0, 5).map((item) => ({ title: item.title, url: item.url }));
    return {
      id: shortId("call"),
      name,
      arguments: argumentsObject,
      summary: `读取 ${stock.name} ${news.length} 条资讯`,
      resultText: JSON.stringify({ code, name: stock.name, news: JSON.parse(summarizeNews(news)) }),
      sources: sources.length > 0 ? sources : marketSource(code, `${stock.name} 资讯检索`),
    };
  }

  if (name === "get_report") {
    const stock = await getStock(code);
    const reports = await store.analysisReports.listByCode(code);
    const latestReport = reports.at(0) ?? null;
    return {
      id: shortId("call"),
      name,
      arguments: argumentsObject,
      summary: latestReport ? `已读取历史报告 ${latestReport.id}` : "暂无历史报告",
      resultText: JSON.stringify({ code, name: stock.name, reports_count: reports.length, latest_report: JSON.parse(summarizeReport(latestReport)) }),
      sources: marketSource(code, `${stock.name} 分析报告`),
    };
  }

  const stock = await getStock(code);
  const prompt = typeof argumentsObject.prompt === "string" ? argumentsObject.prompt : request.message;
  const report = await runAnalysis(code, prompt);
  return {
    id: shortId("call"),
    name,
    arguments: argumentsObject,
    summary: `已生成并保存报告 ${report.id}`,
    resultText: JSON.stringify({ code, name: stock.name, report_id: report.id, created_at: report.created_at, content_excerpt: report.content.slice(0, 500), risk_note: report.risk_note }),
    sources: marketSource(code, `${stock.name} 新生成分析报告`),
  };
}

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // 参数为空或不是合法 JSON 时使用默认值。
  }
  return {};
}

function toKlinePeriod(value: unknown): KlinePeriod {
  if (value === "week" || value === "month" || value === "minute") {
    return value;
  }
  return "day";
}

function toAdjustType(value: unknown): AdjustType {
  if (value === "hfq" || value === "none") {
    return value;
  }
  return "qfq";
}

function toLimit(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(Math.max(Math.floor(value), 1), 120);
  }
  return fallback;
}

/** 流式请求 DeepSeek，逐块产出 delta 与 tool_calls。 */
async function* streamDeepSeekCompletion(messages: OpenAiMessage[]): AsyncGenerator<DeepSeekStreamChunk> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

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
        tools: CHAT_TOOLS,
        stream: true,
        temperature: 0.4,
      }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`DeepSeek 响应异常：${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const toolCallMap = new Map<number, RawToolCallDelta>();
    let finishReason: string | null = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const lines = block.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) {
            continue;
          }
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") {
            continue;
          }
          const event = JSON.parse(payload) as DeepSeekResponse;
          const choice = event.choices?.[0];
          if (!choice) {
            continue;
          }
          if (typeof choice.finish_reason === "string") {
            finishReason = choice.finish_reason;
          }
          const delta = choice.delta;
          if (delta?.content) {
            yield { type: "delta", content: delta.content };
          }
          if (delta?.tool_calls) {
            for (const incoming of delta.tool_calls) {
              const existing = toolCallMap.get(incoming.index) ?? { index: incoming.index };
              const merged: RawToolCallDelta = {
                index: incoming.index,
                id: incoming.id ?? existing.id,
                type: incoming.type ?? existing.type,
                function: {
                  name: incoming.function?.name ?? existing.function?.name,
                  arguments: `${existing.function?.arguments ?? ""}${incoming.function?.arguments ?? ""}`,
                },
              };
              toolCallMap.set(incoming.index, merged);
            }
          }
        }
      }
    }

    if (buffer.trim()) {
      const line = buffer.trim();
      if (line.startsWith("data:")) {
        const payload = line.slice(5).trim();
        if (payload && payload !== "[DONE]") {
          const event = JSON.parse(payload) as DeepSeekResponse;
          const choice = event.choices?.[0];
          if (choice?.delta?.content) {
            yield { type: "delta", content: choice.delta.content };
          }
          if (typeof choice?.finish_reason === "string") {
            finishReason = choice.finish_reason;
          }
        }
      }
    }

    if (toolCallMap.size > 0) {
      yield {
        type: "tool_calls",
        toolCalls: Array.from(toolCallMap.values()).sort((a, b) => a.index - b.index),
      };
    }
    yield { type: "finish", finishReason };
  } finally {
    clearTimeout(timer);
  }
}

/** 将工具执行记录转换为可持久化结构。 */
function buildToolCallRecord(execution: ToolExecution): Record<string, unknown> {
  return {
    id: execution.id,
    name: execution.name,
    arguments: execution.arguments,
    summary: execution.summary,
    result: execution.resultText,
    fetched_at: new Date().toISOString(),
  };
}

/** 从工具执行结果汇总引用来源。 */
function collectSources(executions: ToolExecution[]): ChatReply["sources"] {
  const seen = new Set<string>();
  const sources: ChatReply["sources"] = [];
  for (const execution of executions) {
    for (const source of execution.sources) {
      const key = `${source.title}|${source.url}`;
      if (!seen.has(key)) {
        seen.add(key);
        sources.push(source);
      }
    }
  }
  return sources.slice(0, 8);
}

/** 兜底回答：无 DeepSeek 密钥或调用失败时仍基于真实工具数据作答。 */
async function buildFallbackReply(request: ChatRequest): Promise<{
  content: string;
  executions: ToolExecution[];
}> {
  const executions: ToolExecution[] = [];
  const toolNames: ChatToolName[] = ["get_quote", "get_kline", "get_indicators", "search_news", "get_report"];
  for (const name of toolNames) {
    executions.push(await executeTool(name, "{}", request));
  }
  if (/保存报告|生成报告|再分析|分析一下/.test(request.message)) {
    executions.push(await executeTool("save_report", JSON.stringify({ prompt: request.message }), request));
  }

  const quote = await getMarketQuote(request.code);
  const stock = await getStock(request.code);
  const content = [
    `你问的是“${request.message}”。我已结合 ${stock.name} 的当前可用行情、指标、资讯与报告进行整理。`,
    "",
    "### 数据概览",
    `- 最新价：${quote.price.toFixed(2)}，涨跌幅 ${quote.change_pct.toFixed(2)}%。`,
    `- 行情来源：${quote.source}，获取时间 ${new Date(quote.fetched_at).toLocaleString("zh-CN")}。`,
    ...executions.map((item) => `- ${item.name}：${item.summary}`),
    "",
    "### 风险提示",
    RISK_NOTE,
  ].join("\n");

  return { content, executions };
}

/** 替换确定性收益承诺，确保回答合规。 */
function sanitizeForbiddenPromises(text: string): string {
  const patterns = [
    /必涨/g,
    /必跌/g,
    /稳赚/g,
    /包赚/g,
    /保本/g,
    /一定(?:上涨|涨|下跌|跌)/g,
    /必然(?:上涨|涨|下跌|跌)/g,
  ];
  let sanitized = text;
  for (const pattern of patterns) {
    sanitized = sanitized.replace(pattern, "存在不确定性");
  }
  return sanitized;
}

/** 流式执行对话，产出 SSE 事件。 */
export async function* streamChat(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
  const conversation = await resolveConversation(request.code, request.conversationId);
  const history = await store.messages.listByConversation(conversation.id);

  const userMessage: Message = {
    id: shortId("msg"),
    conversation_id: conversation.id,
    role: "user",
    content: request.message,
    tool_calls: null,
    created_at: new Date().toISOString(),
  };
  await store.messages.insert(userMessage);

  const assistantMessageId = shortId("msg");
  const systemContent = `${SYSTEM_PROMPT}\n当前股票代码：${request.code}。用户若未另行指定，默认针对该股票分析；需要行情、K 线、指标、资讯或报告时请直接调用对应工具。`;
  const llmMessages: OpenAiMessage[] = [
    { role: "system", content: systemContent },
    ...buildHistoryMessages(history),
    { role: "user", content: request.message },
  ];

  yield { type: "meta", data: { conversationId: conversation.id } };

  const executions: ToolExecution[] = [];
  const toolCalls: ChatReply["toolCalls"] = [];
  let content = "";

  if (!deepSeekEnabled()) {
    const fallback = await buildFallbackReply(request);
    executions.push(...fallback.executions);
    content = sanitizeForbiddenPromises(fallback.content);
    yield { type: "delta", content };
  } else {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const roundToolCalls: OpenAiToolCall[] = [];
      let roundContent = "";

      for await (const chunk of streamDeepSeekCompletion(llmMessages)) {
        if (chunk.type === "delta") {
          roundContent += chunk.content;
          content += chunk.content;
          yield { type: "delta", content: chunk.content };
        } else if (chunk.type === "tool_calls") {
          for (const raw of chunk.toolCalls) {
            if (!raw.id || !raw.function?.name) {
              continue;
            }
            roundToolCalls.push({
              id: raw.id,
              type: "function",
              function: {
                name: raw.function.name,
                arguments: raw.function.arguments ?? "{}",
              },
            });
          }
        }
      }

      if (roundToolCalls.length === 0) {
        break;
      }

      llmMessages.push({
        role: "assistant",
        content: roundContent || null,
        tool_calls: roundToolCalls,
      });

      for (const call of roundToolCalls) {
        const execution = await executeTool(
          call.function.name as ChatToolName,
          call.function.arguments,
          request,
        );
        executions.push(execution);
        toolCalls.push({ name: execution.name, summary: execution.summary });
        llmMessages.push({
          role: "tool",
          content: execution.resultText,
          tool_call_id: call.id,
        });
      }

      yield { type: "tool", data: { toolCalls } };
    }

    content = sanitizeForbiddenPromises(content);
    if (!content.trim()) {
      const fallback = await buildFallbackReply(request);
      content = sanitizeForbiddenPromises(fallback.content);
      if (!executions.length) {
        executions.push(...fallback.executions);
      }
    }
  }

  const assistantMessage: Message = {
    id: assistantMessageId,
    conversation_id: conversation.id,
    role: "assistant",
    content,
    tool_calls: executions.map((execution) => buildToolCallRecord(execution)),
    created_at: new Date().toISOString(),
  };
  await store.messages.insert(assistantMessage);

  const sources = collectSources(executions);
  yield {
    type: "done",
    data: {
      conversationId: conversation.id,
      messageId: assistantMessage.id,
      sources,
      riskNote: RISK_NOTE,
    },
  };
}

/** 获取会话及消息时间线。 */
export async function getConversationTimeline(conversationId: string): Promise<{
  conversation: Conversation;
  messages: Message[];
} | null> {
  const conversation = await store.conversations.getById(conversationId);
  if (!conversation) {
    return null;
  }
  const messages = await store.messages.listByConversation(conversationId);
  return { conversation, messages };
}

/** 获取某股票全部会话（供时间线列表）。 */
export async function listConversations(code: string): Promise<Conversation[]> {
  return store.conversations.listByCode(code);
}

/** 删除会话及其消息；不存在时返回 false。 */
export async function deleteConversation(conversationId: string): Promise<boolean> {
  const conversation = await store.conversations.getById(conversationId);
  if (!conversation) {
    return false;
  }

  await store.messages.deleteByConversation(conversationId);
  await store.conversations.delete(conversationId);
  return true;
}

/** 非流式入口，供需要一次性结果的调用方使用。 */
export async function runChat(request: ChatRequest): Promise<{
  conversationId: string;
  userMessage: Message;
  assistantMessage: Message;
  reply: ChatReply;
}> {
  const userMessage: Message = {
    id: shortId("msg"),
    conversation_id: request.conversationId ?? "",
    role: "user",
    content: request.message,
    tool_calls: null,
    created_at: new Date().toISOString(),
  };

  const assistantMessage: Message = {
    id: shortId("msg"),
    conversation_id: request.conversationId ?? "",
    role: "assistant",
    content: "",
    tool_calls: [],
    created_at: new Date().toISOString(),
  };
  let finalReply: ChatReply = {
    conversationId: request.conversationId ?? "",
    messageId: assistantMessage.id,
    content: "",
    sources: [],
    riskNote: RISK_NOTE,
    toolCalls: [],
  };

  for await (const event of streamChat(request)) {
    if (event.type === "delta" && event.content) {
      assistantMessage.content += event.content;
    } else if (event.type === "done" && event.data) {
      finalReply = {
        conversationId: event.data.conversationId ?? finalReply.conversationId,
        messageId: event.data.messageId ?? finalReply.messageId,
        content: assistantMessage.content,
        sources: event.data.sources ?? [],
        riskNote: event.data.riskNote ?? RISK_NOTE,
        toolCalls: [],
      };
    }
  }

  return {
    conversationId: finalReply.conversationId,
    userMessage,
    assistantMessage: {
      ...assistantMessage,
      conversation_id: finalReply.conversationId,
      id: finalReply.messageId,
    },
    reply: finalReply,
  };
}
