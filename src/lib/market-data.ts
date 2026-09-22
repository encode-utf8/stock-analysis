// 行情读取编排：缓存 → 内存 store 官方数据 → 行情侧车 → 官方快照（标注降级）→ 抛数据源故障。
// 约定：确定性降级数据不面向用户返回，避免把演示值当作真实行情展示。
import { cacheGet, cacheGetOrSet, cacheInvalidatePrefix, cacheSet } from "@/lib/cache";
import { fetchKlinesFromSidecar, fetchQuoteFromSidecar } from "@/lib/data-service";
import {
  DataSourceUnavailableError,
  markDegradedSnapshot,
  officialRecords,
} from "@/lib/datasource";
import { calculateIndicators } from "@/lib/indicators";
import { resolveStock } from "@/lib/market";
import { store } from "@/lib/store";
import { DATA_SOURCE_RETRY_AFTER_MS, isOfficialDataSource } from "@/lib/shared/types";
import type {
  AdjustType,
  Kline,
  KlinePeriod,
  MarketQuote,
  Stock,
  TechnicalIndicators,
} from "@/lib/shared/types";

const QUOTE_TTL_MS = 60_000;
const MINUTE_KLINE_TTL_MS = 60_000;
const DAY_KLINE_TTL_MS = 6 * 60 * 60_000;
const WEEK_KLINE_TTL_MS = 12 * 60 * 60_000;
const MONTH_KLINE_TTL_MS = 24 * 60 * 60_000;
const INDICATOR_TTL_MS = 60_000;

/** 判断数据是否在允许的新鲜度窗口内。 */
function isFresh(timestamp: string, ttlMs: number): boolean {
  const age = Date.now() - new Date(timestamp).getTime();
  return Number.isFinite(age) && age >= 0 && age <= ttlMs;
}

/** 获取并持久化股票元数据。 */
export async function getStock(code: string): Promise<Stock> {
  const cached = await store.stocks.getByCode(code);
  if (cached) {
    return cached;
  }
  const stock = resolveStock(code);
  await store.stocks.upsert(stock);
  return stock;
}

/**
 * 获取当前行情快照。
 * 数据源不可用时回退到最近的官方快照并标注降级；没有任何官方快照时抛出数据源故障。
 */
export async function getMarketQuote(code: string, forceRefresh = false): Promise<MarketQuote> {
  const cacheKey = `quote:${code}`;
  if (forceRefresh) {
    cacheInvalidatePrefix(cacheKey);
  } else {
    const cached = cacheGet<MarketQuote>(cacheKey);
    if (cached) {
      return cached;
    }
  }

  await getStock(code);

  if (!forceRefresh) {
    const saved = await store.marketQuotes.getLatest(code);
    if (
      saved &&
      isOfficialDataSource(saved.source) &&
      isFresh(saved.fetched_at, QUOTE_TTL_MS)
    ) {
      cacheSet(cacheKey, saved, QUOTE_TTL_MS);
      return saved;
    }
  }

  const sidecarQuote = await fetchQuoteFromSidecar(code);
  if (sidecarQuote && isOfficialDataSource(sidecarQuote.source)) {
    await store.marketQuotes.insert(sidecarQuote);
    cacheSet(cacheKey, sidecarQuote, QUOTE_TTL_MS);
    return sidecarQuote;
  }

  const snapshot = await store.marketQuotes.getLatest(code);
  if (snapshot && isOfficialDataSource(snapshot.source)) {
    const degraded = markDegradedSnapshot(snapshot);
    // 降级快照只做短缓存：冷却结束后立刻重试真实数据源。
    cacheSet(cacheKey, degraded, DATA_SOURCE_RETRY_AFTER_MS);
    return degraded;
  }

  throw new DataSourceUnavailableError(`股票 ${code} 行情快照`);
}

/**
 * 获取 K 线数据。
 * 数据源不可用时回退到最近的官方 K 线快照并标注降级；没有任何官方快照时抛出数据源故障。
 */
export async function getKlines(
  code: string,
  period: KlinePeriod,
  adjust: AdjustType,
  limit: number,
  forceRefresh = false,
): Promise<Kline[]> {
  const cacheKey = `kline:${code}:${period}:${adjust}:${limit}`;
  if (forceRefresh) {
    cacheInvalidatePrefix(`kline:${code}`);
  } else {
    const cached = cacheGet<Kline[]>(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const ttlMs =
    period === "minute"
      ? MINUTE_KLINE_TTL_MS
      : period === "day"
        ? DAY_KLINE_TTL_MS
        : period === "week"
          ? WEEK_KLINE_TTL_MS
          : MONTH_KLINE_TTL_MS;

  if (!forceRefresh) {
    const saved = officialRecords(await store.klines.list(code, period, adjust, limit));
    if (
      saved.length > 0 &&
      saved.every(
        (item) => typeof item.fetched_at === "string" && isFresh(item.fetched_at, ttlMs),
      )
    ) {
      cacheSet(cacheKey, saved, ttlMs);
      return saved;
    }
  }

  const sidecarKlines = await fetchKlinesFromSidecar(code, period, adjust, limit);
  const fetched = sidecarKlines ? officialRecords(sidecarKlines) : [];
  if (fetched.length > 0) {
    await store.klines.insertMany(fetched);
    const klines = fetched.slice(-limit);
    cacheSet(cacheKey, klines, ttlMs);
    return klines;
  }

  const snapshot = officialRecords(await store.klines.list(code, period, adjust, limit));
  if (snapshot.length > 0) {
    const degraded = snapshot.slice(-limit).map((item) => markDegradedSnapshot(item));
    // 降级快照只做短缓存：冷却结束后立刻重试真实数据源。
    cacheSet(cacheKey, degraded, DATA_SOURCE_RETRY_AFTER_MS);
    return degraded;
  }

  throw new DataSourceUnavailableError(`股票 ${code} ${period} K 线`);
}

/** 获取本地计算的技术指标。 */
export async function getIndicators(
  code: string,
  period: KlinePeriod,
): Promise<TechnicalIndicators> {
  const cacheKey = `indicators:${code}:${period}`;
  return cacheGetOrSet(cacheKey, INDICATOR_TTL_MS, async () => {
    const klines = await getKlines(code, period, "qfq", 120);
    return calculateIndicators(klines, code, period);
  });
}

/** 强制刷新行情与 K 线缓存。 */
export async function refreshMarketData(code: string): Promise<void> {
  await getMarketQuote(code, true);
  await getKlines(code, "day", "qfq", 120, true);
}
