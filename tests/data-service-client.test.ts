// 侧车客户端回归测试：全部通过 stub 全局 fetch，验证成功/非法结构/HTTP 失败/网络异常四类分支。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchIndexKlineFromSidecar,
  fetchIndexQuotesFromSidecar,
  fetchKlinesFromSidecar,
  fetchMarketBreadthFromSidecar,
  fetchMarketSectorsFromSidecar,
  fetchQuoteFromSidecar,
  fetchQuotesFromSidecar,
  verifyFundCode,
  verifyStockCode,
} from "@/lib/data-service";

/** 构造 fetch 替身返回的成功响应。 */
function okJson(payload: unknown): Response {
  return { ok: true, status: 200, json: async () => payload } as unknown as Response;
}

/** 构造 fetch 替身返回的失败响应。 */
function errorResponse(status = 500): Response {
  return { ok: false, status, json: async () => ({}) } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

/** 读取 fetch 替身最后一次请求的 URL。 */
function lastUrl(): string {
  return String(fetchMock.mock.calls.at(-1)?.[0] ?? "");
}

/** 读取 fetch 替身最后一次请求的初始化参数。 */
function lastInit(): RequestInit {
  return (fetchMock.mock.calls.at(-1)?.[1] ?? {}) as RequestInit;
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  delete process.env.DATA_SERVICE_URL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DATA_SERVICE_URL;
});

describe("侧车单条行情", () => {
  const quote = {
    code: "600519",
    name: "贵州茅台",
    price: 1500,
    change: 7.5,
    change_pct: 0.5,
    amount: 1,
    source: "tencent",
    fetched_at: "2026-09-13T02:00:00Z",
  };

  it("成功时返回行情并带上 JSON 请求头", async () => {
    fetchMock.mockResolvedValue(okJson(quote));
    const result = await fetchQuoteFromSidecar("600519");

    expect(result?.price).toBe(1500);
    expect(lastUrl()).toContain("/quote?code=600519");
    expect(lastInit().headers).toEqual({ Accept: "application/json" });
  });

  it("结构非法时返回 null", async () => {
    fetchMock.mockResolvedValue(okJson({ code: "600519" }));
    await expect(fetchQuoteFromSidecar("600519")).resolves.toBeNull();
  });

  it("HTTP 异常与网络异常都返回 null", async () => {
    fetchMock.mockResolvedValue(errorResponse(502));
    await expect(fetchQuoteFromSidecar("600519")).resolves.toBeNull();

    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    await expect(fetchQuoteFromSidecar("600519")).resolves.toBeNull();
  });

  it("读取 DATA_SERVICE_URL 并去掉结尾斜杠", async () => {
    process.env.DATA_SERVICE_URL = "http://sidecar.local:9000/";
    fetchMock.mockResolvedValue(okJson(quote));
    await fetchQuoteFromSidecar("600519");
    expect(lastUrl()).toBe("http://sidecar.local:9000/quote?code=600519");
  });
});

describe("侧车代码校验", () => {
  it("股票与基金走各自路径，合法状态可用", async () => {
    fetchMock.mockResolvedValue(okJson({ code: "600519", status: "ok", name: "贵州茅台" }));
    await expect(verifyStockCode("600519")).resolves.toMatchObject({ status: "ok" });
    expect(lastUrl()).toContain("/quote/verify?code=600519");

    fetchMock.mockResolvedValue(
      okJson({ code: "510300", status: "upstream_unavailable", name: "沪深300ETF" }),
    );
    await expect(verifyFundCode("510300")).resolves.toMatchObject({
      status: "upstream_unavailable",
    });
    expect(lastUrl()).toContain("/fund/verify?code=510300");
  });

  it("未知状态码视为非法结构", async () => {
    fetchMock.mockResolvedValue(okJson({ code: "600519", status: "maybe" }));
    await expect(verifyStockCode("600519")).resolves.toBeNull();
  });
});

describe("侧车 K 线", () => {
  const klines = [
    {
      code: "600519",
      name: "贵州茅台",
      period: "day",
      adjust: "qfq",
      ts: "2026-09-12T00:00:00Z",
      open: 1,
      high: 1,
      low: 1,
      close: 1500,
      volume: 1,
      amount: 1,
      source: "tencent",
    },
  ];

  it("按参数拼查询串并返回 K 线", async () => {
    fetchMock.mockResolvedValue(okJson(klines));
    const result = await fetchKlinesFromSidecar("600519", "day", "qfq", 120);

    expect(result).toHaveLength(1);
    expect(lastUrl()).toContain("/kline?code=600519&period=day&adjust=qfq&limit=120");
  });

  it("列表中存在非法条目时整体判为不可用", async () => {
    fetchMock.mockResolvedValue(okJson([{ code: "600519" }]));
    await expect(fetchKlinesFromSidecar("600519", "day", "qfq", 120)).resolves.toBeNull();
  });
});

describe("指数行情与日线", () => {
  const indexQuote = {
    code: "sh000001",
    name: "上证指数",
    price: 3888.11,
    change: -46.4,
    change_pct: -1.18,
    amount: 958_186_337_000,
    source: "tencent",
    fetched_at: "2026-09-13T02:00:00Z",
  };
  const series = {
    code: "sh000001",
    name: "上证指数",
    days: [
      { date: "2026-09-10", open: 1, close: 3934.4, high: 1, low: 1, amount: 1 },
      { date: "2026-09-11", open: 1, close: 3888.11, high: 1, low: 1, amount: 2 },
    ],
    source: "tencent",
    fetched_at: "2026-09-13T02:00:00Z",
  };

  it("非法指数代码不发请求，直接返回空", async () => {
    await expect(fetchIndexQuotesFromSidecar(["abc", "600519"])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(fetchIndexKlineFromSidecar("600519", 60)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("指数行情过滤非法条目", async () => {
    fetchMock.mockResolvedValue(okJson({ quotes: [indexQuote, { code: "sh000001" }] }));
    const quotes = await fetchIndexQuotesFromSidecar(["sh000001", "sz399001"]);

    expect(quotes).toHaveLength(1);
    expect(lastUrl()).toContain("codes=sh000001%2Csz399001");
  });

  it("指数行情非数组时返回空数组", async () => {
    fetchMock.mockResolvedValue(okJson({ quotes: "oops" }));
    await expect(fetchIndexQuotesFromSidecar(["sh000001"])).resolves.toEqual([]);
  });

  it("指数日线结构非法时返回 null", async () => {
    fetchMock.mockResolvedValue(okJson({ ...series, days: [{ date: "2026-09-11" }] }));
    await expect(fetchIndexKlineFromSidecar("sh000001", 60)).resolves.toBeNull();

    fetchMock.mockResolvedValue(okJson(series));
    await expect(fetchIndexKlineFromSidecar("sh000001", 60)).resolves.toMatchObject({
      code: "sh000001",
    });
  });
});

describe("涨跌家数与行业板块", () => {
  it("不带日期走当日口径，带日期走历史口径", async () => {
    fetchMock.mockResolvedValue(
      okJson({ up: 604, down: 4567, flat: 36, source: "legulegu" }),
    );
    await fetchMarketBreadthFromSidecar();
    expect(lastUrl()).toContain("/market/breadth");
    expect(lastUrl()).not.toContain("date=");

    await fetchMarketBreadthFromSidecar("2026-09-11");
    expect(lastUrl()).toContain("/market/breadth?date=2026-09-11");
  });

  it("涨跌家数结构非法时返回 null", async () => {
    fetchMock.mockResolvedValue(okJson({ up: 1 }));
    await expect(fetchMarketBreadthFromSidecar()).resolves.toBeNull();
  });

  it("板块查询串包含限流、日期与历史口径开关", async () => {
    fetchMock.mockResolvedValue(okJson({ top: [], bottom: [], total: 90 }));

    await fetchMarketSectorsFromSidecar();
    expect(lastUrl()).toContain("/market/sectors?limit=5");

    await fetchMarketSectorsFromSidecar(5, "2026-09-11", { history: true });
    expect(lastUrl()).toBe("http://127.0.0.1:8000/market/sectors?limit=5&date=2026-09-11&history=1");
  });

  it("板块结构非法时返回 null", async () => {
    fetchMock.mockResolvedValue(okJson({ top: [], total: 1 }));
    await expect(fetchMarketSectorsFromSidecar()).resolves.toBeNull();
  });
});

describe("批量行情（实时推送）", () => {
  it("去重并过滤非法代码后请求侧车", async () => {
    fetchMock.mockResolvedValue(
      okJson({
        quotes: [
          {
            code: "600519",
            price: 1500,
            change_pct: 1.2,
            source: "tencent",
            fetched_at: "2026-09-13T02:00:00Z",
          },
          {
            code: "000001",
            price: 10,
            change_pct: -0.5,
            prev_close: 10.05,
            source: "tencent",
            fetched_at: "2026-09-13T02:00:00Z",
          },
          { code: "000002", price: "bad" },
        ],
        missing: ["159915", 7],
        source: "tencent",
        fetched_at: "2026-09-13T02:00:00Z",
      }),
    );

    const batch = await fetchQuotesFromSidecar(["600519", "600519", "000001", "abc"]);

    expect(lastUrl()).toContain("/quotes?codes=600519%2C000001");
    expect(batch?.items).toHaveLength(2);
    // 缺省前收时回退最新价，统一按股票口径消费。
    expect(batch?.items[0]).toMatchObject({ target: "stock", prev_close: 1500 });
    expect(batch?.missing).toEqual(["159915"]);
    expect(batch?.source).toBe("tencent");
  });

  it("全部代码非法时不发请求", async () => {
    await expect(fetchQuotesFromSidecar(["abc", "60051"])).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("侧车返回空或全部非法条目时视为本轮失败", async () => {
    fetchMock.mockResolvedValue(okJson({ quotes: [] }));
    await expect(fetchQuotesFromSidecar(["600519"])).resolves.toBeNull();

    fetchMock.mockResolvedValue(okJson({ quotes: [{ code: "600519" }] }));
    await expect(fetchQuotesFromSidecar(["600519"])).resolves.toBeNull();
  });

  it("侧车不可达时返回 null", async () => {
    fetchMock.mockRejectedValue(new Error("timeout"));
    await expect(fetchQuotesFromSidecar(["600519"])).resolves.toBeNull();
  });

  it("缺省 source 与 fetched_at 时给出兜底值", async () => {
    fetchMock.mockResolvedValue(
      okJson({
        quotes: [
          {
            code: "600519",
            price: 1500,
            change_pct: 1.2,
            source: "tencent",
            fetched_at: "2026-09-13T02:00:00Z",
          },
        ],
      }),
    );
    const batch = await fetchQuotesFromSidecar(["600519"]);

    expect(batch?.source).toBe("unknown");
    expect(typeof batch?.fetched_at).toBe("string");
  });
});
