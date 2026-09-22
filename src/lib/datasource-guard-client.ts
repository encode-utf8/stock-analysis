"use client";

// 数据源故障前端守卫：识别 503 / SSE 错误码，统一提示文案与 10 秒按钮冷却。
// 冷却状态放在模块级共享存储中：任一功能触发失败后，全站触发按钮一起禁用，
// 倒计时结束后自动恢复，避免用户在故障期连续点击。

import { useCallback, useSyncExternalStore } from "react";

import {
  DATA_SOURCE_RETRY_AFTER_MS,
  DATA_SOURCE_UNAVAILABLE_MESSAGE,
} from "@/lib/shared/types";

/** 客户端识别的数据源故障错误。 */
export class DatasourceUnavailableError extends Error {
  /** 建议冷却时长（毫秒）。 */
  readonly retryAfterMs: number;
  /** 出错功能名称，可为空。 */
  readonly feature: string | null;

  constructor(
    message: string = DATA_SOURCE_UNAVAILABLE_MESSAGE,
    retryAfterMs: number = DATA_SOURCE_RETRY_AFTER_MS,
    feature: string | null = null,
  ) {
    super(message);
    this.name = "DatasourceUnavailableError";
    this.retryAfterMs = retryAfterMs;
    this.feature = feature;
  }
}

/** 判断错误是否为数据源故障。 */
export function isDatasourceUnavailableError(
  error: unknown,
): error is DatasourceUnavailableError {
  return error instanceof DatasourceUnavailableError;
}

/** 服务端返回的错误体结构（统一响应协议）。 */
interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
    details?: {
      retry_after_ms?: number;
      feature?: string;
    } | null;
  };
}

/** 从统一错误体解析数据源故障；非数据源故障返回 null。 */
export function datasourceErrorFromPayload(payload: unknown): DatasourceUnavailableError | null {
  const data = payload as ApiErrorPayload | null;
  if (!data?.error || data.error.code !== "SERVICE_UNAVAILABLE") {
    return null;
  }
  return new DatasourceUnavailableError(
    data.error.message ?? DATA_SOURCE_UNAVAILABLE_MESSAGE,
    data.error.details?.retry_after_ms ?? DATA_SOURCE_RETRY_AFTER_MS,
    data.error.details?.feature ?? null,
  );
}

/** SSE 错误事件的数据字段（兼容驼峰与下划线两种冷却时长写法）。 */
export interface StreamErrorData {
  message?: string;
  code?: string;
  retryAfterMs?: number;
  retry_after_ms?: number;
}

/** 从 SSE 错误事件解析数据源故障；非数据源故障返回 null。 */
export function datasourceErrorFromStreamData(
  data: StreamErrorData | null | undefined,
): DatasourceUnavailableError | null {
  if (!data || data.code !== "SERVICE_UNAVAILABLE") {
    return null;
  }
  return new DatasourceUnavailableError(
    data.message ?? DATA_SOURCE_UNAVAILABLE_MESSAGE,
    data.retryAfterMs ?? data.retry_after_ms ?? DATA_SOURCE_RETRY_AFTER_MS,
  );
}

/** 把接口错误体统一转成 Error：数据源故障返回可识别的专用错误。 */
export function apiErrorFromPayload(payload: unknown): Error {
  const datasourceError = datasourceErrorFromPayload(payload);
  if (datasourceError) {
    return datasourceError;
  }
  const data = payload as ApiErrorPayload | null;
  return new Error(data?.error?.message ?? "请求失败。");
}

/** 守卫快照：供 React 订阅的只读状态。 */
export interface DatasourceGuardSnapshot {
  /** 冷却中（触发按钮应禁用）。 */
  blocked: boolean;
  /** 剩余秒数（向上取整）。 */
  remainingSeconds: number;
  /** 提示文案；无故障时为 null。 */
  message: string | null;
}

/** 数据源故障守卫：提示文案 + 全站按钮冷却倒计时。 */
export interface DatasourceGuard extends DatasourceGuardSnapshot {
  /** 捕获错误：若为数据源故障则进入冷却并返回 true，否则返回 false。 */
  guardError: (error: unknown) => boolean;
  /** 直接上报一次数据源故障（用于 SSE 等已解析场景）。 */
  reportFailure: (error?: unknown) => void;
  /** 清除提示并解除冷却（数据源恢复、请求成功后调用）。 */
  clear: () => void;
}

const IDLE_SNAPSHOT: DatasourceGuardSnapshot = {
  blocked: false,
  remainingSeconds: 0,
  message: null,
};

let blockedUntil = 0;
let noticeMessage: string | null = null;
let snapshot: DatasourceGuardSnapshot = IDLE_SNAPSHOT;
let ticker: ReturnType<typeof setInterval> | null = null;

const listeners = new Set<() => void>();

/** 重新计算快照；状态未变化时复用旧引用，避免无意义重渲染。 */
function computeSnapshot(): DatasourceGuardSnapshot {
  const remainingMs = blockedUntil - Date.now();
  const blocked = remainingMs > 0;
  const remainingSeconds = blocked ? Math.ceil(remainingMs / 1000) : 0;
  if (
    snapshot.blocked === blocked &&
    snapshot.remainingSeconds === remainingSeconds &&
    snapshot.message === noticeMessage
  ) {
    return snapshot;
  }
  snapshot = { blocked, remainingSeconds, message: noticeMessage };
  return snapshot;
}

function notify(): void {
  computeSnapshot();
  for (const listener of listeners) {
    listener();
  }
}

function stopTicker(): void {
  if (ticker !== null) {
    clearInterval(ticker);
    ticker = null;
  }
}

function startTicker(): void {
  if (ticker !== null) {
    return;
  }
  ticker = setInterval(() => {
    if (blockedUntil - Date.now() > 0) {
      notify();
      return;
    }
    stopTicker();
    notify();
  }, 250);
}

/** 上报一次数据源故障：进入冷却并展示提示。 */
export function reportDatasourceFailure(error?: unknown): void {
  const retryAfter = isDatasourceUnavailableError(error)
    ? Math.max(1_000, error.retryAfterMs)
    : DATA_SOURCE_RETRY_AFTER_MS;
  const text =
    isDatasourceUnavailableError(error) && error.message
      ? error.message
      : DATA_SOURCE_UNAVAILABLE_MESSAGE;
  blockedUntil = Date.now() + retryAfter;
  noticeMessage = text;
  startTicker();
  notify();
}

/**
 * 统一判定错误：数据源故障则进入冷却并返回 true。
 * 该函数为模块级实现，可在 useCallback 内直接调用而无需列入依赖。
 */
export function guardDatasourceError(error: unknown): boolean {
  if (!isDatasourceUnavailableError(error)) {
    return false;
  }
  reportDatasourceFailure(error);
  return true;
}

/** 清除提示与冷却：请求成功后数据源已恢复。 */
export function clearDatasourceFailure(): void {
  stopTicker();
  blockedUntil = 0;
  noticeMessage = null;
  notify();
}

/** 读取当前守卫快照：SSR 快照兜底与单元测试都会用到。 */
export function getDatasourceGuardSnapshot(): DatasourceGuardSnapshot {
  return computeSnapshot();
}

/** 订阅守卫快照；同一时刻可能有多个组件同时订阅。 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 生成守卫 Hook：默认冷却 10 秒，全站共享同一份冷却状态。 */
export function useDatasourceGuard(): DatasourceGuard {
  const current = useSyncExternalStore(subscribe, computeSnapshot, () => IDLE_SNAPSHOT);

  const reportFailure = useCallback((error?: unknown) => {
    reportDatasourceFailure(error);
  }, []);

  const guardError = useCallback((error: unknown): boolean => {
    if (!isDatasourceUnavailableError(error)) {
      return false;
    }
    reportDatasourceFailure(error);
    return true;
  }, []);

  const clear = useCallback(() => {
    clearDatasourceFailure();
  }, []);

  return {
    blocked: current.blocked,
    remainingSeconds: current.remainingSeconds,
    message: current.message,
    guardError,
    reportFailure,
    clear,
  };
}