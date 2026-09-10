// 历史复盘窗口与参数规范化回归测试。
import { describe, expect, it } from "vitest";

import { getReplayWindow, normalizeReplayDays } from "@/lib/replay";

describe("normalizeReplayDays", () => {
  it("默认窗口为 30 天", () => {
    expect(normalizeReplayDays(null)).toBe(30);
    expect(normalizeReplayDays(null, 90)).toBe(90);
  });

  it("非法输入回退默认值", () => {
    expect(normalizeReplayDays("abc")).toBe(30);
    expect(normalizeReplayDays("abc", 7)).toBe(7);
  });

  it("取值被限制在 1-365 天", () => {
    expect(normalizeReplayDays("7")).toBe(7);
    expect(normalizeReplayDays("0")).toBe(1);
    expect(normalizeReplayDays("-5")).toBe(1);
    expect(normalizeReplayDays("999")).toBe(365);
    expect(normalizeReplayDays("12.7")).toBe(12);
  });
});

describe("getReplayWindow", () => {
  it("按天数向前推算窗口起点", () => {
    const now = new Date("2024-03-31T00:00:00.000Z");
    expect(getReplayWindow(30, now)).toEqual({
      period_start: "2024-03-01T00:00:00.000Z",
      period_end: "2024-03-31T00:00:00.000Z",
    });
    expect(getReplayWindow(1, now).period_start).toBe("2024-03-30T00:00:00.000Z");
  });
});