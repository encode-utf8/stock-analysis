// 基金当日行情数据编排：场内实时、场外盘中估算，缓存命中优先，其次侧车，最后确定性回退。

import { cacheGet, cacheInvalidatePrefix, cacheSet } from "@/lib/cache";
import { buildDeterministicFundIntraday } from "@/lib/fund-deterministic";
import { recordExternalCall } from "@/lib/observability";
import type { FundIntraday } from "@/lib/shared/types";

const DEFAULT_DATA_SERVICE_URL = "http://127.0.0.1:8000";
const INTRADAY_TTL_MS = 60_000;
const SIDE_CAR_TIMEOUT_MS = 15_000;

const fundIntradayStore = new Map<string, FundIntraday>();

function dataServiceUrl(): string {
  return (process.env.DATA_SERVICE_URL ?? DEFAULT_DATA_SERVICE_URL).replace(/\/$/, "");
}

function isFresh(timestamp: string, ttlMs: number): boolean {
  const age = Date.now() - new Date(timestamp).getTime();
  return Number.isFinite(age) && age >= 0 && age <= ttlMs;
}

async function fetchJson<T>(path: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SIDE_CAR_TIMEOUT_MS);
  try {
    const response = await fetch(`${dataServiceUrl()}${path}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isFundIntraday(value: unknown): value is FundIntraday {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<FundIntraday>;
  return (
    typeof item.code === "string" &&
    (item.mode === "realtime" || item.mode === "estimate") &&
    typeof item.ts === "string" &&
    (item.price === null || typeof item.price === "number") &&
    (item.estimated_nav === null || typeof item.estimated_nav === "number") &&
    (item.change_pct === null || typeof item.change_pct === "number") &&
    typeof item.source === "string" &&
    typeof item.fetched_at === "string"
  );
}

/** 获取基金当日行情/盘中估算。 */
export async function getFundIntraday(
  code: string,
  forceRefresh = false,
): Promise<FundIntraday> {
  const cacheKey = `fund:intraday:${code}`;
  if (forceRefresh) {
    cacheInvalidatePrefix(cacheKey);
  }

  const cached = cacheGet<FundIntraday>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const loader = async (): Promise<FundIntraday> => {
    if (!forceRefresh) {
      const saved = fundIntradayStore.get(code);
      if (
        saved &&
        saved.source !== "deterministic-fallback" &&
        isFresh(saved.fetched_at, INTRADAY_TTL_MS)
      ) {
        return saved;
      }
    }

    try {
      const sidecar = await fetchJson<FundIntraday>(
        `/fund/intraday?code=${encodeURIComponent(code)}`,
      );
      recordExternalCall(Boolean(sidecar));
      const intraday =
        sidecar && isFundIntraday(sidecar)
          ? sidecar
          : buildDeterministicFundIntraday(code);
      fundIntradayStore.set(code, intraday);
      return intraday;
    } catch {
      recordExternalCall(false);
      const intraday = buildDeterministicFundIntraday(code);
      fundIntradayStore.set(code, intraday);
      return intraday;
    }
  };

  const intraday = await loader();
  if (intraday.source !== "deterministic-fallback") {
    cacheSet(cacheKey, intraday, INTRADAY_TTL_MS);
  }
  return intraday;
}
