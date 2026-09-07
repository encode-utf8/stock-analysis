// 基金最新季度持仓编排：缓存命中优先，其次侧车，最后确定性回退。

import { cacheGet, cacheInvalidatePrefix, cacheSet } from "@/lib/cache";
import { buildDeterministicFundHoldings } from "@/lib/fund-deterministic";
import { recordExternalCall } from "@/lib/observability";
import type { FundHoldings } from "@/lib/shared/types";

const DEFAULT_DATA_SERVICE_URL = "http://127.0.0.1:8000";
const HOLDINGS_TTL_MS = 12 * 60 * 60_000;
const SIDE_CAR_TIMEOUT_MS = 15_000;

const fundHoldingsStore = new Map<string, FundHoldings>();

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

function isFundHoldings(value: unknown): value is FundHoldings {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<FundHoldings>;
  return (
    typeof item.code === "string" &&
    typeof item.report_date === "string" &&
    Array.isArray(item.top_holdings) &&
    item.top_holdings.every((holding) => {
      if (!holding || typeof holding !== "object") {
        return false;
      }
      const row = holding as Partial<FundHoldings["top_holdings"][number]>;
      return (
        (row.code === null || typeof row.code === "string") &&
        typeof row.name === "string" &&
        typeof row.weight_pct === "number" &&
        (row.change_pct === null || typeof row.change_pct === "number") &&
        (row.industry === null || typeof row.industry === "string")
      );
    }) &&
    typeof item.source === "string" &&
    typeof item.fetched_at === "string"
  );
}

/** 获取基金最新季度持仓。 */
export async function getFundHoldings(
  code: string,
  forceRefresh = false,
): Promise<FundHoldings> {
  const cacheKey = `fund:holdings:${code}`;
  if (forceRefresh) {
    cacheInvalidatePrefix(cacheKey);
  }

  const cached = cacheGet<FundHoldings>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const loader = async (): Promise<FundHoldings> => {
    if (!forceRefresh) {
      const saved = fundHoldingsStore.get(code);
      if (
        saved &&
        saved.source !== "deterministic-fallback" &&
        isFresh(saved.fetched_at, HOLDINGS_TTL_MS)
      ) {
        return saved;
      }
    }

    try {
      const sidecar = await fetchJson<FundHoldings>(
        `/fund/holdings?code=${encodeURIComponent(code)}`,
      );
      recordExternalCall(Boolean(sidecar));
      const holdings =
        sidecar && isFundHoldings(sidecar)
          ? sidecar
          : buildDeterministicFundHoldings(code);
      fundHoldingsStore.set(code, holdings);
      return holdings;
    } catch {
      recordExternalCall(false);
      const holdings = buildDeterministicFundHoldings(code);
      fundHoldingsStore.set(code, holdings);
      return holdings;
    }
  };

  const holdings = await loader();
  if (holdings.source !== "deterministic-fallback") {
    cacheSet(cacheKey, holdings, HOLDINGS_TTL_MS);
  }
  return holdings;
}
