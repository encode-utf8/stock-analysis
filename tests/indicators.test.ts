// 技术指标纯计算回归测试：MA / MACD / KDJ / RSI / BOLL。
import { describe, expect, it } from "vitest";

import { klinesFromCloses } from "./helpers/fixtures";

import {
  calculateBollSeries,
  calculateIndicators,
  calculateKdjSeries,
  calculateMacdSeries,
  calculateRsiSeries,
} from "@/lib/indicators";

describe("calculateRsiSeries", () => {
  it("数据不足时返回空数组", () => {
    expect(calculateRsiSeries([1, 2, 3], 5)).toEqual([]);
    expect(calculateRsiSeries([1, 2, 3, 4], 4)).toEqual([]);
  });

  it("持续上涨为 100，持续下跌为 0", () => {
    const up = Array.from({ length: 20 }, (_, index) => index + 1);
    const down = Array.from({ length: 20 }, (_, index) => 20 - index);

    const upSeries = calculateRsiSeries(up, 14);
    const downSeries = calculateRsiSeries(down, 14);

    expect(upSeries).toHaveLength(20);
    expect(upSeries.slice(0, 14)).toEqual(Array.from({ length: 14 }, () => null));
    expect(upSeries.at(-1)).toBe(100);
    expect(downSeries.at(-1)).toBe(0);
  });

  it("混合涨跌时结果落在 0-100 之间", () => {
    const series = calculateRsiSeries([10, 11, 12, 11, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], 14);
    const latest = series.at(-1);
    expect(latest).not.toBeNull();
    expect(latest as number).toBeGreaterThan(0);
    expect(latest as number).toBeLessThan(100);
  });
});

describe("calculateKdjSeries", () => {
  it("K 线不足 period 时返回空数组", () => {
    expect(calculateKdjSeries(klinesFromCloses(Array(8).fill(10)))).toEqual([]);
  });

  it("价格恒定时 K/D/J 收敛到 50", () => {
    const points = calculateKdjSeries(klinesFromCloses(Array(10).fill(10)));
    expect(points).toHaveLength(2);
    const latest = points.at(-1)!;
    expect(latest.k).toBeCloseTo(50, 10);
    expect(latest.d).toBeCloseTo(50, 10);
    expect(latest.j).toBeCloseTo(50, 10);
    expect(latest.index).toBe(9);
  });
});

describe("calculateBollSeries", () => {
  it("数据不足时返回空数组", () => {
    expect(calculateBollSeries(Array(19).fill(10))).toEqual([]);
  });

  it("价格恒定时上下轨与中轨重合", () => {
    const points = calculateBollSeries(Array(20).fill(10));
    expect(points).toHaveLength(1);
    expect(points[0]).toEqual({ index: 19, upper: 10, middle: 10, lower: 10 });
  });

  it("波动序列的上轨高于中轨、下轨低于中轨", () => {
    const values = Array.from({ length: 20 }, (_, index) => 10 + (index % 2 === 0 ? 1 : -1));
    const latest = calculateBollSeries(values).at(-1)!;
    expect(latest.upper).toBeGreaterThan(latest.middle);
    expect(latest.lower).toBeLessThan(latest.middle);
  });
});

describe("calculateMacdSeries", () => {
  it("有效 DIF 少于 9 个时返回空数组", () => {
    expect(calculateMacdSeries(Array(33).fill(10))).toEqual([]);
  });

  it("价格恒定时 DIF/DEA/柱状图均为 0", () => {
    const points = calculateMacdSeries(Array(40).fill(10));
    expect(points).toHaveLength(7);
    const latest = points.at(-1)!;
    expect(latest.dif).toBe(0);
    expect(latest.dea).toBe(0);
    expect(latest.histogram).toBe(0);
  });
});

describe("calculateIndicators", () => {
  it("样本充足时给出完整指标", () => {
    const result = calculateIndicators(klinesFromCloses(Array.from({ length: 70 }, (_, index) => index + 1)), "600519", "day");

    expect(result.code).toBe("600519");
    expect(result.period).toBe("day");
    expect(result.ma).toEqual({ ma5: 68, ma10: 65.5, ma20: 60.5, ma60: 40.5 });
    expect(result.rsi.rsi6).toBe(100);
    expect(result.rsi.rsi12).toBe(100);
    expect(result.boll.middle).toBe(60.5);
    expect(result.boll.upper).toBeCloseTo(72.03, 2);
    expect(result.boll.lower).toBeCloseTo(48.97, 2);
    expect(result.kdj.k).not.toBeNull();
    expect(Number.isNaN(new Date(result.updated_at).getTime())).toBe(false);
  });

  it("样本不足时相应字段为 null", () => {
    const result = calculateIndicators(klinesFromCloses(Array.from({ length: 10 }, (_, index) => index + 6)), "600519", "day");

    expect(result.ma.ma5).toBe(13);
    expect(result.ma.ma10).toBe(10.5);
    expect(result.ma.ma20).toBeNull();
    expect(result.ma.ma60).toBeNull();
    expect(result.macd).toEqual({ dif: null, dea: null, histogram: null });
    expect(result.boll).toEqual({ upper: null, middle: null, lower: null });
    expect(result.rsi.rsi6).toBe(100);
    expect(result.rsi.rsi12).toBeNull();
  });
});