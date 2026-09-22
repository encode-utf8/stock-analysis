// 基金最新季度持仓编排：缓存 → 内存 store → 侧车官方数据 → 官方快照（标注降级）→ 抛数据源故障。

import { cacheGet, cacheInvalidatePrefix, cacheSet } from "@/lib/cache";
import { DataSourceUnavailableError, markDegradedSnapshot } from "@/lib/datasource";
import { fundDataStore } from "@/lib/fund-data-store";
import { recordExternalCall } from "@/lib/observability";
import { DATA_SOURCE_RETRY_AFTER_MS, isOfficialDataSource } from "@/lib/shared/types";
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
        isOfficialDataSource(saved.source) &&
        isFresh(saved.fetched_at, HOLDINGS_TTL_MS)
      ) {
        return saved;
      }

      const persisted = await fundDataStore.holdings.getLatest(code);
      if (
        persisted &&
        isOfficialDataSource(persisted.source) &&
        isFresh(persisted.fetched_at, HOLDINGS_TTL_MS)
      ) {
        fundHoldingsStore.set(code, persisted);
        return persisted;
      }
    }

    const sidecar = await fetchJson<FundHoldings>(
      `/fund/holdings?code=${encodeURIComponent(code)}`,
    );
    const official =
      sidecar && isFundHoldings(sidecar) && isOfficialDataSource(sidecar.source)
        ? sidecar
        : null;
    recordExternalCall(Boolean(official));
    if (official) {
      fundHoldingsStore.set(code, official);
      await fundDataStore.holdings.upsert(official);
      return official;
    }

    // 侧车不可达或只返回合成数据：回退到最近的官方快照并标注降级。
    const snapshot =
      fundHoldingsStore.get(code) ?? (await fundDataStore.holdings.getLatest(code));
    if (snapshot && isOfficialDataSource(snapshot.source)) {
      const degraded = markDegradedSnapshot(snapshot);
      fundHoldingsStore.set(code, degraded);
      cacheSet(cacheKey, degraded, DATA_SOURCE_RETRY_AFTER_MS);
      return degraded;
    }

    throw new DataSourceUnavailableError(`基金 ${code} 持仓`);
  };

  const holdings = await loader();
  if (isOfficialDataSource(holdings.source) && !holdings.degraded_snapshot) {
    cacheSet(cacheKey, holdings, HOLDINGS_TTL_MS);
  }
  return holdings;
}
