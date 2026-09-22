// 前端数据源守卫测试：全站共享的 10 秒冷却、错误解析与自动恢复。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DatasourceUnavailableError,
  apiErrorFromPayload,
  clearDatasourceFailure,
  datasourceErrorFromPayload,
  datasourceErrorFromStreamData,
  getDatasourceGuardSnapshot,
  guardDatasourceError,
  isDatasourceUnavailableError,
  reportDatasourceFailure,
} from "@/lib/datasource-guard-client";
import {
  DATA_SOURCE_RETRY_AFTER_MS,
  DATA_SOURCE_UNAVAILABLE_MESSAGE,
} from "@/lib/shared/types";

beforeEach(() => {
  clearDatasourceFailure();
});

afterEach(() => {
  vi.useRealTimers();
  clearDatasourceFailure();
});

describe("错误解析", () => {
  it("识别 503 响应体并解析冷却时长与功能名", () => {
    const error = datasourceErrorFromPayload({
      success: false,
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: DATA_SOURCE_UNAVAILABLE_MESSAGE,
        details: { retry_after_ms: 12_000, feature: "行情快照" },
      },
    });

    expect(error?.retryAfterMs).toBe(12_000);
    expect(error?.feature).toBe("行情快照");
    expect(isDatasourceUnavailableError(error)).toBe(true);
  });

  it("非数据源故障返回 null，并按普通错误文案转换", () => {
    const payload = { success: false, error: { code: "VALIDATION_ERROR", message: "代码非法。" } };

    expect(datasourceErrorFromPayload(payload)).toBeNull();
    expect(apiErrorFromPayload(payload).message).toBe("代码非法。");
  });

  it("SSE 错误事件兼容驼峰与下划线两种冷却字段", () => {
    expect(
      datasourceErrorFromStreamData({ code: "SERVICE_UNAVAILABLE", retryAfterMs: 5_000 })
        ?.retryAfterMs,
    ).toBe(5_000);
    expect(
      datasourceErrorFromStreamData({ code: "SERVICE_UNAVAILABLE", retry_after_ms: 7_000 })
        ?.retryAfterMs,
    ).toBe(7_000);
    expect(datasourceErrorFromStreamData({ code: "INTERNAL_ERROR" })).toBeNull();
  });
});

describe("冷却守卫", () => {
  it("普通错误不进入冷却", () => {
    expect(guardDatasourceError(new Error("字段校验失败"))).toBe(false);
    expect(getDatasourceGuardSnapshot()).toEqual({
      blocked: false,
      remainingSeconds: 0,
      message: null,
    });
  });

  it("数据源故障进入 10 秒冷却并展示提示文案", () => {
    expect(guardDatasourceError(new DatasourceUnavailableError())).toBe(true);

    const snapshot = getDatasourceGuardSnapshot();
    expect(snapshot.blocked).toBe(true);
    expect(snapshot.message).toBe(DATA_SOURCE_UNAVAILABLE_MESSAGE);
    expect(snapshot.remainingSeconds).toBeLessThanOrEqual(
      DATA_SOURCE_RETRY_AFTER_MS / 1000,
    );
    expect(snapshot.remainingSeconds).toBeGreaterThan(0);
  });

  it("无参数上报同样按默认冷却处理", () => {
    reportDatasourceFailure();

    expect(getDatasourceGuardSnapshot().blocked).toBe(true);
    expect(getDatasourceGuardSnapshot().message).toBe(DATA_SOURCE_UNAVAILABLE_MESSAGE);
  });

  it("冷却时长取服务端建议值，最小 1 秒", () => {
    reportDatasourceFailure(new DatasourceUnavailableError("自定义", 2_000));
    expect(getDatasourceGuardSnapshot().remainingSeconds).toBeLessThanOrEqual(2);

    reportDatasourceFailure(new DatasourceUnavailableError("过短", 10));
    expect(getDatasourceGuardSnapshot().remainingSeconds).toBe(1);
  });

  it("倒计时结束后自动解除，请求成功时立即清除", () => {
    vi.useFakeTimers();
    reportDatasourceFailure(new DatasourceUnavailableError("行情", 1_000));
    expect(getDatasourceGuardSnapshot().blocked).toBe(true);

    vi.advanceTimersByTime(1_100);
    expect(getDatasourceGuardSnapshot().blocked).toBe(false);

    reportDatasourceFailure();
    clearDatasourceFailure();
    expect(getDatasourceGuardSnapshot()).toEqual({
      blocked: false,
      remainingSeconds: 0,
      message: null,
    });
  });
});