// 交易日历测试：日期键工具、日历构造与侧车加载回退（fetch 全部 stub）。
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  beijingDateKey,
  buildFallbackTradingCalendar,
  buildTradingCalendar,
  FALLBACK_CALENDAR_SOURCE,
  getTradingCalendar,
  isWeekdayKey,
  shiftDateKey,
} from "@/lib/trading-calendar";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 用给定响应体 stub 全局 fetch。 */
function stubFetch(impl: () => Promise<unknown>): void {
  vi.stubGlobal("fetch", vi.fn(impl));
}

describe("日期键工具", () => {
  it("按北京时间取日期键", () => {
    expect(beijingDateKey(new Date("2026-09-12T23:30:00.000Z"))).toBe("2026-09-13");
    expect(beijingDateKey(new Date("2026-09-13T02:00:00.000Z"))).toBe("2026-09-13");
  });

  it("按天数平移日期键", () => {
    expect(shiftDateKey("2026-09-13", -1)).toBe("2026-09-12");
    expect(shiftDateKey("2026-09-13", 3)).toBe("2026-09-16");
  });

  it("识别工作日与非法输入", () => {
    expect(isWeekdayKey("2026-09-11")).toBe(true);
    expect(isWeekdayKey("2026-09-13")).toBe(false);
    expect(isWeekdayKey("not-a-date")).toBe(false);
  });
});

describe("buildTradingCalendar", () => {
  it("去重排序并剔除非日期项", () => {
    const calendar = buildTradingCalendar({
      source: "akshare",
      fetched_at: "2026-09-13T00:00:00.000Z",
      days: ["2026-09-11", "2026-09-09", "2026-09-11", "bad"],
    });

    expect(calendar.first_day).toBe("2026-09-09");
    expect(calendar.last_day).toBe("2026-09-11");
    expect(calendar.days.size).toBe(2);
  });

  it("覆盖区间内按日历判定，区间外退回工作日近似", () => {
    const calendar = buildTradingCalendar({
      source: "akshare",
      fetched_at: "2026-09-13T00:00:00.000Z",
      days: ["2026-09-09", "2026-09-11"],
    });

    expect(calendar.isTradingDay("2026-09-11")).toBe(true);
    // 在覆盖区间内却不在交易日列表中，视为休市日。
    expect(calendar.isTradingDay("2026-09-10")).toBe(false);
    // 超出覆盖区间，退回工作日近似。
    expect(calendar.isTradingDay("2026-10-12")).toBe(true);
    expect(calendar.isTradingDay("2026-10-11")).toBe(false);
  });

  it("降级日历始终按工作日近似", () => {
    const calendar = buildFallbackTradingCalendar(new Date("2026-09-13T00:00:00.000Z"));
    expect(calendar.source).toBe(FALLBACK_CALENDAR_SOURCE);
    expect(calendar.days.size).toBe(0);
    expect(calendar.isTradingDay("2026-09-11")).toBe(true);
    expect(calendar.isTradingDay("2026-09-12")).toBe(false);
  });
});

describe("getTradingCalendar", () => {
  it("成功时使用侧车日历", async () => {
    stubFetch(async () => ({
      ok: true,
      json: async () => ({
        source: "akshare",
        fetched_at: "2026-09-13T00:00:00.000Z",
        days: ["2026-09-11"],
      }),
    }));

    const calendar = await getTradingCalendar(true);
    expect(calendar.source).toBe("akshare");
    expect(calendar.isTradingDay("2026-09-11")).toBe(true);
  });

  it("HTTP 失败、空日历与降级来源都退回工作日近似", async () => {
    stubFetch(async () => ({ ok: false, json: async () => ({}) }));
    expect((await getTradingCalendar(true)).source).toBe(FALLBACK_CALENDAR_SOURCE);

    stubFetch(async () => ({ ok: true, json: async () => ({ source: "akshare", days: [] }) }));
    expect((await getTradingCalendar(true)).source).toBe(FALLBACK_CALENDAR_SOURCE);

    stubFetch(async () => ({
      ok: true,
      json: async () => ({ source: FALLBACK_CALENDAR_SOURCE, days: ["2026-09-11"] }),
    }));
    expect((await getTradingCalendar(true)).source).toBe(FALLBACK_CALENDAR_SOURCE);
  });

  it("网络异常时退回工作日近似", async () => {
    stubFetch(async () => {
      throw new Error("sidecar down");
    });

    expect((await getTradingCalendar(true)).source).toBe(FALLBACK_CALENDAR_SOURCE);
  });

  it("非强制刷新命中缓存，不再请求侧车", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        source: "akshare",
        fetched_at: "2026-09-13T00:00:00.000Z",
        days: ["2026-09-11"],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await getTradingCalendar(true);
    const second = await getTradingCalendar();

    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
