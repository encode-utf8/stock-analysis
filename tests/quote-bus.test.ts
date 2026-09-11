// 行情推送总线纯逻辑回归测试：订阅合并去重、代码归一化与退避间隔。
import { afterEach, describe, expect, it } from "vitest";

import {
  __resetQuoteBusForTests,
  activeIntervalMs,
  computeNextIntervalMs,
  idleIntervalMs,
  mergeSubscriptions,
  normalizeCodes,
} from "@/lib/quote-bus";

/** 每个用例结束后清理环境变量与全局单例，避免相互污染。 */
afterEach(() => {
  delete process.env.QUOTE_STREAM_INTERVAL_MS;
  delete process.env.QUOTE_STREAM_IDLE_INTERVAL_MS;
  delete process.env.QUOTE_STREAM_MAX_CODES;
  __resetQuoteBusForTests();
});

describe("mergeSubscriptions", () => {
  it("多个订阅者的相同代码只拉取一次", () => {
    const merged = mergeSubscriptions([
      { target: "stock", codes: ["600519", "000001"] },
      { target: "stock", codes: ["600519", "510300"] },
    ]);
    expect(merged.stock).toEqual(["600519", "000001", "510300"]);
    expect(merged.fund).toEqual([]);
  });

  it("股票与基金的同代码分桶保存，互不覆盖", () => {
    const merged = mergeSubscriptions([
      { target: "stock", codes: ["600519"] },
      { target: "fund", codes: ["600519"] },
    ]);
    expect(merged.stock).toEqual(["600519"]);
    expect(merged.fund).toEqual(["600519"]);
  });

  it("过滤非法代码，并按上限截断", () => {
    const merged = mergeSubscriptions(
      [{ target: "stock", codes: ["600519", "abc", "12345", "000001", "510300"] }],
      2,
    );
    expect(merged.stock).toEqual(["600519", "000001"]);
  });
});

describe("normalizeCodes", () => {
  it("只保留 6 位数字并去重", () => {
    expect(normalizeCodes(["600519", "600519", "abc", "12345", "000001"])).toEqual([
      "600519",
      "000001",
    ]);
  });

  it("尊重传入的代码上限", () => {
    expect(normalizeCodes(["600519", "000001", "510300"], 2)).toEqual(["600519", "000001"]);
  });
});

describe("interval 配置", () => {
  it("默认按 5 秒推送、60 秒保活", () => {
    expect(activeIntervalMs()).toBe(5_000);
    expect(idleIntervalMs()).toBe(60_000);
  });

  it("低于下限的配置被收敛到下限", () => {
    process.env.QUOTE_STREAM_INTERVAL_MS = "1000";
    process.env.QUOTE_STREAM_IDLE_INTERVAL_MS = "2000";
    expect(activeIntervalMs()).toBe(3_000);
    expect(idleIntervalMs()).toBe(10_000);
  });
});

describe("computeNextIntervalMs", () => {
  it("正常情况返回基础间隔", () => {
    expect(computeNextIntervalMs({ marketClosed: false, consecutiveFailures: 0 })).toBe(5_000);
    expect(computeNextIntervalMs({ marketClosed: true, consecutiveFailures: 0 })).toBe(60_000);
  });

  it("连续失败按指数退避", () => {
    expect(computeNextIntervalMs({ marketClosed: false, consecutiveFailures: 1 })).toBe(10_000);
    expect(computeNextIntervalMs({ marketClosed: false, consecutiveFailures: 2 })).toBe(20_000);
    expect(computeNextIntervalMs({ marketClosed: false, consecutiveFailures: 4 })).toBe(80_000);
  });

  it("退避有上限，不会无限增长", () => {
    expect(computeNextIntervalMs({ marketClosed: true, consecutiveFailures: 4 })).toBe(120_000);
    expect(computeNextIntervalMs({ marketClosed: false, consecutiveFailures: 20 })).toBe(80_000);
  });

  it("自定义基础间隔参与退避计算", () => {
    process.env.QUOTE_STREAM_INTERVAL_MS = "4000";
    expect(computeNextIntervalMs({ marketClosed: false, consecutiveFailures: 2 })).toBe(16_000);
  });
});
