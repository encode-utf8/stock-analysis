// 基金行业资讯编排：先根据持仓判断强相关行业，再用 Tavily 搜索真实行业资讯。
// 不生成确定性基金资讯；未配置检索服务或搜索不到真实结果时明确返回不可用，不展示降级占位内容。
import { cacheGetOrSet, cacheInvalidatePrefix } from "@/lib/cache";
import { getFundHoldings } from "@/lib/fund-holdings";
import { fundNewsStore } from "@/lib/fund-news-store";
import { recordExternalCall } from "@/lib/observability";
import type {
  FundHoldings,
  FundIndustryNewsSnapshot,
  FundNewsItem,
  NewsSentiment,
  NewsStatus,
} from "@/lib/shared/types";

const INDUSTRY_NEWS_TTL_MS = 10 * 60_000;
const SEARCH_TIMEOUT_MS = 12_000;
const MAX_INDUSTRIES = 4;
const MAX_RESULTS_PER_INDUSTRY = 4;

/** 判断外部密钥是否已填写且不是示例占位值。 */
function hasRealKey(value: string | undefined): boolean {
  return Boolean(value && value !== "replace-me");
}

function deepSeekConfigured(): boolean {
  return hasRealKey(process.env.DEEPSEEK_API_KEY);
}

function deepSeekBaseUrl(): string {
  return (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
}

function deepSeekModel(): string {
  return process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
}

function shortHash(input: string): string {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

/** 从 URL 中提取可读来源；无法识别时返回 Tavily。 */
function extractSource(url: string): string {
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

/** 清洗外部资讯文本，去除控制字符与多余空白。 */
function cleanExternalText(value: string | undefined, maxLength: number): string {
  return (value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/** 根据标题关键词做轻量情绪分类，供行业资讯展示参考。 */
function classifyTitle(title: string): NewsSentiment {
  const positive = /增长|预增|突破|中标|回购|签约|提升|利好|扭亏|创新高/.test(title);
  const negative = /下滑|预亏|处罚|立案|减持|诉讼|风险|亏损|停产|下调/.test(title);
  if (positive && !negative) {
    return "positive";
  }
  if (negative && !positive) {
    return "negative";
  }
  return "neutral";
}

/** 从 DeepSeek 输出中安全解析行业关键词数组。 */
function parseIndustryList(value: unknown): string[] {
  let target = value;
  if (typeof target === "string") {
    const trimmed = target.trim();
    try {
      target = JSON.parse(trimmed) as unknown;
    } catch {
      const firstBracket = trimmed.indexOf("[");
      const lastBracket = trimmed.lastIndexOf("]");
      if (firstBracket >= 0 && lastBracket > firstBracket) {
        try {
          target = JSON.parse(trimmed.slice(firstBracket, lastBracket + 1)) as unknown;
        } catch {
          target = trimmed;
        }
      } else {
        target = trimmed;
      }
    }
  }

  if (Array.isArray(target)) {
    return target
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && item.length <= 20)
      .filter((item, index, list) => list.indexOf(item) === index)
      .slice(0, MAX_INDUSTRIES);
  }

  if (target && typeof target === "object" && Array.isArray((target as { industries?: unknown }).industries)) {
    return parseIndustryList((target as { industries: unknown }).industries);
  }

  if (typeof target === "string") {
    return target
      .split(/[\n,，、]/)
      .map((item) => item.trim().replace(/^["'“”]+|["'“”]+$/g, ""))
      .filter((item) => item.length > 0 && item.length <= 20)
      .filter((item, index, list) => list.indexOf(item) === index)
      .slice(0, MAX_INDUSTRIES);
  }

  return [];
}

/** 根据持仓的行业配置与个股行业字段推导行业关键词，作为 DeepSeek 不可用时的兜底。 */
function deriveIndustriesFromHoldings(holdings: FundHoldings): string[] {
  const allocation = Object.entries(holdings.industry_allocation ?? {})
    .filter(([name, weight]) => {
      return typeof weight === "number" && weight > 0 && !/其他|未分类|现金|债券/.test(name);
    })
    .sort((left, right) => right[1] - left[1])
    .map(([name]) => name.trim())
    .slice(0, MAX_INDUSTRIES);

  const holdingIndustries = holdings.top_holdings
    .map((item) => item.industry?.trim() ?? "")
    .filter((item) => item.length > 0 && item.length <= 20);

  return [...new Set([...allocation, ...holdingIndustries])].slice(0, MAX_INDUSTRIES);
}

/** 调用 DeepSeek 根据前十大持仓与行业配置判断强相关行业。 */
async function inferIndustriesWithDeepSeek(holdings: FundHoldings): Promise<string[] | null> {
  if (!deepSeekConfigured()) {
    return null;
  }

  const topHoldings = holdings.top_holdings
    .slice(0, 10)
    .map((item, index) => {
      const industry = item.industry ? `，行业：${item.industry}` : "";
      return `${index + 1}. ${item.name}（权重 ${item.weight_pct.toFixed(2)}%${industry}）`;
    })
    .join("\n");
  const industryAllocation = Object.entries(holdings.industry_allocation ?? {})
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([name, weight]) => `${name}：${weight.toFixed(2)}%`)
    .join("、");

  const system = [
    "你是专业的基金行业研究员。",
    "请根据基金持仓判断该基金与哪些 A 股/中国行业主题强相关。",
    "只输出 JSON 字符串数组，数组元素必须是可以直接用于新闻搜索的中文行业关键词，例如 [\"半导体\",\"光模块\"]。",
    "不要输出解释、Markdown 或额外字段。",
  ].join("\n");
  const user = [
    `基金代码：${holdings.code}`,
    `报告期：${holdings.report_date}`,
    `前十大持仓：\n${topHoldings}`,
    `行业配置：${industryAllocation || "暂无"}`,
    `请输出 2 到 ${MAX_INDUSTRIES} 个最相关的行业关键词。`,
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
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
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.1,
        max_tokens: 200,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      recordExternalCall(false);
      return null;
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    recordExternalCall(true);
    const content = payload.choices?.[0]?.message?.content;
    const industries = parseIndustryList(content);
    return industries.length > 0 ? industries : null;
  } catch {
    recordExternalCall(false);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface TavilyIndustryResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  published_date?: string;
}

/** 对单个行业调用 Tavily 搜索真实行业资讯。 */
async function searchIndustryNews(code: string, industry: string): Promise<FundNewsItem[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!hasRealKey(apiKey)) {
    return [];
  }

  const now = new Date();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: `${industry} 行业 最新动态 政策 市场`,
        topic: "news",
        days: 30,
        max_results: MAX_RESULTS_PER_INDUSTRY,
        search_depth: "basic",
        include_answer: false,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      recordExternalCall(false);
      return [];
    }
    const payload = (await response.json()) as { results?: TavilyIndustryResult[] };
    recordExternalCall(true);
    const results = (payload.results ?? []).filter((item) => item.title || item.url);
    if (results.length === 0) {
      return [];
    }

    return results.slice(0, MAX_RESULTS_PER_INDUSTRY).map((item) => {
      const title = cleanExternalText(item.title, 120) || `${industry}行业资讯`;
      const url = item.url?.trim() ?? "";
      const source = extractSource(url);
      const summary = cleanExternalText(item.content, 180);
      const publishedAt = item.published_date && Number.isFinite(new Date(item.published_date).getTime())
        ? new Date(item.published_date).toISOString()
        : now.toISOString();
      const sentiment = classifyTitle(title);
      const confidence = Number.isFinite(Number(item.score)) ? Math.min(1, Math.max(0, Number(item.score))) : 0.7;

      return {
        id: `fund-industry-news-${code}-${shortHash(`${industry}|${url}|${title}|${publishedAt}`)}`,
        code,
        title,
        summary,
        url,
        source,
        published_at: publishedAt,
        fetched_at: now.toISOString(),
        sentiment,
        confidence,
        impact_days: 7,
        expire_at: new Date(now.getTime() + 7 * 24 * 60 * 60_000).toISOString(),
        tags: [industry, "行业资讯"],
        status: "active",
        pinned: false,
        news_type: "market",
        industry,
      };
    });
  } catch {
    recordExternalCall(false);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** 按 URL 或“标题 + 来源 + 发布时间”去重，并保留最新的行业资讯。 */
function dedupeIndustryNews(items: FundNewsItem[]): FundNewsItem[] {
  const seen = new Map<string, FundNewsItem>();
  for (const item of items) {
    const key = item.url.trim()
      ? `url:${item.url.trim()}`
      : `meta:${shortHash(`${item.title}|${item.source}|${item.published_at}`)}`;
    if (!seen.has(key)) {
      seen.set(key, item);
    }
  }
  return Array.from(seen.values()).sort((left, right) => right.published_at.localeCompare(left.published_at));
}

function unavailableSnapshot(code: string, industries: string[], source: FundIndustryNewsSnapshot["industry_analysis_source"], reason: string): FundIndustryNewsSnapshot {
  return {
    code,
    industries,
    industry_analysis_source: source,
    available: false,
    reason,
    news: [],
    generated_at: new Date().toISOString(),
  };
}

/** 获取基金行业资讯快照；只返回真实行业搜索结果，不生成演示资讯。 */
export async function getFundIndustryNews(code: string, forceRefresh = false): Promise<FundIndustryNewsSnapshot> {
  const cacheKey = `fund:industry-news:${code}`;
  if (forceRefresh) {
    cacheInvalidatePrefix(cacheKey);
  }

  return cacheGetOrSet(cacheKey, INDUSTRY_NEWS_TTL_MS, async () => {
    const holdings = await getFundHoldings(code);
    if (holdings.source === "deterministic-fallback" || holdings.top_holdings.length === 0) {
      return unavailableSnapshot(
        code,
        [],
        "none",
        "基金持仓数据暂不可用，无法判断相关行业，因此不展示行业资讯。",
      );
    }

    const aiIndustries = await inferIndustriesWithDeepSeek(holdings);
    const industries = aiIndustries ?? deriveIndustriesFromHoldings(holdings);
    const analysisSource = aiIndustries ? "ai" : "holdings";
    if (industries.length === 0) {
      return unavailableSnapshot(code, [], analysisSource, "未能从当前持仓中识别出有效的关联行业。");
    }

    if (!hasRealKey(process.env.TAVILY_API_KEY)) {
      return unavailableSnapshot(
        code,
        industries,
        analysisSource,
        "未配置行业资讯检索服务（TAVILY_API_KEY），暂不展示降级资讯。",
      );
    }

    const grouped = await Promise.all(industries.map((industry) => searchIndustryNews(code, industry)));
    const news = dedupeIndustryNews(grouped.flat());
    if (news.length === 0) {
      return unavailableSnapshot(code, industries, analysisSource, "行业资讯检索未返回真实结果，请稍后刷新重试。");
    }

    return {
      code,
      industries,
      industry_analysis_source: analysisSource,
      available: true,
      reason: null,
      news,
      generated_at: new Date().toISOString(),
    };
  });
}

/** 清理到期基金资讯；保留 pinned 与“长期”标签条目。 */
export async function cleanupExpiredFundNews(now = new Date().toISOString(), dryRun = false): Promise<number> {
  const expired = await fundNewsStore.news.listExpired(now);
  const candidates = expired.filter((entry) => {
    return entry.status === "active" && !entry.pinned && !entry.tags.includes("长期");
  });
  if (!dryRun) {
    for (const entry of candidates) {
      await fundNewsStore.news.updateStatus(entry.id, "expired" as NewsStatus);
    }
  }
  return candidates.length;
}
