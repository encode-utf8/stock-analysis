// 基金数据编排：缓存命中优先，其次内存 Store，再次数据侧车，最后确定性回退。

import { cacheGet, cacheInvalidatePrefix, cacheSet } from "@/lib/cache";
import {
  buildDeterministicFundNav,
  buildDeterministicFundProfile,
} from "@/lib/fund-deterministic";
import { fundDataStore } from "@/lib/fund-data-store";
import { recordExternalCall } from "@/lib/observability";
import type { FundNavPoint, FundProfile } from "@/lib/shared/types";

export type FundNavRange = "1m" | "3m" | "6m" | "1y" | "3y" | "all";
export type FundNavType = "unit" | "cumulative";

const DEFAULT_DATA_SERVICE_URL = "http://127.0.0.1:8000";
const PROFILE_TTL_MS = 24 * 60 * 60_000;
const NAV_TTL_MS = 6 * 60 * 60_000;
const PROFILE_CACHE_VERSION = "v2";
const SIDE_CAR_TIMEOUT_MS = 10_000;
const FUND_PROFILE_TIMEOUT_MS = 30_000;
const FUND_NAV_TIMEOUT_MS = 20_000;

const fundProfileStore = new Map<string, FundProfile>();
const fundNavStore = new Map<string, FundNavPoint[]>();

function dataServiceUrl(): string {
  return (process.env.DATA_SERVICE_URL ?? DEFAULT_DATA_SERVICE_URL).replace(/\/$/, "");
}

function isFresh(timestamp: string, ttlMs: number): boolean {
  const age = Date.now() - new Date(timestamp).getTime();
  return Number.isFinite(age) && age >= 0 && age <= ttlMs;
}

async function fetchJson<T>(path: string, timeoutMs = SIDE_CAR_TIMEOUT_MS): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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

function isFundProfile(value: unknown): value is FundProfile {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<FundProfile>;
  return (
    typeof item.code === "string" &&
    typeof item.name === "string" &&
    typeof item.type === "string" &&
    typeof item.trading_mode === "string" &&
    typeof item.source === "string" &&
    typeof item.fetched_at === "string"
  );
}

function isFundNavList(value: unknown): value is FundNavPoint[] {
  return (
    Array.isArray(value) &&
    value.every((item) => {
      if (!item || typeof item !== "object") {
        return false;
      }
      const nav = item as Partial<FundNavPoint>;
      return (
        typeof nav.code === "string" &&
        typeof nav.nav_date === "string" &&
        typeof nav.unit_nav === "number" &&
        typeof nav.cumulative_nav === "number" &&
        typeof nav.source === "string" &&
        typeof nav.fetched_at === "string"
      );
    })
  );
}

/** 从基金数据侧车获取档案。 */
async function fetchFundProfileFromSidecar(code: string): Promise<FundProfile | null> {
  try {
    const data = await fetchJson<FundProfile>(
      `/fund/profile?code=${encodeURIComponent(code)}`,
      FUND_PROFILE_TIMEOUT_MS,
    );
    recordExternalCall(Boolean(data));
    return isFundProfile(data) ? data : null;
  } catch {
    recordExternalCall(false);
    return null;
  }
}

/** 从基金数据侧车获取历史净值。 */
async function fetchFundNavFromSidecar(
  code: string,
  startDate: string,
  endDate: string,
): Promise<FundNavPoint[] | null> {
  try {
    const params = new URLSearchParams({ code, start: startDate, end: endDate });
    const data = await fetchJson<FundNavPoint[]>(
      `/fund/nav?${params.toString()}`,
      FUND_NAV_TIMEOUT_MS,
    );
    recordExternalCall(Boolean(data));
    return isFundNavList(data) && data.length > 0 ? data : null;
  } catch {
    recordExternalCall(false);
    return null;
  }
}

/** 将净值区间转换为起止日期。 */
export function fundNavDateRange(range: FundNavRange): {
  startDate: string;
  endDate: string;
} {
  const end = new Date();
  const daysByRange: Record<Exclude<FundNavRange, "all">, number> = {
    "1m": 30,
    "3m": 90,
    "6m": 180,
    "1y": 365,
    "3y": 1095,
  };
  const start = new Date(end);
  if (range !== "all") {
    start.setDate(start.getDate() - daysByRange[range]);
  } else {
    start.setFullYear(start.getFullYear() - 20);
  }

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

/** 获取基金档案。 */
export async function getFundProfile(
  code: string,
  forceRefresh = false,
): Promise<FundProfile> {
  const cacheKey = `fund:profile:${PROFILE_CACHE_VERSION}:${code}`;
  const storeKey = `${PROFILE_CACHE_VERSION}:${code}`;
  if (forceRefresh) {
    cacheInvalidatePrefix(cacheKey);
  }

  const cached = cacheGet<FundProfile>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const loader = async (): Promise<FundProfile> => {
    if (!forceRefresh) {
      const saved = fundProfileStore.get(storeKey);
      if (
        saved &&
        saved.source !== "deterministic-fallback" &&
        isFresh(saved.fetched_at, PROFILE_TTL_MS)
      ) {
        return saved;
      }

      const persisted = await fundDataStore.profiles.getByCode(code);
      if (
        persisted &&
        persisted.source !== "deterministic-fallback" &&
        isFresh(persisted.fetched_at, PROFILE_TTL_MS)
      ) {
        fundProfileStore.set(storeKey, persisted);
        return persisted;
      }
    }

    const sidecarProfile = await fetchFundProfileFromSidecar(code);
    const profile = sidecarProfile ?? buildDeterministicFundProfile(code);
    fundProfileStore.set(storeKey, profile);
    await fundDataStore.profiles.upsert(profile);
    return profile;
  };

  const profile = await loader();
  if (profile.source !== "deterministic-fallback") {
    cacheSet(cacheKey, profile, PROFILE_TTL_MS);
  }
  return profile;
}

/** 获取指定区间历史净值；接口始终返回单位与累计净值，便于前端无请求切换口径。 */
export async function getFundNav(
  code: string,
  range: FundNavRange,
  navType: FundNavType,
  forceRefresh = false,
): Promise<FundNavPoint[]> {
  const { startDate, endDate } = fundNavDateRange(range);
  const cacheKey = `fund:nav:${code}:${startDate}:${endDate}:${navType}`;
  if (forceRefresh) {
    cacheInvalidatePrefix(`fund:nav:${code}`);
  }

  const cached = cacheGet<FundNavPoint[]>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const loader = async (): Promise<FundNavPoint[]> => {
    if (!forceRefresh) {
      const saved = fundNavStore.get(cacheKey);
      if (
        saved &&
        saved.length > 0 &&
        saved.every((item) => item.source !== "deterministic-fallback") &&
        saved.every(
          (item) =>
            typeof item.fetched_at === "string" &&
            isFresh(item.fetched_at, NAV_TTL_MS),
        )
      ) {
        return saved;
      }

      const persistedNav = await fundDataStore.navs.list(code);
      const persisted = persistedNav.filter(
        (item) =>
          item.nav_date >= startDate &&
          item.nav_date <= endDate &&
          item.source !== "deterministic-fallback" &&
          typeof item.fetched_at === "string" &&
          isFresh(item.fetched_at, NAV_TTL_MS),
      );
      if (persisted.length > 0) {
        fundNavStore.set(cacheKey, persisted);
        return persisted;
      }
    }

    const sidecarNav = await fetchFundNavFromSidecar(code, startDate, endDate);
    const nav = sidecarNav ?? buildDeterministicFundNav(code, startDate, endDate);
    fundNavStore.set(cacheKey, nav);
    await fundDataStore.navs.insertMany(nav);
    return nav;
  };

  const nav = await loader();
  if (nav.length > 0 && nav[0]?.source !== "deterministic-fallback") {
    cacheSet(cacheKey, nav, NAV_TTL_MS);
  }
  return nav;
}
