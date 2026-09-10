// FastAPI 行情侧车客户端：失败时回退确定性数据，保证单机可运行。
import type { CodeVerifyResult } from "@/lib/code-verify";
import { recordExternalCall } from "@/lib/observability";
import type {
  AdjustType,
  IndexKlineSeries,
  IndexQuoteSnapshot,
  Kline,
  KlinePeriod,
  MarketBreadthSnapshot,
  MarketQuote,
  MarketSectorsSnapshot,
} from "@/lib/shared/types";

const DEFAULT_DATA_SERVICE_URL = "http://127.0.0.1:8000";
const REQUEST_TIMEOUT_MS = 6_000;
const QUOTE_TIMEOUT_MS = 3_000;
const KLINE_TIMEOUT_MS = 5_000;
// 代码存在性校验会串联多个上游（基金名录可能较慢），超时放宽到 15 秒。
const VERIFY_TIMEOUT_MS = 15_000;

/** 获取侧车地址，读取环境变量或使用默认值。 */
function dataServiceUrl(): string {
  return (process.env.DATA_SERVICE_URL ?? DEFAULT_DATA_SERVICE_URL).replace(/\/$/, "");
}

/** 带超时的 JSON 请求。 */
async function fetchJson<T>(path: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${dataServiceUrl()}${path}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`行情侧车响应异常：${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** 校验侧车返回的行情结构是否可用。 */
function isQuote(value: unknown): value is MarketQuote {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<MarketQuote>;
  return (
    typeof item.code === "string" &&
    typeof item.price === "number" &&
    typeof item.source === "string" &&
    typeof item.fetched_at === "string"
  );
}

/** 校验侧车返回的 K 线结构是否可用。 */
function isKlineList(value: unknown): value is Kline[] {
  return Array.isArray(value) && value.every((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }
    const kline = item as Partial<Kline>;
    return (
      typeof kline.code === "string" &&
      typeof kline.ts === "string" &&
      typeof kline.close === "number"
    );
  });
}

/** 从行情侧车获取当前行情；不可用时返回 null。 */
export async function fetchQuoteFromSidecar(code: string): Promise<MarketQuote | null> {
  try {
    const data = await fetchJson<MarketQuote>(
      `/quote?code=${encodeURIComponent(code)}`,
      QUOTE_TIMEOUT_MS,
    );
    recordExternalCall(true);
    return isQuote(data) ? data : null;
  } catch {
    recordExternalCall(false);
    return null;
  }
}

/** 校验侧车返回的代码存在性结构是否可用。 */
function isCodeVerifyResult(value: unknown): value is CodeVerifyResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<CodeVerifyResult>;
  return (
    typeof item.code === "string" &&
    (item.status === "ok" ||
      item.status === "not_found" ||
      item.status === "upstream_unavailable")
  );
}

/** 请求侧车代码校验接口；侧车不可达或响应异常时返回 null（按上游不可用处理）。 */
async function verifyCodeFromSidecar(path: string): Promise<CodeVerifyResult | null> {
  try {
    const data = await fetchJson<CodeVerifyResult>(path, VERIFY_TIMEOUT_MS);
    recordExternalCall(true);
    return isCodeVerifyResult(data) ? data : null;
  } catch {
    recordExternalCall(false);
    return null;
  }
}

/** 校验股票代码在当前行情源是否存在。 */
export async function verifyStockCode(code: string): Promise<CodeVerifyResult | null> {
  return verifyCodeFromSidecar(`/quote/verify?code=${encodeURIComponent(code)}`);
}

/** 校验基金代码在权威基金名录与行情源是否存在。 */
export async function verifyFundCode(code: string): Promise<CodeVerifyResult | null> {
  return verifyCodeFromSidecar(`/fund/verify?code=${encodeURIComponent(code)}`);
}
/** 从行情侧车获取 K 线；不可用时返回 null。 */
export async function fetchKlinesFromSidecar(
  code: string,
  period: KlinePeriod,
  adjust: AdjustType,
  limit: number,
): Promise<Kline[] | null> {
  try {
    const params = new URLSearchParams({
      code,
      period,
      adjust,
      limit: String(limit),
    });
    const data = await fetchJson<Kline[]>(
      `/kline?${params.toString()}`,
      KLINE_TIMEOUT_MS,
    );
    recordExternalCall(true);
    return isKlineList(data) ? data : null;
  } catch {
    recordExternalCall(false);
    return null;
  }
}

const INDEX_TIMEOUT_MS = 5_000;
const MARKET_TIMEOUT_MS = 10_000;

/** 指数代码格式（sh/sz + 6 位数字）；侧车仍会做白名单二次校验。 */
const INDEX_CODE_PATTERN = /^(sh|sz)\d{6}$/;

function isIndexQuote(value: unknown): value is IndexQuoteSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<IndexQuoteSnapshot>;
  return (
    typeof item.code === "string" &&
    typeof item.name === "string" &&
    typeof item.price === "number" &&
    typeof item.change_pct === "number" &&
    typeof item.fetched_at === "string"
  );
}

function isIndexKlineSeries(value: unknown): value is IndexKlineSeries {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<IndexKlineSeries>;
  return (
    typeof item.code === "string" &&
    Array.isArray(item.days) &&
    item.days.every(
      (day) =>
        Boolean(day) &&
        typeof day.date === "string" &&
        typeof day.close === "number",
    )
  );
}

function isMarketBreadth(value: unknown): value is MarketBreadthSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<MarketBreadthSnapshot>;
  return (
    typeof item.up === "number" &&
    typeof item.down === "number" &&
    typeof item.flat === "number" &&
    typeof item.source === "string"
  );
}

function isMarketSectors(value: unknown): value is MarketSectorsSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<MarketSectorsSnapshot>;
  return (
    Array.isArray(item.top) &&
    Array.isArray(item.bottom) &&
    typeof item.total === "number"
  );
}

/** 从行情侧车获取大盘指数行情；不可用或返回非法结构时返回空数组。 */
export async function fetchIndexQuotesFromSidecar(
  codes: readonly string[],
): Promise<IndexQuoteSnapshot[]> {
  const allowed = codes.filter((code) => INDEX_CODE_PATTERN.test(code));
  if (allowed.length === 0) {
    return [];
  }
  try {
    const data = await fetchJson<{ quotes?: unknown }>(
      `/index/quote?codes=${encodeURIComponent(allowed.join(","))}`,
      INDEX_TIMEOUT_MS,
    );
    recordExternalCall(true);
    return Array.isArray(data.quotes) ? data.quotes.filter(isIndexQuote) : [];
  } catch {
    recordExternalCall(false);
    return [];
  }
}

/** 从行情侧车获取指数日线；用于按指定日期补生成历史日报。 */
export async function fetchIndexKlineFromSidecar(
  code: string,
  limit: number,
): Promise<IndexKlineSeries | null> {
  if (!INDEX_CODE_PATTERN.test(code)) {
    return null;
  }
  try {
    const data = await fetchJson<unknown>(
      `/index/kline?code=${encodeURIComponent(code)}&limit=${limit}`,
      INDEX_TIMEOUT_MS,
    );
    recordExternalCall(true);
    return isIndexKlineSeries(data) ? data : null;
  } catch {
    recordExternalCall(false);
    return null;
  }
}

/** 从行情侧车获取全市场涨跌家数；不可用时返回 null。 */
export async function fetchMarketBreadthFromSidecar(): Promise<MarketBreadthSnapshot | null> {
  try {
    const data = await fetchJson<unknown>("/market/breadth", MARKET_TIMEOUT_MS);
    recordExternalCall(true);
    return isMarketBreadth(data) ? data : null;
  } catch {
    recordExternalCall(false);
    return null;
  }
}

/** 从行情侧车获取行业板块涨跌榜；不可用时返回 null。 */
export async function fetchMarketSectorsFromSidecar(
  limit = 5,
): Promise<MarketSectorsSnapshot | null> {
  try {
    const data = await fetchJson<unknown>(
      `/market/sectors?limit=${limit}`,
      MARKET_TIMEOUT_MS,
    );
    recordExternalCall(true);
    return isMarketSectors(data) ? data : null;
  } catch {
    recordExternalCall(false);
    return null;
  }
}