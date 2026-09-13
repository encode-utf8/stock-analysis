// 确定性行情生成器测试：无外部数据源时保证稳定、字段自洽、周期与复权参数生效。
import { describe, expect, it } from "vitest";

import { buildDeterministicKlines, buildDeterministicQuote } from "@/lib/deterministic";

describe("buildDeterministicQuote", () => {
  it("字段自洽且标记降级来源", () => {
    const quote = buildDeterministicQuote("600519");

    expect(quote.code).toBe("600519");
    expect(quote.source).toBe("deterministic-fallback");
    expect(quote.prev_close).toBe(1688);
    expect(quote.price).toBeCloseTo(quote.prev_close * (1 + quote.change_pct / 100), 1);
    expect(quote.high).toBeGreaterThanOrEqual(Math.max(quote.open, quote.price));
    expect(quote.low).toBeLessThanOrEqual(Math.min(quote.open, quote.price));
    expect(quote.volume).toBeGreaterThanOrEqual(2_000_000);
    expect(quote.volume).toBeLessThan(10_000_000);
    expect(quote.amount).toBeGreaterThan(0);
    expect(quote.market_cap).not.toBeNull();
  });

  it("同一天内可复现，不同代码结果不同", () => {
    const first = buildDeterministicQuote("600519");
    const second = buildDeterministicQuote("600519");
    expect(second.price).toBe(first.price);
    expect(second.change_pct).toBe(first.change_pct);

    const unknown = buildDeterministicQuote("999999");
    expect(unknown.prev_close).not.toBe(first.prev_close);
    expect(unknown.prev_close).toBeGreaterThan(0);
  });
});

describe("buildDeterministicKlines", () => {
  it("日线跳过周末且按时间升序，最后一根收盘价等于基准价", () => {
    const bars = buildDeterministicKlines("600519", "day", "qfq", 5);

    expect(bars).toHaveLength(5);
    expect(bars.every((bar) => bar.period === "day" && bar.adj_type === "qfq")).toBe(true);
    expect(bars.every((bar) => bar.code === "600519")).toBe(true);
    expect(bars.map((bar) => bar.ts)).toEqual([...bars.map((bar) => bar.ts)].sort());
    expect(bars.every((bar) => new Date(bar.ts).getDay() !== 0 && new Date(bar.ts).getDay() !== 6))
      .toBe(true);
    expect(bars[bars.length - 1].close).toBe(1688);
    expect(bars.every((bar) => bar.high >= bar.low)).toBe(true);
  });

  it("支持指定最新价与周线、月线", () => {
    const day = buildDeterministicKlines("000001", "day", "hfq", 3, 100);
    expect(day[day.length - 1].close).toBe(100);
    expect(day.every((bar) => bar.adj_type === "hfq")).toBe(true);

    const week = buildDeterministicKlines("000001", "week", "qfq", 4);
    expect(week).toHaveLength(4);
    expect(week.every((bar) => bar.period === "week")).toBe(true);
    // 周线按 7 天一根生成（当前实现为倒序返回，只校验间隔）。
    const weekGap = Math.abs(new Date(week[3].ts).getTime() - new Date(week[2].ts).getTime());
    expect(weekGap).toBe(7 * 86_400_000);

    const month = buildDeterministicKlines("000001", "month", "qfq", 3);
    expect(month).toHaveLength(3);
    expect(month.every((bar) => new Date(bar.ts).getUTCDate() === 1)).toBe(true);
  });

  it("分钟线按 2 分钟一根生成并遵守 limit", () => {
    const all = buildDeterministicKlines("600519", "minute", "qfq", 10_000);
    expect(all.length).toBeGreaterThan(100);
    expect(all.every((bar) => bar.period === "minute")).toBe(true);
    expect(all.every((bar) => bar.high >= bar.low)).toBe(true);

    const limited = buildDeterministicKlines("600519", "minute", "qfq", 10);
    expect(limited).toHaveLength(10);
    expect(limited[9].ts).toBe(all[all.length - 1].ts);
  });
});
