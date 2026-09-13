// 行情读取编排测试：缓存/内存/侧车/确定性回退四层优先级与强制刷新。
// store、缓存、侧车与指标计算全部用模块替身，不访问数据库与网络。
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStockByCode: vi.fn(),
  upsertStock: vi.fn(),
  getLatestQuote: vi.fn(),
  insertQuote: vi.fn(),
  listKlines: vi.fn(),
  insertKlines: vi.fn(),
  fetchQuoteFromSidecar: vi.fn(),
  fetchKlinesFromSidecar: vi.fn(),
  buildDeterministicQuote: vi.fn(),
  buildDeterministicKlines: vi.fn(),
  calculateIndicators: vi.fn(),
  cacheGetOrSet: vi.fn(),
  cacheInvalidatePrefix: vi.fn(),
}));

vi.mock("@/lib/store", () => ({
  store: {
    stocks: { getByCode: mocks.getStockByCode, upsert: mocks.upsertStock },
    marketQuotes: { getLatest: mocks.getLatestQuote, insert: mocks.insertQuote },
    klines: { list: mocks.listKlines, insertMany: mocks.insertKlines },
  },
}));

vi.mock("@/lib/cache", () => ({
  // 直通式缓存替身：始终执行 loader，便于断言 TTL 与回退逻辑。
  cacheGetOrSet: mocks.cacheGetOrSet,
  cacheInvalidatePrefix: mocks.cacheInvalidatePrefix,
}));

vi.mock("@/lib/data-service", () => ({
  fetchQuoteFromSidecar: mocks.fetchQuoteFromSidecar,
  fetchKlinesFromSidecar: mocks.fetchKlinesFromSidecar,
}));

vi.mock("@/lib/deterministic", () => ({
  buildDeterministicQuote: mocks.buildDeterministicQuote,
  buildDeterministicKlines: mocks.buildDeterministicKlines,
}));

vi.mock("@/lib/indicators", () => ({
  calculateIndicators: mocks.calculateIndicators,
}));

import {
  getIndicators,
  getKlines,
  getMarketQuote,
  getStock,
  refreshMarketData,
} from "@/lib/market-data";
import { resolveStock } from "@/lib/market";
import type { Kline, MarketQuote } from "@/lib/shared/types";

const CODE = "600519";

/** 构造行情快照。 */
function quote(source: string, fetchedAt = new Date().toISOString()): MarketQuote {
  return {
    code: CODE,
    ts: fetchedAt,
    price: 1688,
    change_pct: 1.2,
    open: 1668,
    high: 1692,
    low: 1660,
    prev_close: 1667,
    volume: 3_280_000,
    amount: 5_500_000_000,
    turnover_rate: 0.26,
    pe: 22.4,
    pb: 8.1,
    market_cap: null,
    float_cap: null,
    source,
    fetched_at: fetchedAt,
  };
}

/** 构造日 K 线序列。 */
function klines(count: number, source = "akshare"): Kline[] {
  const start = Date.UTC(2026, 8, 1);
  return Array.from({ length: count }, (_, index) => {
    const ts = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
    return {
      code: CODE,
      period: "day" as const,
      ts,
      open: 10,
      high: 11,
      low: 9,
      close: 10.5,
      volume: 100,
      amount: 1000,
      adj_type: "qfq" as const,
      source,
      fetched_at: new Date().toISOString(),
    };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cacheGetOrSet.mockImplementation(
    async (_key: string, _ttl: number, loader: () => Promise<unknown>) => loader(),
  );
  mocks.getStockByCode.mockResolvedValue(null);
  mocks.upsertStock.mockResolvedValue(undefined);
  mocks.getLatestQuote.mockResolvedValue(null);
  mocks.insertQuote.mockResolvedValue(undefined);
  mocks.listKlines.mockResolvedValue([]);
  mocks.insertKlines.mockResolvedValue(undefined);
  mocks.fetchQuoteFromSidecar.mockResolvedValue(null);
  mocks.fetchKlinesFromSidecar.mockResolvedValue(null);
  mocks.calculateIndicators.mockReturnValue({ code: CODE, period: "day" });
});

describe("getStock", () => {
  it("命中 store 时直接返回，不再识别与写回", async () => {
    const saved = resolveStock(CODE);
    mocks.getStockByCode.mockResolvedValue(saved);

    expect(await getStock(CODE)).toBe(saved);
    expect(mocks.upsertStock).not.toHaveBeenCalled();
  });

  it("未命中时本地识别并写回 store", async () => {
    const stock = await getStock(CODE);

    expect(stock.name).toBe("贵州茅台");
    expect(mocks.upsertStock).toHaveBeenCalledWith(stock);
  });
});

describe("getMarketQuote", () => {
  it("侧车有数据时写入 store 并返回侧车快照", async () => {
    const sidecar = quote("akshare");
    mocks.fetchQuoteFromSidecar.mockResolvedValue(sidecar);

    expect(await getMarketQuote(CODE)).toBe(sidecar);
    expect(mocks.insertQuote).toHaveBeenCalledWith(sidecar);
    expect(mocks.buildDeterministicQuote).not.toHaveBeenCalled();
  });

  it("侧车无数据时回退确定性行情", async () => {
    const fallback = quote("deterministic-fallback");
    mocks.buildDeterministicQuote.mockReturnValue(fallback);

    expect(await getMarketQuote(CODE)).toBe(fallback);
    expect(mocks.insertQuote).toHaveBeenCalledWith(fallback);
  });

  it("store 有新鲜的非降级快照时不再请求侧车", async () => {
    const saved = quote("akshare");
    mocks.getLatestQuote.mockResolvedValue(saved);

    expect(await getMarketQuote(CODE)).toBe(saved);
    expect(mocks.fetchQuoteFromSidecar).not.toHaveBeenCalled();
  });

  it("快照过期或来自降级数据时重新拉取", async () => {
    const stale = quote("akshare", new Date(Date.now() - 10 * 60_000).toISOString());
    mocks.getLatestQuote.mockResolvedValue(stale);
    const fresh = quote("akshare");
    mocks.fetchQuoteFromSidecar.mockResolvedValue(fresh);

    expect(await getMarketQuote(CODE)).toBe(fresh);
    expect(mocks.fetchQuoteFromSidecar).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mocks.cacheGetOrSet.mockImplementation(
      async (_key: string, _ttl: number, loader: () => Promise<unknown>) => loader(),
    );
    mocks.getLatestQuote.mockResolvedValue(quote("deterministic-fallback"));
    mocks.fetchQuoteFromSidecar.mockResolvedValue(fresh);
    expect(await getMarketQuote(CODE)).toBe(fresh);
    expect(mocks.fetchQuoteFromSidecar).toHaveBeenCalledTimes(1);
  });

  it("强制刷新会先清缓存并忽略已保存快照", async () => {
    mocks.getLatestQuote.mockResolvedValue(quote("akshare"));
    const fresh = quote("akshare");
    mocks.fetchQuoteFromSidecar.mockResolvedValue(fresh);

    expect(await getMarketQuote(CODE, true)).toBe(fresh);
    expect(mocks.cacheInvalidatePrefix).toHaveBeenCalledWith(`quote:${CODE}`);
    expect(mocks.getLatestQuote).not.toHaveBeenCalled();
  });
});

describe("getKlines", () => {
  it("侧车有数据时写库并返回最近 limit 条", async () => {
    const sidecar = klines(3);
    mocks.fetchKlinesFromSidecar.mockResolvedValue(sidecar);

    const result = await getKlines(CODE, "day", "qfq", 2);

    expect(result).toHaveLength(2);
    expect(mocks.insertKlines).toHaveBeenCalledWith(sidecar);
  });

  it("store 有新鲜的非降级数据时直接返回", async () => {
    const saved = klines(2);
    mocks.listKlines.mockResolvedValue(saved);

    expect(await getKlines(CODE, "day", "qfq", 120)).toBe(saved);
    expect(mocks.fetchKlinesFromSidecar).not.toHaveBeenCalled();
  });

  it("已保存数据含降级来源或已过期时重新拉取", async () => {
    const fresh = klines(2);
    mocks.fetchKlinesFromSidecar.mockResolvedValue(fresh);

    mocks.listKlines.mockResolvedValue(klines(2, "deterministic-fallback"));
    await getKlines(CODE, "day", "qfq", 120);
    expect(mocks.fetchKlinesFromSidecar).toHaveBeenCalledTimes(1);

    const expired = klines(2).map((item) => ({
      ...item,
      fetched_at: new Date(Date.now() - 30 * 3600_000).toISOString(),
    }));
    mocks.listKlines.mockResolvedValue(expired);
    await getKlines(CODE, "day", "qfq", 120);
    expect(mocks.fetchKlinesFromSidecar).toHaveBeenCalledTimes(2);
  });

  it("侧车无数据时回退确定性 K 线", async () => {
    const fallback = klines(2, "deterministic-fallback");
    mocks.buildDeterministicKlines.mockReturnValue(fallback);

    expect(await getKlines(CODE, "day", "qfq", 120)).toEqual(fallback);
    expect(mocks.buildDeterministicKlines).toHaveBeenCalledWith(CODE, "day", "qfq", 120);
  });

  it("不同周期的 TTL 不同，强制刷新清对应前缀", async () => {
    mocks.fetchKlinesFromSidecar.mockResolvedValue(klines(1));

    await getKlines(CODE, "minute", "qfq", 60);
    await getKlines(CODE, "day", "qfq", 120);
    await getKlines(CODE, "week", "qfq", 120);
    await getKlines(CODE, "month", "qfq", 120);
    const ttls = mocks.cacheGetOrSet.mock.calls.map((call) => call[1]);
    expect(ttls).toEqual([60_000, 21_600_000, 43_200_000, 86_400_000]);

    await getKlines(CODE, "day", "qfq", 120, true);
    expect(mocks.cacheInvalidatePrefix).toHaveBeenCalledWith(`kline:${CODE}`);
  });
});

describe("getIndicators 与 refreshMarketData", () => {
  it("基于 K 线计算结果", async () => {
    mocks.listKlines.mockResolvedValue(klines(2));
    const indicators = { code: CODE, period: "day", updated_at: "now" };
    mocks.calculateIndicators.mockReturnValue(indicators);

    expect(await getIndicators(CODE, "day")).toBe(indicators);
    expect(mocks.calculateIndicators).toHaveBeenCalledWith(expect.any(Array), CODE, "day");
  });

  it("强制刷新行情与日线", async () => {
    mocks.fetchQuoteFromSidecar.mockResolvedValue(quote("akshare"));
    mocks.fetchKlinesFromSidecar.mockResolvedValue(klines(1));

    await refreshMarketData(CODE);

    expect(mocks.fetchQuoteFromSidecar).toHaveBeenCalledTimes(1);
    expect(mocks.fetchKlinesFromSidecar).toHaveBeenCalledTimes(1);
    expect(mocks.cacheInvalidatePrefix).toHaveBeenCalledWith(`kline:${CODE}`);
  });
});
