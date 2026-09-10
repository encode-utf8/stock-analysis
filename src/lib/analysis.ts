// AI 分析编排：读取行情/指标/资讯后生成教学式报告，并持久化到 store 与 R2 快照。
import { recordExternalCall, recordTaskRun } from "@/lib/observability";
import { getIndicators, getKlines, getMarketQuote, getStock } from "@/lib/market-data";
import { saveAnalysisSnapshot } from "@/lib/r2";
import { store } from "@/lib/store";
import type {
  AnalysisStreamEvent,
  AnalysisReport,
  Kline,
  MarketQuote,
  NewsItem,
  Stock,
  TechnicalIndicators,
} from "@/lib/shared/types";

/** 单次 AI 分析的默认超时时间；复杂中文报告需要比普通请求更宽裕的生成窗口。 */
const DEFAULT_ANALYSIS_TIMEOUT_MS = 45_000;

/** 读取可选环境变量，覆盖 AI 分析超时时间，避免正常报告因超时被回退。 */
function analysisTimeoutMs(): number {
  const configured = Number(process.env.DEEPSEEK_ANALYSIS_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 10_000
    ? configured
    : DEFAULT_ANALYSIS_TIMEOUT_MS;
}

/** 生成稳定的报告编号。 */
function buildReportId(code: string): string {
  return `report-${code}-${Date.now()}`;
}

/** 判断文本是否包含确定性收益承诺；报告生成器必须避免这些表达。 */
function hasForbiddenPromise(text: string): boolean {
  const forbidden = /必然(上涨|下跌|涨|跌)|必(涨|跌)|一定(涨|跌)|稳赚|包赚|保本|稳赢/;
  const disclaimer = /不|非|勿|无|没|未|风险|承诺|免责|请勿|不得|不能|不会|不应|不代表|不构成|不意味着/;
  const sentences = text.split(/(?<=[。！？\n])/);
  return sentences.some((sentence) => !disclaimer.test(sentence) && forbidden.test(sentence));
}

function sentimentText(item: NewsItem): string {
  if (item.sentiment === "positive") {
    return "利好";
  }
  if (item.sentiment === "negative") {
    return "利空";
  }
  return "中性";
}

/** 构建报告中的来源与影响周期清单。 */
function buildSourceSection(news: NewsItem[]): string {
  if (news.length === 0) {
    return "暂无有效资讯来源。";
  }
  const lines = news.slice(0, 12).map((item, index) => {
    const urlText = item.url ? ` 来源链接：${item.url}` : "";
    return `- ${index + 1}. ${item.title}（${item.source}，${sentimentText(item)}，影响约 ${item.impact_days} 天）${urlText}`;
  });
  return ["### 来源与影响周期", ...lines].join("\n");
}

/** 构建本地确定性报告正文。 */
function buildFallbackReport(
  code: string,
  stockName: string,
  quote: MarketQuote,
  indicators: TechnicalIndicators,
  news: NewsItem[],
  klines: Kline[],
): string {
  const price = quote.price.toFixed(2);
  const change = quote.change_pct.toFixed(2);
  const positiveCount = news.filter((item) => item.sentiment === "positive").length;
  const negativeCount = news.filter((item) => item.sentiment === "negative").length;
  const neutralCount = news.filter((item) => item.sentiment === "neutral").length;
  const ma5 = indicators.ma.ma5?.toFixed(2) ?? "暂无";
  const ma20 = indicators.ma.ma20?.toFixed(2) ?? "暂无";
  const rsi6 = indicators.rsi.rsi6?.toFixed(1) ?? "暂无";
  const latestKlines = klines.slice(-5);
  const recentKlineText = latestKlines
    .map(
      (item) =>
        `${item.ts.slice(0, 10)} 收 ${item.close.toFixed(2)}、量 ${(item.volume / 10000).toFixed(1)} 万`,
    )
    .join("；");
  const periodReturn =
    klines.length >= 2
      ? (((klines.at(-1)?.close ?? 0) / (klines.at(-2)?.close ?? 1) - 1) * 100).toFixed(2)
      : "暂无";
  const avgVolume =
    latestKlines.length > 0
      ? latestKlines.reduce((sum, item) => sum + item.volume, 0) / latestKlines.length
      : 0;
  const latestVolume = latestKlines.at(-1)?.volume ?? 0;
  const volumeRatio = avgVolume > 0 ? (latestVolume / avgVolume).toFixed(2) : "暂无";
  const numericMa5 = Number(ma5);
  const numericMa20 = Number(ma20);
  const numericRsi6 = Number(rsi6);
  const trendText =
    Number.isFinite(numericMa5) && Number.isFinite(numericMa20)
      ? numericMa5 > numericMa20
        ? "MA5 位于 MA20 上方，短期趋势偏强"
        : "MA5 位于 MA20 下方，短期趋势偏弱"
      : "均线数据不足";
  const rsiText =
    Number.isFinite(numericRsi6)
      ? numericRsi6 > 70
        ? "RSI6 偏高，短线情绪偏热"
        : numericRsi6 < 30
          ? "RSI6 偏低，短线情绪偏冷"
          : "RSI6 处于中性区间"
      : "RSI 数据不足";
  const topNews = news.slice(0, 5).map((item, index) => {
    const sentiment =
      item.sentiment === "positive" ? "利好" : item.sentiment === "negative" ? "利空" : "中性";
    return `  - ${index + 1}. ${item.title}（${item.source}，${sentiment}，影响约 ${item.impact_days} 天）`;
  });

  return [
    `## ${stockName}（${code}）分析`,
    "",
    "> 本次未生成 AI 报告，以下为本地数据摘要，仅用于基础盘面核对。",
    "",
    "### 数据面",
    `- 最新价：${price}，当日涨跌幅 ${change}%。`,
    `- 当前行情来源：${quote.source}，数据获取时间：${new Date(quote.fetched_at).toLocaleString("zh-CN")}。`,
    `- MA5：${ma5}，MA20：${ma20}，RSI6：${rsi6}。`,
    `- 近 5 个交易日：${recentKlineText || "暂无 K 线数据"}。`,
    `- 区间涨跌：${periodReturn}%；最新成交量 / 近 5 日均量：${volumeRatio}。`,
    `- 趋势观察：${trendText}；${rsiText}。`,
    "指标只用于观察价格趋势与强弱，不等同于买卖信号。",
    "",
    "### 消息面",
    `- 共梳理 ${news.length} 条资讯：利好 ${positiveCount} 条、利空 ${negativeCount} 条、中性 ${neutralCount} 条。`,
    "- 每条资讯均带来源与影响周期；短期信息默认观察 7 天，长期信息观察 30 天。",
    ...(topNews.length > 0
      ? ["", "近期重点资讯：", ...topNews]
      : ["", "- 暂无重点资讯。"]),
    "",
    "### 情绪面",
    "- 当前多空信息交织，应结合成交量与价格位置观察市场是否形成一致性预期。",
    "- 情绪面只能作为辅助，不能替代基本面与风险承受能力评估。",
    "",
    "### 教学讲解",
    "看盘时先看趋势，再看量价配合，最后回到公司基本面和消息验证。价格短期的随机波动很高，",
    "关键不是预测每一次涨跌，而是识别驱动因素、风险点与自己能承受的边界。",
    "",
    "### 风险提示",
    "- 本报告不构成任何投资建议，不构成必然上涨或下跌的预测。",
    "- 所有结论仅供学习参考，用户需独立决策并自行承担盈亏。",
    "",
    buildSourceSection(news),
  ].join("\n");
}

/** 将数字中的千分位、空格与中文标点归一化，避免格式差异造成误判。 */
function normalizeForMatch(text: string): string {
  return text.replace(/[,\s，。]/g, "");
}

/** 判断正文是否出现了给定数值的常见格式化形式。 */
function includesAnyNumber(content: string, values: number[]): boolean {
  const normalized = normalizeForMatch(content);
  return values.some((value) => {
    if (!Number.isFinite(value)) {
      return false;
    }
    return [value.toFixed(2), value.toFixed(1), value.toFixed(0)].some((candidate) =>
      normalized.includes(candidate),
    );
  });
}

/** 用标题或摘要片段判断模型是否引用过该条资讯，允许适度改写。 */
function hasTextOverlap(content: string, text: string): boolean {
  const normalized = normalizeForMatch(content);
  const compact = normalizeForMatch(text);
  if (!compact) {
    return false;
  }
  return [compact.slice(0, 10), compact.slice(0, 6), compact.slice(-6)].some(
    (snippet) => snippet.length >= 2 && normalized.includes(snippet),
  );
}

/** 判断 LLM 输出是否落到了给定股票的具体数据，而不是通用套话。 */
function isConcreteAnalysis(
  content: string,
  code: string,
  stockName: string,
  quote: MarketQuote,
  news: NewsItem[],
): boolean {
  const normalized = normalizeForMatch(content);
  const hasCodeOrName = content.includes(code) || (stockName && content.includes(stockName));
  if (!hasCodeOrName) {
    return false;
  }
  const hasDataNumber = includesAnyNumber(content, [
    quote.price,
    quote.change_pct,
    quote.open,
    quote.high,
    quote.low,
    quote.prev_close,
  ]);
  const hasNewsReference = news.some(
    (item) =>
      (item.source && normalized.includes(normalizeForMatch(item.source))) ||
      (item.title && hasTextOverlap(content, item.title)) ||
      (item.summary && hasTextOverlap(content, item.summary)),
  );
  const numericCount = (content.match(/\d+(?:\.\d+)?/g) ?? []).length;
  return numericCount >= 3 && (hasDataNumber || hasNewsReference);
}

/** 判断 DeepSeek 是否已配置真实密钥。 */
export function deepSeekConfigured(): boolean {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  return Boolean(apiKey && apiKey !== "replace-me");
}

export function deepSeekBaseUrl(): string {
  return (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
}

export function deepSeekModel(): string {
  return process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
}

/** 构建分析报告的模型提示词，流式与非流式共用同一份数据。 */
function buildAnalysisMessages(
  stock: Stock,
  quote: MarketQuote,
  indicators: TechnicalIndicators,
  news: NewsItem[],
  klines: Kline[],
  prompt: string,
): { system: string; user: string } {
  const system = [
    "你是职业投资者视角的教学式分析助手。",
    "必须引用给定股票代码、最新价、涨跌幅、K 线、资讯标题或来源，禁止只输出通用套话。",
    "不要只统计利好/利空/中性条数，也不要复述 JSON；必须解释数据之间的因果关系、市场情绪与风险点。",
    "必须引用来源和影响周期，必须给出风险提示。",
    "禁止输出“必然涨/必然跌/必涨/必跌/稳赚/包赚”等确定性收益承诺。",
    "使用中文 Markdown 输出，包含：数据面、消息面、情绪面、教学讲解、风险提示、来源与影响周期。",
  ].join("\n");
  const user = [
    "请根据以下数据生成教学式分析报告：",
    `股票：${stock.name}（${stock.code}），行业：${stock.industry ?? "未知"}`,
    `行情：${JSON.stringify(quote)}`,
    `指标：${JSON.stringify(indicators)}`,
    `近 20 个 K 线：${JSON.stringify(
      klines.slice(-20).map((item) => ({
        ts: item.ts,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
        volume: item.volume,
      })),
    )}`,
    news.length > 0
      ? `资讯范围：本次共 ${news.length} 条，请结合这些资讯做消息面与情绪面分析。\n资讯：${JSON.stringify(news.map((item) => ({
          id: item.id,
          title: item.title,
          source: item.source,
          url: item.url,
          published_at: item.published_at,
          summary: item.summary,
          sentiment: item.sentiment,
          confidence: item.confidence,
          impact_days: item.impact_days,
          tags: item.tags,
        })))}`
      : "资讯范围：本次未提供资讯，请仅基于行情、K 线和指标分析，并在消息面明确说明本次未检索资讯。",
    `用户补充：${prompt || "无"}`,
  ].join("\n");

  return { system, user };
}

/** 调用 DeepSeek 生成分析正文；未配置密钥或输出套话时返回 null。 */
async function generateWithDeepSeek(
  prompt: string,
  stock: Stock,
  quote: MarketQuote,
  indicators: TechnicalIndicators,
  news: NewsItem[],
  klines: Kline[],
): Promise<string | null> {
  if (!deepSeekConfigured()) {
    return null;
  }

  const { system, user } = buildAnalysisMessages(stock, quote, indicators, news, klines, prompt);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), analysisTimeoutMs());
    const response = await fetch(`${deepSeekBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: deepSeekModel(),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.4,
        max_tokens: 3000,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      clearTimeout(timer);
      recordExternalCall(false);
      return null;
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    clearTimeout(timer);
    recordExternalCall(true);
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (
      !content ||
      hasForbiddenPromise(content) ||
      !isConcreteAnalysis(content, stock.code, stock.name, quote, news)
    ) {
      return null;
    }
    return content;
  } catch {
    recordExternalCall(false);
    return null;
  }
}

interface DeepSeekStreamResponse {
  choices?: Array<{
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }>;
}

/** 流式请求 DeepSeek，逐块产出正文内容。 */
async function* streamDeepSeekAnalysis(messages: {
  system: string;
  user: string;
}, signal?: AbortSignal): AsyncGenerator<string> {
  if (!deepSeekConfigured()) {
    return;
  }

  const controller = new AbortController();
  const abortFromSignal = () => controller.abort();
  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", abortFromSignal, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), analysisTimeoutMs());

  try {
    const response = await fetch(`${deepSeekBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: deepSeekModel(),
        messages: [
          { role: "system", content: messages.system },
          { role: "user", content: messages.user },
        ],
        temperature: 0.4,
        max_tokens: 3000,
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

/** 组装报告正文；AI 输出未自带来源清单时补全来源与影响周期。 */
function finalizeContent(baseContent: string, news: NewsItem[]): string {
  if (news.length === 0) {
    return baseContent;
  }
  return baseContent.includes("来源与影响周期")
    ? baseContent
    : `${baseContent}\n\n${buildSourceSection(news)}`;
}

/** 构建统一分析报告对象。 */
function buildReport(
  code: string,
  quote: MarketQuote,
  indicators: TechnicalIndicators,
  klines: Kline[],
  news: NewsItem[],
  content: string,
  reportId = buildReportId(code),
): AnalysisReport {
  const riskNote = [
    "本报告仅供学习参考，不构成任何投资建议。",
    "市场存在不确定性，请勿将任何分析结论理解为必然上涨或下跌的承诺。",
    "数据可能存在延迟或缺失，用户应独立核验并自行承担决策风险。",
  ].join(" ");

  return {
    id: reportId,
    code,
    created_at: new Date().toISOString(),
    data_snapshot: {
      quote,
      indicators,
      kline_count: klines.length,
      news_count: news.length,
      news: news.map((item) => ({
        id: item.id,
        title: item.title,
        url: item.url,
        source: item.source,
        published_at: item.published_at,
        sentiment: item.sentiment,
        confidence: item.confidence,
        impact_days: item.impact_days,
        tags: item.tags,
      })),
    },
    news_refs: news.map((item) => item.id),
    content,
    risk_note: riskNote,
  };
}

/** 保存报告快照并写入 store。 */
async function persistReport(report: AnalysisReport): Promise<AnalysisReport> {
  const r2Key = await saveAnalysisSnapshot(report);
  const persistedReport = r2Key
    ? { ...report, data_snapshot: { ...report.data_snapshot, r2_key: r2Key } }
    : report;
  await store.analysisReports.insert(persistedReport);
  return persistedReport;
}

/** 触发一次 AI 分析，返回持久化后的报告。 */
export async function runAnalysis(
  code: string,
  prompt?: string,
  news: NewsItem[] = [],
): Promise<AnalysisReport> {
  recordTaskRun("analysis");

  const [stock, quote, indicators, klines] = await Promise.all([
    getStock(code),
    getMarketQuote(code),
    getIndicators(code, "day"),
    getKlines(code, "day", "qfq", 120),
  ]);

  const fallbackContent = buildFallbackReport(code, stock.name, quote, indicators, news, klines);
  const llmContent = await generateWithDeepSeek(
    prompt ?? "",
    stock,
    quote,
    indicators,
    news,
    klines,
  );
  const baseContent = llmContent ?? fallbackContent;
  const content = finalizeContent(baseContent, news);
  const report = buildReport(code, quote, indicators, klines, news, content);
  return persistReport(report);
}

/** 流式分析活动，供停止接口中止并决定是否保存已生成内容。 */
interface ActiveAnalysisStream {
  controller: AbortController;
  persistOnAbort: boolean;
}

const activeAnalysisStreams = new Map<string, ActiveAnalysisStream>();

/** 请求停止正在生成的 AI 分析；成功时会将已生成内容落盘。 */
export function requestStopAnalysis(reportId: string): boolean {
  const active = activeAnalysisStreams.get(reportId);
  if (!active) {
    return false;
  }
  active.persistOnAbort = true;
  active.controller.abort();
  return true;
}

/** 流式触发一次 AI 分析，边生成边返回分块，并在结束时返回持久化报告。 */
export async function* streamAnalysis(
  code: string,
  prompt?: string,
  news: NewsItem[] = [],
  signal?: AbortSignal,
): AsyncGenerator<AnalysisStreamEvent> {
  recordTaskRun("analysis");

  const [stock, quote, indicators, klines] = await Promise.all([
    getStock(code),
    getMarketQuote(code),
    getIndicators(code, "day"),
    getKlines(code, "day", "qfq", 120),
  ]);

  const reportId = buildReportId(code);
  const controller = new AbortController();
  const active: ActiveAnalysisStream = { controller, persistOnAbort: false };
  activeAnalysisStreams.set(reportId, active);

  const abortFromRequest = () => controller.abort();
  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", abortFromRequest, { once: true });
  }

  try {
    yield { type: "meta", data: { reportId } };

    const fallbackContent = buildFallbackReport(code, stock.name, quote, indicators, news, klines);
    const messages = buildAnalysisMessages(stock, quote, indicators, news, klines, prompt ?? "");
    let llmContent: string | null = null;
    let streamedContent = "";

    if (deepSeekConfigured()) {
      try {
        for await (const chunk of streamDeepSeekAnalysis(messages, controller.signal)) {
          streamedContent += chunk;
          yield { type: "delta", content: chunk };
        }
        if (
          streamedContent.trim() &&
          !hasForbiddenPromise(streamedContent) &&
          isConcreteAnalysis(streamedContent, stock.code, stock.name, quote, news)
        ) {
          llmContent = streamedContent;
        }
      } catch {
        llmContent = null;
      }
    }

    if (controller.signal.aborted) {
      if (active.persistOnAbort && streamedContent.trim()) {
        const content = finalizeContent(streamedContent, news);
        const report = await persistReport(
          buildReport(code, quote, indicators, klines, news, content, reportId),
        );
        yield { type: "done", data: { report } };
      }
      return;
    }

    const baseContent = llmContent ?? fallbackContent;
    const content = finalizeContent(baseContent, news);

    if (!llmContent) {
      yield { type: "delta", content: content };
    }

    const report = await persistReport(
      buildReport(code, quote, indicators, klines, news, content, reportId),
    );
    yield { type: "done", data: { report } };
  } finally {
    activeAnalysisStreams.delete(reportId);
    signal?.removeEventListener("abort", abortFromRequest);
  }
}

/** 获取历史报告时间线。 */
export async function listReports(code: string): Promise<AnalysisReport[]> {
  return store.analysisReports.listByCode(code);
}

/** 删除指定股票下的一条分析报告；不存在时返回 false。 */
export async function deleteReport(code: string, reportId: string): Promise<boolean> {
  const reports = await store.analysisReports.listByCode(code);
  const exists = reports.some((report) => report.id === reportId);
  if (!exists) {
    return false;
  }

  await store.analysisReports.deleteById(reportId);
  return true;
}
