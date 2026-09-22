// 数据源可用性契约测试：官方来源判定、降级快照标注与统一错误响应。
import { describe, expect, it } from "vitest";

import {
  DataSourceUnavailableError,
  buildDataSourceFailurePayload,
  hasDegradedSnapshot,
  isDataSourceUnavailableError,
  markDegradedSnapshot,
  officialRecords,
} from "@/lib/datasource";
import {
  DATA_SOURCE_RETRY_AFTER_MS,
  DATA_SOURCE_UNAVAILABLE_MESSAGE,
  isOfficialDataSource,
  isSyntheticDataSource,
  isUsableSnapshotRecord,
  type MarketQuote,
} from "@/lib/shared/types";

/** 构造一条行情快照。 */
function quote(source: string | null): MarketQuote {
  return {
    code: "600519",
    ts: "2026-09-20T02:00:00.000Z",
    price: 1688,
    change_pct: 1.2,
    open: 1668,
    high: 1692,
    low: 1660,
    prev_close: 1667,
    volume: 3_280_000,
    amount: 5_500_000_000,
    turnover_rate: 0.26,
    pe: 22.4,
    pb: 8.1,
    market_cap: null,
    float_cap: null,
    source: source ?? "",
    fetched_at: "2026-09-20T02:00:00.000Z",
  };
}

describe("数据来源判定", () => {
  it("官方上游标识按来源无关大小写识别", () => {
    expect(isOfficialDataSource("akshare")).toBe(true);
    expect(isOfficialDataSource("Tencent")).toBe(true);
    expect(isOfficialDataSource(" eastmoney ")).toBe(true);
  });

  it("合成数据与空来源一律不算官方", () => {
    expect(isOfficialDataSource("deterministic-fallback")).toBe(false);
    expect(isOfficialDataSource(null)).toBe(false);
    expect(isOfficialDataSource(undefined)).toBe(false);
    expect(isOfficialDataSource("")).toBe(false);
    expect(isOfficialDataSource("tavily")).toBe(false);
  });

  it("合成数据判定覆盖确定性降级与演示资讯", () => {
    expect(isSyntheticDataSource("deterministic-fallback")).toBe(true);
    expect(isSyntheticDataSource("演示资讯源")).toBe(true);
    expect(isSyntheticDataSource("demo-news")).toBe(true);
    expect(isSyntheticDataSource("akshare")).toBe(false);
  });

  it("快照可用性要求来源为官方", () => {
    expect(isUsableSnapshotRecord(quote("akshare"))).toBe(true);
    expect(isUsableSnapshotRecord(quote("deterministic-fallback"))).toBe(false);
    expect(isUsableSnapshotRecord(null)).toBe(false);
  });
});

describe("降级快照标注", () => {
  it("标注降级原因、时间与提示文案，且不修改入参", () => {
    const original = quote("akshare");
    const degraded = markDegradedSnapshot(original, new Date("2026-09-20T03:00:00.000Z"));

    expect(degraded.degraded_snapshot).toEqual({
      degraded: true,
      reason: "datasource-unavailable",
      degraded_at: "2026-09-20T03:00:00.000Z",
      message: DATA_SOURCE_UNAVAILABLE_MESSAGE,
    });
    expect(hasDegradedSnapshot(original)).toBe(false);
    expect(hasDegradedSnapshot(degraded)).toBe(true);
    expect(degraded.price).toBe(original.price);
  });

  it("从候选记录中只挑出官方来源", () => {
    const records = [quote("deterministic-fallback"), quote("akshare"), quote("sina")];

    expect(officialRecords(records).map((item) => item.source)).toEqual(["akshare", "sina"]);
  });
});

describe("数据源故障错误", () => {
  it("错误携带功能名与冷却时长，可被识别", () => {
    const error = new DataSourceUnavailableError("股票 600519 行情快照");

    expect(isDataSourceUnavailableError(error)).toBe(true);
    expect(isDataSourceUnavailableError(new Error("其它错误"))).toBe(false);
    expect(error.message).toBe(DATA_SOURCE_UNAVAILABLE_MESSAGE);
    expect(error.retryAfterMs).toBe(DATA_SOURCE_RETRY_AFTER_MS);
    expect(error.feature).toBe("股票 600519 行情快照");
  });

  it("响应体使用统一错误码与重试间隔", () => {
    const payload = buildDataSourceFailurePayload(
      new DataSourceUnavailableError("基金 510300 档案", 10_000),
    );

    expect(payload.code).toBe("SERVICE_UNAVAILABLE");
    expect(payload.message).toBe(DATA_SOURCE_UNAVAILABLE_MESSAGE);
    expect(payload.details).toEqual({ retry_after_ms: 10_000, feature: "基金 510300 档案" });
  });
});