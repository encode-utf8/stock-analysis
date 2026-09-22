// 资讯读取与外部搜索封装：只返回真实检索结果或官方历史快照。
// 约定：数据源不可用时抛出数据源故障，不再生成演示资讯。
// 资讯按 URL 或“标题 + 来源 + 发布时间”去重，并用 DeepSeek 逐条判定情绪与影响周期。
import { cacheGetOrSet, cacheInvalidatePrefix } from "@/lib/cache";
import { recordExternalCall } from "@/lib/observability";
import { DataSourceUnavailableError, markDegradedSnapshot } from "@/lib/datasource";
import { saveNewsSnapshot } from "@/lib/r2";
import { store } from "@/lib/store";
import type { NewsItem, NewsSentiment, Stock } from "@/lib/shared/types";

const NEWS_TTL_MS = 5 * 60_000;
const SHORT_IMPACT_DAYS = 7;
const LONG_IMPACT_DAYS = 30;

/** 部分 A 股的搜索别名，用于缩小 Tavily 查询范围。 */
const STOCK_SEARCH_ALIASES: Record<string, string[]> = {
  "688256": ["寒武纪", "Cambricon Technologies", "Cambricon"],
};

/** 部分 A 股使用更精确的 Tavily 查询表达式。 */
const STOCK_TAVILY_QUERIES: Record<string, string> = {
  "688256": '"Cambricon Technologies" "688256"',
};

/** 判断资讯是否为本地演示降级数据。 */
function isDemoNewsItem(item: NewsItem): boolean {
  return item.source.startsWith("演示");
}

/** 生成稳定短哈希，用于资讯去重标识。 */
function shortHash(input: string): string {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

/** 从标题与标签中识别长期资讯，供异常影响周期回退使用。 */
const LONG_TERM_HINTS = ["长期", "政策", "行业", "规划", "战略", "财报", "年报", "并购", "重组"];

function isLongTerm(tags: string[]): boolean {
  return tags.some((tag) => LONG_TERM_HINTS.some((hint) => tag.includes(hint)));
}

/** 校验情绪字段，非法值回退为中性。 */
function normalizeSentiment(value: unknown): NewsSentiment {
  return value === "positive" || value === "negative" || value === "neutral"
    ? value
    : "neutral";
}

/** 校验置信度并限制在 0 到 1 之间。 */
function normalizeConfidence(value: unknown, fallback = 0.75): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, number));
}

/** 校验标签，非法值回退为空数组。 */
function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

/** 修正影响周期：短期异常回退 7 天，长期异常回退 30 天。 */
function normalizeImpactDays(value: unknown, tags: string[]): number {
  const longTerm = isLongTerm(tags);
  const fallback = longTerm ? LONG_IMPACT_DAYS : SHORT_IMPACT_DAYS;
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  if (longTerm) {
    if (number < 14 || number > 365) {
      return LONG_IMPACT_DAYS;
    }
    return Math.round(number);
  }

  if (number > 14) {
    return SHORT_IMPACT_DAYS;
  }
  return Math.round(number);
}

/** 根据标题关键词给出本地确定性分类。 */
function classifyTitle(title: string): {
  sentiment: NewsSentiment;
  impactDays: number;
  tags: string[];
} {
  const positive = /增长|预增|突破|中标|回购|签约|提升|利好|扭亏|创新高/.test(title);
  const negative = /下滑|预亏|处罚|立案|减持|诉讼|风险|亏损|停产|下调/.test(title);
  const longTerm = /政策|行业|规划|战略|财报|年报|并购|重组/.test(title);

  return {
    sentiment: positive && !negative ? "positive" : negative && !positive ? "negative" : "neutral",
    impactDays: longTerm ? LONG_IMPACT_DAYS : SHORT_IMPACT_DAYS,
    tags: longTerm ? ["长期", "重点观察"] : ["短期"],
  };
}

/** 从 URL 中提取可读来源；无法识别时返回 Tavily。 */
function extractSource(url?: string): string {
  if (!url) {
    return "Tavily";
  }
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return hostname || "Tavily";
  } catch {
    return "Tavily";
  }
}

/** 清洗外部资讯摘要，避免展示乱码、导航文本和超长网页正文。 */
function cleanExternalSummary(
  summary: string | undefined,
  source: string,
  title: string,
): string {
  const normalized = (summary ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const looksGarbled =
    /ï¿½|Ã|Â|â€|å|ç|æ|ä¸­å›½|è‚¡ç¥¨/i.test(normalized) ||
    normalized.includes("| |");

  if (!normalized || normalized.length > 180 || looksGarbled || /Image \d+/i.test(normalized)) {
    return `${title}。来源：${source || "外部资讯"}，请打开原文查看完整内容。`;
  }

  return normalized.slice(0, 180);
}

/** 判断文本是否呈现 UTF-8 被误按 Latin-1/GBK 解码后的典型乱码。 */
function looksGarbled(value: string): boolean {
  return (
    /ï¿½|Ã|Â|â€|å|ç|æ|ä¸­å›½|è‚¡ç¥¨|æ²ª|æ·±/i.test(value) ||
    /[\u00c0-\u00ff]{3,}/.test(value)
  );
}

/** 清洗外部资讯标题，避免展示乱码、导航文本和超长标题。 */
function cleanExternalTitle(title: string | undefined, source: string): string {
  const normalized = (title ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized.length > 120 || looksGarbled(normalized)) {
    return source || "外部资讯";
  }
  return normalized.slice(0, 120);
}

/** 对已落库或新抓取的资讯做统一清洗，避免历史脏数据继续展示。 */
function sanitizeNewsItem(item: NewsItem): NewsItem {
  const title = cleanExternalTitle(item.title, item.source);
  return {
    ...item,
    title,
    summary: cleanExternalSummary(item.summary, item.source, title),
  };
}

/** 资讯去重键：优先 URL，否则使用“标题 + 来源 + 发布时间”。 */
function dedupeKey(item: Pick<NewsItem, "url" | "title" | "source" | "published_at">): string {
  const url = item.url.trim();
  if (url) {
    return `url:${url}`;
  }
  return `meta:${shortHash(`${item.title.trim()}|${item.source.trim()}|${item.published_at}`)}`;
}

/** 对资讯数组按 URL 或标题 + 来源 + 发布时间去重。 */
function dedupeNewsItems(items: NewsItem[]): NewsItem[] {
  const seen = new Map<string, NewsItem>();
  for (const item of items) {
    const key = dedupeKey(item);
    if (!seen.has(key)) {
      seen.set(key, item);
    }
  }
  return Array.from(seen.values());
}

/** 取本地已落库的官方资讯（过滤演示数据与过期数据）。 */
async function listOfficialNews(code: string): Promise<NewsItem[]> {
  const saved = await store.newsItems.listByCode(code);
  const now = Date.now();
  return saved.filter((item) => {
    if (item.status !== "active" || new Date(item.expire_at).getTime() < now) {
      return false;
    }
    return !isDemoNewsItem(item);
  }).map(sanitizeNewsItem);
}

/** 标注降级快照：来源为官方、但来自历史落库而非本次实时检索。 */
function markNewsSnapshot(items: NewsItem[]): NewsItem[] {
  return items.map((item) => markDegradedSnapshot(item));
}

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  published_date?: string;
}

/** 股票名称是否为“股票 600000”这类占位名称。 */
function isPlaceholderStockName(name: string): boolean {
  return /^股票\s*\d{6}$/.test(name.trim());
}

/** 生成 Tavily 查询词，优先使用预设的精确表达式。 */
function buildTavilyQuery(stock: Stock): string {
  const preset = STOCK_TAVILY_QUERIES[stock.code];
  if (preset) {
    return preset;
  }

  const name = !isPlaceholderStockName(stock.name) ? stock.name : "";
  const aliases = STOCK_SEARCH_ALIASES[stock.code] ?? [];
  const terms = [...new Set([name, ...aliases])].filter(Boolean);
  return terms.length > 0 ? `${terms.join(" ")} ${stock.code}` : stock.code;
}

/** 生成用于本地相关性判断的股票关键词。 */
function buildStockRelevanceTerms(stock: Stock): string[] {
  const aliases = STOCK_SEARCH_ALIASES[stock.code] ?? [];
  const name = !isPlaceholderStockName(stock.name) ? stock.name : "";
  const terms = [...new Set([name, ...aliases])].filter(Boolean);
  return terms.length > 0 ? terms : [stock.code];
}

/** 只保留标题、摘要或 URL 中明确包含目标股票关键词的资讯。 */
function isRelevantTavilyResult(item: TavilyResult, terms: string[]): boolean {
  const haystack = `${item.title ?? ""} ${item.url ?? ""} ${item.content ?? ""}`.toLowerCase();
  return terms.some((term) => term.toLowerCase() && haystack.includes(term.toLowerCase()));
}

/** 调用 Tavily 搜索；未配置密钥时返回 null。 */
async function fetchNewsFromTavily(
  code: string,
  stock: Stock,
  days = 30,
): Promise<NewsItem[] | null> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey || apiKey === "replace-me") {
    return null;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const now = new Date();
    const start = new Date(now.getTime() - days * 24 * 60 * 60_000);
    const query = buildTavilyQuery(stock);
    const relevanceTerms = buildStockRelevanceTerms(stock);
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        topic: "news",
        days,
        max_results: 12,
        search_depth: "basic",
        include_answer: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      clearTimeout(timer);
      recordExternalCall(false);
      return null;
    }

    const payload = (await response.json()) as { results?: TavilyResult[] };
    clearTimeout(timer);
    recordExternalCall(true);
    const results = payload.results ?? [];
    if (results.length === 0) {
      return [];
    }

    const nowMs = now.getTime();
    const startMs = start.getTime();
    const validResults = results.filter((item) => {
      if (!item.published_date) {
        return false;
      }
      const publishedMs = new Date(item.published_date).getTime();
      return Number.isFinite(publishedMs) && publishedMs >= startMs && publishedMs <= nowMs;
    });
    if (validResults.length === 0) {
      return [];
    }

    const relevantResults = validResults.filter((item) => isRelevantTavilyResult(item, relevanceTerms));
    if (relevantResults.length === 0) {
      return [];
    }

    return relevantResults.slice(0, 8).map((item) => {
      const title = item.title?.trim() || `${stock.name}相关资讯`;
      const url = item.url?.trim() || `https://example.com/news/${code}`;
      const source = extractSource(url);
      const summary = cleanExternalSummary(item.content, source, title);
      const publishedAt = new Date(item.published_date!).toISOString();
      const classification = classifyTitle(title);
      const impactDays = classification.impactDays;

      return {
        id: `news-${code}-${shortHash(dedupeKey({ url, title, source: extractSource(url), published_at: publishedAt }))}`,
        code,
        title,
        summary,
        url,
        source,
        published_at: publishedAt,
        fetched_at: now.toISOString(),
        sentiment: classification.sentiment,
        confidence: normalizeConfidence(item.score, 0.75),
        impact_days: impactDays,
        expire_at: new Date(nowMs + impactDays * 24 * 60 * 60_000).toISOString(),
        tags: classification.tags,
        status: "active",
        pinned: false,
      };
    });
  } catch {
    recordExternalCall(false);
    return null;
  }
}

/** 从 DeepSeek JSON 响应中安全提取对象。 */
function extractJsonObject(value: string): unknown {
  const withoutFence = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(withoutFence) as unknown;
  } catch {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(withoutFence.slice(start, end + 1)) as unknown;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** 调用 DeepSeek 逐条判定资讯情绪、置信度、影响周期与标签。 */
async function classifyNewsWithDeepSeek(items: NewsItem[], stockName: string): Promise<NewsItem[]> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || apiKey === "replace-me" || items.length === 0) {
    return items;
  }

  const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
  const system = [
    "你是专业的财经资讯分类助手。",
    "只基于给定资讯的标题和摘要进行判断，不要编造额外事实。",
    "只输出 JSON，不要输出 Markdown。",
  ].join("\n");
  const user = [
    `股票名称：${stockName}`,
    "请对每条资讯输出 JSON 对象：",
    '{"items":[{"id":"原文 id","sentiment":"positive|negative|neutral","confidence":0到1的小数,"impact_days":整数,"tags":["短期"或"长期"等]}]}',
    "impact_days 短期通常为 1 到 14 天，长期通常为 30 到 365 天。",
    `资讯：${JSON.stringify(items.map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
    })))}`,
  ].join("\n");

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4_000);
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.1,
        max_tokens: 3000,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      clearTimeout(timer);
      recordExternalCall(false);
      return items;
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    clearTimeout(timer);
    recordExternalCall(true);
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      return items;
    }

    const parsed = extractJsonObject(content) as {
      items?: Array<{
        id?: string;
        title?: string;
        sentiment?: unknown;
        confidence?: unknown;
        impact_days?: unknown;
        tags?: unknown;
      }>;
    } | null;
    if (!parsed || !Array.isArray(parsed.items)) {
      return items;
    }

    const byId = new Map<string, (typeof parsed.items)[number]>();
    const byTitle = new Map<string, (typeof parsed.items)[number]>();
    for (const row of parsed.items) {
      if (row.id) {
        byId.set(row.id, row);
      }
      if (row.title) {
        byTitle.set(row.title, row);
      }
    }

    const now = Date.now();
    return items.map((item) => {
      const classification = byId.get(item.id) ?? byTitle.get(item.title);
      if (!classification) {
        return item;
      }

      const tags = normalizeTags(classification.tags);
      const impactDays = normalizeImpactDays(classification.impact_days, tags);
      return {
        ...item,
        sentiment: normalizeSentiment(classification.sentiment),
        confidence: normalizeConfidence(classification.confidence, item.confidence),
        impact_days: impactDays,
        expire_at: new Date(now + impactDays * 24 * 60 * 60_000).toISOString(),
        tags: tags.length > 0 ? tags : impactDays > 14 ? ["长期"] : ["短期"],
      };
    });
  } catch {
    recordExternalCall(false);
    return items;
  }
}

/** 获取资讯；未命中缓存时外部搜索或确定性回退，并写入 store 与 R2 快照。 */
export async function getNews(code: string, forceRefresh = false): Promise<NewsItem[]> {
  const cacheKey = `news:${code}`;
  if (forceRefresh) {
    cacheInvalidatePrefix(cacheKey);
  }

  return cacheGetOrSet(cacheKey, NEWS_TTL_MS, async () => {
    if (!forceRefresh) {
      const cachedOfficial = await listOfficialNews(code);
      if (cachedOfficial.length > 0) {
        return cachedOfficial;
      }
    }

    const stock = await import("@/lib/market-data").then((module) => module.getStock(code));
    const external = await fetchNewsFromTavily(code, stock);
    if (external === null) {
      // 检索服务未配置或调用失败：只用官方历史快照兜底，没有快照即按数据源故障处理。
      const snapshot = await listOfficialNews(code);
      if (snapshot.length > 0) {
        return markNewsSnapshot(snapshot);
      }
      throw new DataSourceUnavailableError(`股票 ${code} 资讯检索`);
    }

    const deduped = dedupeNewsItems(external);
    const classified = deduped.length > 0
      ? await classifyNewsWithDeepSeek(deduped, stock.name)
      : deduped;
    const news = dedupeNewsItems(classified.map(sanitizeNewsItem));

    for (const item of news) {
      await store.newsItems.insert(item);
    }
    if (news.length > 0) {
      void saveNewsSnapshot(code, news);
    }
    return news;
  });
}

/** 按时间范围搜索真实资讯；有真实数据时不混入演示降级数据。 */
export async function searchNews(
  code: string,
  days = 30,
  forceRefresh = false,
): Promise<NewsItem[]> {
  const cacheKey = `news:${code}:${days}`;
  if (forceRefresh) {
    cacheInvalidatePrefix(cacheKey);
  }

  return cacheGetOrSet(cacheKey, NEWS_TTL_MS, async () => {
    const now = Date.now();
    const since = now - days * 24 * 60 * 60_000;
    const inRange = (item: NewsItem) => {
      const publishedAt = new Date(item.published_at).getTime();
      return (
        item.status === "active" &&
        Number.isFinite(publishedAt) &&
        publishedAt >= since &&
        new Date(item.expire_at).getTime() >= now &&
        !isDemoNewsItem(item)
      );
    };

    const saved = await store.newsItems.listByCode(code);
    const savedReal = dedupeNewsItems(saved.filter(inRange).map(sanitizeNewsItem));
    if (!forceRefresh && savedReal.length > 0) {
      return savedReal;
    }

    const stock = await import("@/lib/market-data").then((module) => module.getStock(code));
    const external = await fetchNewsFromTavily(code, stock, days);
    if (external === null) {
      // 检索服务未配置或调用失败：返回官方历史快照（标注降级），没有快照即按数据源故障处理。
      if (savedReal.length > 0) {
        return markNewsSnapshot(savedReal);
      }
      throw new DataSourceUnavailableError(`股票 ${code} 资讯检索`);
    }

    const deduped = dedupeNewsItems(external.length > 0 ? external : savedReal);
    const classified = deduped.length > 0
      ? await classifyNewsWithDeepSeek(deduped, stock.name)
      : deduped;
    const cleaned = dedupeNewsItems(classified.map(sanitizeNewsItem)).filter(inRange);

    for (const item of cleaned) {
      await store.newsItems.insert(item);
    }
    if (cleaned.length > 0) {
      void saveNewsSnapshot(code, cleaned);
    }
    return cleaned;
  });
}

/** 清理到期且未置顶的资讯，返回清理数量。 */
export async function cleanupExpiredNews(now = new Date().toISOString()): Promise<number> {
  const expired = await store.newsItems.listExpired(now);
  for (const item of expired) {
    await store.newsItems.updateStatus(item.id, "expired");
  }
  return expired.length;
}
