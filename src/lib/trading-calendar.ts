// 交易日历：优先取行情侧车 /trading-calendar（AkShare），失败时回退「工作日」近似。
// 对外暴露同步的 isTradingDay，便于预警判定引擎保持纯函数。

import { recordExternalCall } from "@/lib/observability";

const DEFAULT_DATA_SERVICE_URL = "http://127.0.0.1:8000";
const SIDE_CAR_TIMEOUT_MS = 15_000;
/** 真实日历缓存 12 小时；降级日历缓存 5 分钟，便于尽快重试。 */
const CALENDAR_TTL_MS = 12 * 60 * 60 * 1000;
const FALLBACK_TTL_MS = 5 * 60 * 1000;
/** 向侧车请求的日期窗口（前后各约一年），覆盖跨年查询。 */
const RANGE_BACK_DAYS = 400;
const RANGE_FORWARD_DAYS = 400;

export const FALLBACK_CALENDAR_SOURCE = "weekday-fallback";

/** 交易日历查询能力；判定引擎只依赖 isTradingDay，便于测试注入。 */
export interface TradingCalendar {
  /** 数据来源：akshare 或 weekday-fallback。 */
  source: string;
  /** 日历抓取时间。 */
  fetched_at: string;
  /** 日历覆盖的交易日（北京日期 YYYY-MM-DD）。 */
  days: Set<string>;
  first_day: string | null;
  last_day: string | null;
  /** 是否为交易日：日历覆盖范围内按日历判定，超出范围退回工作日近似。 */
  isTradingDay(dateKey: string): boolean;
}

function dataServiceUrl(): string {
  return (process.env.DATA_SERVICE_URL ?? DEFAULT_DATA_SERVICE_URL).replace(/\/$/, "");
}

/** 按北京日期键（YYYY-MM-DD）解析星期；非法输入返回 null。 */
function weekdayOf(dateKey: string): number | null {
  const time = Date.parse(`${dateKey}T00:00:00Z`);
  if (!Number.isFinite(time)) {
    return null;
  }
  return new Date(time).getUTCDay();
}

/** 判断日期是否为工作日（周一至周五）。 */
export function isWeekdayKey(dateKey: string): boolean {
  const weekday = weekdayOf(dateKey);
  return weekday !== null && weekday >= 1 && weekday <= 5;
}

/** 取北京日期键；不依赖服务器时区。 */
export function beijingDateKey(now: Date): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 按天数平移日期键。 */
function shiftDateKey(dateKey: string, days: number): string {
  const time = Date.parse(`${dateKey}T00:00:00Z`);
  return new Date(time + days * 86_400_000).toISOString().slice(0, 10);
}

/** 由日期列表构造日历查询对象。 */
export function buildTradingCalendar(input: {
  source: string;
  fetched_at: string;
  days: string[];
}): TradingCalendar {
  const sorted = [...new Set(input.days.filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)))].sort();
  const set = new Set(sorted);
  const first = sorted[0] ?? null;
  const last = sorted[sorted.length - 1] ?? null;
  const trusted = input.source !== FALLBACK_CALENDAR_SOURCE;

  return {
    source: input.source,
    fetched_at: input.fetched_at,
    days: set,
    first_day: first,
    last_day: last,
    isTradingDay(dateKey: string) {
      if (set.has(dateKey)) {
        return true;
      }
      // 落在日历覆盖区间内却不在列表中，说明是休市日（含法定节假日）。
      if (trusted && first && last && dateKey >= first && dateKey <= last) {
        return false;
      }
      // 超出覆盖范围（或本身是降级日历）时退回工作日近似。
      return isWeekdayKey(dateKey);
    },
  };
}

/** 构造工作日近似的降级日历。 */
export function buildFallbackTradingCalendar(now: Date = new Date()): TradingCalendar {
  return buildTradingCalendar({
    source: FALLBACK_CALENDAR_SOURCE,
    fetched_at: now.toISOString(),
    days: [],
  });
}

let cached: { calendar: TradingCalendar; loadedAt: number } | null = null;
let inflight: Promise<TradingCalendar> | null = null;

async function loadTradingCalendar(): Promise<TradingCalendar> {
  const now = new Date();
  const today = beijingDateKey(now);
  const start = shiftDateKey(today, -RANGE_BACK_DAYS);
  const end = shiftDateKey(today, RANGE_FORWARD_DAYS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SIDE_CAR_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${dataServiceUrl()}/trading-calendar?start=${start}&end=${end}`,
      { signal: controller.signal, headers: { Accept: "application/json" }, cache: "no-store" },
    );
    if (!response.ok) {
      recordExternalCall(false);
      return buildFallbackTradingCalendar(now);
    }
    const payload = (await response.json()) as {
      source?: unknown;
      days?: unknown;
      fetched_at?: unknown;
    };
    const days = Array.isArray(payload.days)
      ? payload.days.filter((day): day is string => typeof day === "string")
      : [];
    if (
      days.length === 0 ||
      typeof payload.source !== "string" ||
      payload.source === FALLBACK_CALENDAR_SOURCE
    ) {
      recordExternalCall(false);
      return buildFallbackTradingCalendar(now);
    }
    recordExternalCall(true);
    return buildTradingCalendar({
      source: payload.source,
      fetched_at: typeof payload.fetched_at === "string" ? payload.fetched_at : now.toISOString(),
      days,
    });
  } catch {
    recordExternalCall(false);
    return buildFallbackTradingCalendar(now);
  } finally {
    clearTimeout(timer);
  }
}

/** 获取交易日历；真实日历缓存 12 小时，降级日历缓存 5 分钟。 */
export async function getTradingCalendar(forceRefresh = false): Promise<TradingCalendar> {
  const ttl = cached?.calendar.source === FALLBACK_CALENDAR_SOURCE ? FALLBACK_TTL_MS : CALENDAR_TTL_MS;
  if (!forceRefresh && cached && Date.now() - cached.loadedAt < ttl) {
    return cached.calendar;
  }
  if (!forceRefresh && inflight) {
    return inflight;
  }

  inflight = loadTradingCalendar();
  try {
    const calendar = await inflight;
    cached = { calendar, loadedAt: Date.now() };
    return calendar;
  } finally {
    inflight = null;
  }
}