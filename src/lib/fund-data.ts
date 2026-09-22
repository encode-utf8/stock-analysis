// 基金数据编排：缓存 → 内存 Store → 数据侧车官方数据 → 官方快照（标注降级）→ 抛数据源故障。
// 约定：确定性降级数据不面向用户返回。

import { cacheGet, cacheInvalidatePrefix, cacheSet } from "@/lib/cache";
import { DataSourceUnavailableError, markDegradedSnapshot } from "@/lib/datasource";
import { fundDataStore } from "@/lib/fund-data-store";
import { isUsableNavSource } from "@/lib/fund-nav-settlement";
import { recordExternalCall } from "@/lib/observability";
import { DATA_SOURCE_RETRY_AFTER_MS, isOfficialDataSource } from "@/lib/shared/types";
import { beijingDateKey } from "@/lib/trading-calendar";
import type { FundNavPoint, FundProfile } from "@/lib/shared/types";

export type FundNavRange = "1m" | "3m" | "6m" | "1y" | "3y" | "all";
export type FundNavType = "unit" | "cumulative";

const DEFAULT_DATA_SERVICE_URL = "http://127.0.0.1:8000";
const PROFILE_TTL_MS = 24 * 60 * 60_000;
const NAV_TTL_MS = 6 * 60 * 60_000;
/** 最新净值点不是今天的缓存有效期：官方净值随时可能公布，10 分钟后重取。 */
const NAV_REFRESH_TTL_MS = 10 * 60_000;
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

/**
 * 净值缓存有效期：最新点属于今天（当天不会再变）→ 6 小时；否则 10 分钟。
 * 收盘后官方净值随时可能公布，窗口期内缓存 6 小时会让晚上进页面仍读到
 * 「只有昨天净值」的旧数据，看不到当天已公布的真实净值。
 */
export function resolveNavCacheTtlMs(
  points: readonly FundNavPoint[],
  today: string = beijingDateKey(new Date()),
): number {
  const publishedToday = points.some(
    (point) => isUsableNavSource(point.source) && point.nav_date === today,
  );
  return publishedToday ? NAV_TTL_MS : NAV_REFRESH_TTL_MS;
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

const NAV_RANGE_COVERAGE_TOLERANCE_MS = 14 * 24 * 60 * 60 * 1000;

function navCoversRange(
  nav: FundNavPoint[],
  startDate: string,
  endDate: string,
): boolean {
  if (nav.length === 0) {
    return false;
  }
  const sorted = nav
    .slice()
    .sort((left, right) => left.nav_date.localeCompare(right.nav_date));
  const firstDate = new Date(`${sorted[0]?.nav_date ?? startDate}T00:00:00Z`).getTime();
  const lastDate = new Date(`${sorted.at(-1)?.nav_date ?? endDate}T00:00:00Z`).getTime();
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  return (
    firstDate <= start + NAV_RANGE_COVERAGE_TOLERANCE_MS &&
    lastDate >= end - NAV_RANGE_COVERAGE_TOLERANCE_MS
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
        isOfficialDataSource(saved.source) &&
        isFresh(saved.fetched_at, PROFILE_TTL_MS)
      ) {
        return saved;
      }

      const persisted = await fundDataStore.profiles.getByCode(code);
      if (
        persisted &&
        isOfficialDataSource(persisted.source) &&
        isFresh(persisted.fetched_at, PROFILE_TTL_MS)
      ) {
        fundProfileStore.set(storeKey, persisted);
        return persisted;
      }
    }

    const sidecarProfile = await fetchFundProfileFromSidecar(code);
    const official =
      sidecarProfile && isOfficialDataSource(sidecarProfile.source) ? sidecarProfile : null;
    if (official) {
      fundProfileStore.set(storeKey, official);
      await fundDataStore.profiles.upsert(official);
      cacheSet(cacheKey, official, PROFILE_TTL_MS);
      return official;
    }

    // 侧车不可达或只返回合成数据：回退到最近的官方快照并标注降级。
    const snapshot =
      fundProfileStore.get(storeKey) ?? (await fundDataStore.profiles.getByCode(code));
    if (snapshot && isOfficialDataSource(snapshot.source)) {
      const degraded = markDegradedSnapshot(snapshot);
      fundProfileStore.set(storeKey, degraded);
      cacheSet(cacheKey, degraded, DATA_SOURCE_RETRY_AFTER_MS);
      return degraded;
    }

    throw new DataSourceUnavailableError(`基金 ${code} 档案`);
  };

  return loader();
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
    if (!forceRefresh && range !== "all") {
      const saved = fundNavStore.get(cacheKey);
      if (
        saved &&
        saved.length > 0 &&
        saved.every((item) => item.source !== "deterministic-fallback") &&
        saved.every(
          (item) =>
            typeof item.fetched_at === "string" &&
            isFresh(item.fetched_at, resolveNavCacheTtlMs(saved)),
        ) &&
        navCoversRange(saved, startDate, endDate)
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
          isFresh(item.fetched_at, resolveNavCacheTtlMs(persistedNav)),
      );
      if (persisted.length > 0 && navCoversRange(persisted, startDate, endDate)) {
        fundNavStore.set(cacheKey, persisted);
        return persisted;
      }
    }

    const sidecarNav = await fetchFundNavFromSidecar(code, startDate, endDate);
    const official = sidecarNav ? sidecarNav.filter((item) => isOfficialDataSource(item.source)) : [];
    if (official.length > 0) {
      fundNavStore.set(cacheKey, official);
      await fundDataStore.navs.insertMany(official);
      cacheSet(cacheKey, official, resolveNavCacheTtlMs(official));
      return official;
    }

    // 侧车不可达或只返回合成数据：回退到区间内最近的官方净值快照并标注降级。
    const snapshotPersisted = (
      await fundDataStore.navs.list(code)
    ).filter(
      (item) =>
        item.nav_date >= startDate &&
        item.nav_date <= endDate &&
        isOfficialDataSource(item.source),
    );
    const snapshot =
      snapshotPersisted.length > 0
        ? snapshotPersisted
        : (fundNavStore.get(cacheKey) ?? []).filter((item) => isOfficialDataSource(item.source));
    if (snapshot.length > 0) {
      const degraded = snapshot
        .slice()
        .sort((left, right) => left.nav_date.localeCompare(right.nav_date))
        .map((item) => markDegradedSnapshot(item));
      fundNavStore.set(cacheKey, degraded);
      cacheSet(cacheKey, degraded, DATA_SOURCE_RETRY_AFTER_MS);
      return degraded;
    }

    throw new DataSourceUnavailableError(`基金 ${code} 历史净值`);
  };

  return loader();
}
