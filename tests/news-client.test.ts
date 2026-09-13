// 资讯采集编排测试：缓存/本地库/外部搜索/确定性回退四层优先级，以及清洗、去重、
// 相关性过滤与 DeepSeek 分类。store、R2、行情元数据与 fetch 全部用替身。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listByCode: vi.fn(),
  insert: vi.fn(),
  updateStatus: vi.fn(),
  listExpired: vi.fn(),
  getStock: vi.fn(),
  saveNewsSnapshot: vi.fn(),
  cacheGetOrSet: vi.fn(),
  cacheInvalidatePrefix: vi.fn(),
}));

vi.mock("@/lib/cache", () => ({
  cacheGetOrSet: mocks.cacheGetOrSet,
  cacheInvalidatePrefix: mocks.cacheInvalidatePrefix,
}));

vi.mock("@/lib/store", () => ({
  store: {
    newsItems: {
      listByCode: mocks.listByCode,
      insert: mocks.insert,
      updateStatus: mocks.updateStatus,
      listExpired: mocks.listExpired,
    },
  },
}));

vi.mock("@/lib/r2", () => ({ saveNewsSnapshot: mocks.saveNewsSnapshot }));

vi.mock("@/lib/market-data", () => ({ getStock: mocks.getStock }));

import { cleanupExpiredNews, getNews, searchNews } from "@/lib/news";
import { resolveStock } from "@/lib/market";
import type { NewsItem } from "@/lib/shared/types";

const CODE = "600519";
const STOCK = resolveStock(CODE);
const NEWS_TTL_MS = 5 * 60_000;

/** 构造资讯条目；默认是「真实来源 + 未来过期」的活跃数据。 */
function newsItem(overrides: Partial<NewsItem> = {}): NewsItem {
  const now = Date.now();
  return {
    id: `news-${Math.random().toString(36).slice(2, 8)}`,
    code: CODE,
    title: "贵州茅台发布经营数据",
    summary: "公司披露近期经营数据。",
    url: `https://finance.sina.com.cn/${Math.random().toString(36).slice(2, 8)}.html`,
    source: "finance.sina.com.cn",
    published_at: new Date(now - 3_600_000).toISOString(),
    fetched_at: new Date(now).toISOString(),
    sentiment: "neutral",
    confidence: 0.8,
    impact_days: 7,
    expire_at: new Date(now + 7 * 86_400_000).toISOString(),
    tags: ["短期"],
    status: "active",
    pinned: false,
    ...overrides,
  };
}

/** 按 URL 前缀路由的 fetch 替身；未命中路由直接抛错，避免测试悄悄漏掉请求。 */
function stubFetch(routes: Record<string, unknown>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    const key = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    if (!key) {
      throw new Error(`未预期的外部请求：${url}`);
    }
    const route = routes[key];
    if (route === "throw") {
      throw new Error("网络异常");
    }
    return {
      ok: true,
      status: 200,
      json: async () => route,
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TAVILY_API_KEY", "");
  vi.stubEnv("DEEPSEEK_API_KEY", "");
  mocks.cacheGetOrSet.mockImplementation(
    async (_key: string, _ttl: number, loader: () => Promise<unknown>) => loader(),
  );
  mocks.listByCode.mockResolvedValue([]);
  mocks.insert.mockResolvedValue(undefined);
  mocks.updateStatus.mockResolvedValue(undefined);
  mocks.listExpired.mockResolvedValue([]);
  mocks.getStock.mockResolvedValue(STOCK);
  mocks.saveNewsSnapshot.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getNews", () => {
  it("无外部密钥时生成确定性资讯并落库", async () => {
    const result = await getNews(CODE);

    expect(result).toHaveLength(4);
    expect(result.every((item) => item.code === CODE && item.status === "active")).toBe(true);
    expect(result.every((item) => item.source.startsWith("演示"))).toBe(true);
    expect(result.every((item) => new Date(item.expire_at).getTime() > Date.now())).toBe(true);
    expect(mocks.insert).toHaveBeenCalledTimes(4);
    expect(mocks.saveNewsSnapshot).toHaveBeenCalledWith(CODE, result);
    expect(mocks.cacheGetOrSet.mock.calls[0][1]).toBe(NEWS_TTL_MS);
  });

  it("本地有活跃真实资讯时直接返回，不再请求外部", async () => {
    const saved = [newsItem(), newsItem()];
    mocks.listByCode.mockResolvedValue(saved);
    const fetchMock = stubFetch({});

    const result = await getNews(CODE);

    expect(result).toHaveLength(2);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("本地数据过期或非活跃时重新生成", async () => {
    mocks.listByCode.mockResolvedValue([
      newsItem({ expire_at: new Date(Date.now() - 86_400_000).toISOString() }),
      newsItem({ status: "expired" }),
    ]);

    const result = await getNews(CODE);

    expect(result).toHaveLength(4);
    expect(result.every((item) => item.source.startsWith("演示"))).toBe(true);
  });

  it("Tavily 结果按相关性、时间范围与字段完整性过滤并清洗", async () => {
    vi.stubEnv("TAVILY_API_KEY", "tvly-test");
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const tooOld = new Date(Date.now() - 90 * 86_400_000).toISOString();
    stubFetch({
      "https://api.tavily.com/search": {
        results: [
          {
            title: "贵州茅台发布三季报",
            url: "https://finance.sina.com.cn/a.html",
            content: "公司三季度营收同比增长。",
            score: 0.9,
            published_date: yesterday,
          },
          {
            title: "无关公司公告",
            url: "https://example.com/b.html",
            content: "与本股票无关的内容",
            score: 0.8,
            published_date: yesterday,
          },
          {
            title: "贵州茅台旧闻",
            url: "https://example.com/c.html",
            content: "贵州茅台旧闻",
            score: 0.7,
            published_date: tooOld,
          },
          {
            title: "贵州茅台无日期",
            url: "https://example.com/d.html",
            content: "贵州茅台无日期",
            score: 0.6,
          },
        ],
      },
    });

    const result = await getNews(CODE);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("贵州茅台发布三季报");
    expect(result[0].source).toBe("finance.sina.com.cn");
    expect(result[0].summary).toBe("公司三季度营收同比增长。");
    expect(result[0].confidence).toBe(0.9);
    expect(result[0].impact_days).toBe(7);
  });

  it("配置 DeepSeek 时用分类结果覆盖情绪与影响周期", async () => {
    vi.stubEnv("TAVILY_API_KEY", "tvly-test");
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-test");
    stubFetch({
      "https://api.tavily.com/search": {
        results: [
          {
            title: "贵州茅台发布三季报",
            url: "https://finance.sina.com.cn/a.html",
            content: "公司三季度营收同比增长。",
            score: 0.9,
            published_date: new Date(Date.now() - 3_600_000).toISOString(),
          },
        ],
      },
      "https://api.deepseek.com/chat/completions": {
        choices: [
          {
            message: {
              content: JSON.stringify({
                items: [
                  {
                    title: "贵州茅台发布三季报",
                    sentiment: "positive",
                    confidence: 0.95,
                    impact_days: 45,
                    tags: ["长期"],
                  },
                ],
              }),
            },
          },
        ],
      },
    });

    const result = await getNews(CODE);

    expect(result).toHaveLength(1);
    expect(result[0].sentiment).toBe("positive");
    expect(result[0].confidence).toBe(0.95);
    expect(result[0].impact_days).toBe(45);
    expect(result[0].tags).toEqual(["长期"]);
  });

  it("Tavily 请求异常时回退确定性资讯", async () => {
    vi.stubEnv("TAVILY_API_KEY", "tvly-test");
    stubFetch({ "https://api.tavily.com/search": "throw" });

    const result = await getNews(CODE);

    expect(result).toHaveLength(4);
    expect(result.every((item) => item.source.startsWith("演示"))).toBe(true);
  });

  it("强制刷新会清缓存并合并本地未过期资讯", async () => {
    mocks.listByCode.mockResolvedValue([newsItem({ url: "https://example.com/kept.html" })]);

    const result = await getNews(CODE, true);

    expect(mocks.cacheInvalidatePrefix).toHaveBeenCalledWith(`news:${CODE}`);
    expect(result.some((item) => item.url === "https://example.com/kept.html")).toBe(true);
    // 确定性资讯 4 条 + 本地保留 1 条，按 URL 去重后不应丢数据。
    expect(result).toHaveLength(5);
  });
});

describe("searchNews", () => {
  it("无密钥时返回范围内的本地真实资讯", async () => {
    const real = newsItem();
    mocks.listByCode.mockResolvedValue([
      real,
      newsItem({ source: "演示资讯源" }),
      newsItem({ published_at: new Date(Date.now() - 90 * 86_400_000).toISOString() }),
    ]);

    const result = await searchNews(CODE, 30);

    expect(result.map((item) => item.url)).toEqual([real.url]);
  });

  it("无密钥且无本地数据时返回空数组", async () => {
    expect(await searchNews(CODE, 30)).toEqual([]);
  });

  it("有密钥时调用外部搜索并落库", async () => {
    vi.stubEnv("TAVILY_API_KEY", "tvly-test");
    stubFetch({
      "https://api.tavily.com/search": {
        results: [
          {
            title: "贵州茅台中标重大项目",
            url: "https://finance.sina.com.cn/win.html",
            content: "公司中标重大项目。",
            score: 0.88,
            published_date: new Date(Date.now() - 7_200_000).toISOString(),
          },
        ],
      },
    });

    const result = await searchNews(CODE, 30);

    expect(result).toHaveLength(1);
    expect(result[0].sentiment).toBe("positive");
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });
});

describe("cleanupExpiredNews", () => {
  it("把到期资讯标记为过期并返回数量", async () => {
    mocks.listExpired.mockResolvedValue([newsItem({ id: "news-a" }), newsItem({ id: "news-b" })]);

    expect(await cleanupExpiredNews("2026-09-30T00:00:00.000Z")).toBe(2);
    expect(mocks.updateStatus).toHaveBeenCalledWith("news-a", "expired");
    expect(mocks.updateStatus).toHaveBeenCalledWith("news-b", "expired");
    expect(mocks.listExpired).toHaveBeenCalledWith("2026-09-30T00:00:00.000Z");
  });
});
