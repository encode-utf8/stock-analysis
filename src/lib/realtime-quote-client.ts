"use client";

// 实时行情前端客户端：全局单例管理 SSE 连接，供行情条、自选池与预警面板共享。
// 设计要点：
// 1. 每个标的类型最多一条 EventSource，多个组件读同一份快照，避免重复建连；
// 2. 开关默认关闭并持久化在 localStorage，用户显式开启后才建连；
// 3. 页面隐藏时降频应用快照（服务端仍按固定间隔推送），减少后台渲染开销；
// 4. 断线由 EventSource 自动重连，前端只负责把状态展示为「重连中/降级」。

import { useCallback, useEffect, useState } from "react";

import { subscribeWatchlistChange } from "@/lib/watchlist-bus";
import type {
  AlertEvent,
  AlertTarget,
  QuoteStreamEvent,
  QuoteStreamItem,
  QuoteStreamStatus,
} from "@/lib/shared/types";

const ENABLED_STORAGE_KEY = "realtime-quote:enabled";
const SOUND_STORAGE_KEY = "realtime-quote:sound";
/** 页面隐藏时最短应用间隔，避免后台标签页被每秒级推送频繁唤醒重渲染。 */
const HIDDEN_THROTTLE_MS = 30_000;

/** 自选池选项：行情条按此顺序展示，并用于补全名称。 */
export interface WatchlistOption {
  code: string;
  name: string;
}

/** 前端可见的实时行情状态。 */
export interface RealtimeQuoteState {
  enabled: boolean;
  soundEnabled: boolean;
  connection: "off" | "connecting" | "connected" | "degraded";
  items: QuoteStreamItem[];
  watchlists: Record<AlertTarget, WatchlistOption[]>;
  status: QuoteStreamStatus | null;
  lastUpdatedAt: string | null;
  /** 最近一次快照里上游查不到的代码，用于区分「等待数据」与「无数据」。 */
  missing: string[];
  /** 最近一次快照是否处于休市时段。 */
  marketClosed: boolean;
}

type StateListener = (state: RealtimeQuoteState) => void;
type AlertListener = (events: AlertEvent[]) => void;

const EMPTY_STATE: RealtimeQuoteState = {
  enabled: false,
  soundEnabled: false,
  connection: "off",
  items: [],
  watchlists: { stock: [], fund: [] },
  status: null,
  lastUpdatedAt: null,
  missing: [],
  marketClosed: false,
};

/** 统一响应包装结构。 */
interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
}

/** 读取接口数据；失败返回空数组，避免实时行情影响主流程。 */
async function fetchList<T>(url: string): Promise<T[]> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as ApiEnvelope<T[]> | null;
    if (!payload?.success || !Array.isArray(payload.data)) {
      return [];
    }
    return payload.data;
  } catch {
    return [];
  }
}

/** 读取 localStorage；SSR 或异常时返回 null。 */
function readFlag(key: string): boolean | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? null : value === "1";
  } catch {
    return null;
  }
}

function writeFlag(key: string, value: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // 隐私模式下 localStorage 可能不可用，忽略即可。
  }
}

class RealtimeQuoteStore {
  private state: RealtimeQuoteState = EMPTY_STATE;
  private stateListeners = new Set<StateListener>();
  private alertListeners = new Set<AlertListener>();
  private sources = new Map<AlertTarget, EventSource>();
  private subscribedCodes = new Map<AlertTarget, string>();
  private initialized = false;
  private unsubscribeWatchlist: (() => void) | null = null;
  private lastAppliedAt = 0;

  getState(): RealtimeQuoteState {
    return this.state;
  }

  subscribe(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  subscribeAlerts(listener: AlertListener): () => void {
    this.alertListeners.add(listener);
    return () => this.alertListeners.delete(listener);
  }

  /** 首次挂载时读取本地开关并（按需）建立连接。 */
  init(): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    const enabled = readFlag(ENABLED_STORAGE_KEY) ?? false;
    const soundEnabled = readFlag(SOUND_STORAGE_KEY) ?? false;
    this.patch({ enabled, soundEnabled });

    this.unsubscribeWatchlist = subscribeWatchlistChange(() => {
      void this.refreshWatchlists();
    });
    if (enabled) {
      void this.refreshWatchlists();
    }
  }

  setEnabled(value: boolean): void {
    writeFlag(ENABLED_STORAGE_KEY, value);
    this.patch({ enabled: value });
    if (value) {
      void this.refreshWatchlists();
    } else {
      this.teardown();
    }
  }

  setSoundEnabled(value: boolean): void {
    writeFlag(SOUND_STORAGE_KEY, value);
    this.patch({ soundEnabled: value });
  }

  /** 手动重连：先断开现有连接，再按最新开关重新建连。 */
  reconnect(): void {
    if (!this.state.enabled) {
      return;
    }
    this.teardown();
    void this.refreshWatchlists();
  }

  /** 拉取自选池并同步订阅代码；代码未变化时不重建连接。 */
  private async refreshWatchlists(): Promise<void> {
    const [stock, fund] = await Promise.all([
      fetchList<{ code: string; name: string }>("/api/watchlist"),
      fetchList<{ code: string; name: string }>("/api/fund-watchlist"),
    ]);
    this.patch({
      watchlists: {
        stock: stock.map((item) => ({ code: item.code, name: item.name })),
        fund: fund.map((item) => ({ code: item.code, name: item.name })),
      },
    });
    if (!this.state.enabled) {
      return;
    }
    this.syncConnection("stock");
    this.syncConnection("fund");
  }

  /** 按最新自选池建立/更新某个标的类型的 SSE 连接。 */
  private syncConnection(target: AlertTarget): void {
    const codes = this.state.watchlists[target]
      .map((item) => item.code)
      .filter((code) => /^\d{6}$/.test(code))
      .join(",");
    if (codes === (this.subscribedCodes.get(target) ?? "")) {
      return;
    }
    this.closeSource(target);
    this.subscribedCodes.set(target, codes);
    if (!codes) {
      this.updateConnection();
      return;
    }

    const source = new EventSource(
      `/api/stream/quotes?codes=${encodeURIComponent(codes)}&target=${target}`,
    );
    this.sources.set(target, source);
    this.patch({ connection: this.state.connection === "off" ? "connecting" : this.state.connection });

    source.addEventListener("snapshot", (event) => {
      this.handleSnapshot(JSON.parse((event as MessageEvent<string>).data) as QuoteStreamEvent);
    });
    source.addEventListener("status", (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as QuoteStreamEvent;
      if (payload.type === "status") {
        this.patch({ status: payload.status });
      }
    });
    source.addEventListener("alert", (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as QuoteStreamEvent;
      if (payload.type === "alert") {
        this.emitAlerts(payload.events);
      }
    });
    source.addEventListener("heartbeat", () => {
      // 保活事件只用于确认连接仍在，状态由 onerror 与 snapshot 决定。
    });
    source.onerror = () => {
      // EventSource 会自动重连，这里只把状态标注为降级，连接不中断。
      this.patch({ connection: "degraded" });
    };
  }

  /** 应用快照：按标的类型合并，页面隐藏时降频。 */
  private handleSnapshot(payload: QuoteStreamEvent): void {
    if (payload.type !== "snapshot") {
      return;
    }
    const now = Date.now();
    const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    if (hidden && now - this.lastAppliedAt < HIDDEN_THROTTLE_MS) {
      return;
    }
    this.lastAppliedAt = now;

    // 同一 code 可能同时存在于股票与基金自选池，用 target + code 作为唯一键。
    const merged = new Map<string, QuoteStreamItem>();
    for (const item of this.state.items) {
      merged.set(`${item.target}:${item.code}`, item);
    }
    for (const item of payload.items) {
      merged.set(`${item.target}:${item.code}`, item);
    }
    this.patch({
      items: [...merged.values()],
      lastUpdatedAt: payload.fetched_at,
      connection: "connected",
      missing: payload.missing,
      marketClosed: payload.market_closed,
    });
  }

  private emitAlerts(events: AlertEvent[]): void {
    if (events.length === 0) {
      return;
    }
    for (const listener of this.alertListeners) {
      try {
        listener(events);
      } catch (error) {
        console.warn("[realtime-quote] 预警订阅回调失败：", error);
      }
    }
  }

  private closeSource(target: AlertTarget): void {
    const source = this.sources.get(target);
    if (source) {
      source.close();
      this.sources.delete(target);
    }
    this.subscribedCodes.delete(target);
  }

  private teardown(): void {
    this.closeSource("stock");
    this.closeSource("fund");
    this.patch({
      connection: "off",
      status: null,
      lastUpdatedAt: null,
      items: [],
      missing: [],
    });
  }

  /** 根据当前连接数刷新整体连接状态。 */
  private updateConnection(): void {
    this.patch({ connection: this.sources.size > 0 ? this.state.connection : "off" });
  }

  private patch(patch: Partial<RealtimeQuoteState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.stateListeners) {
      listener(this.state);
    }
  }
}

let storeInstance: RealtimeQuoteStore | null = null;

/** 获取全局单例；只在客户端组件内调用。 */
export function getRealtimeQuoteStore(): RealtimeQuoteStore {
  storeInstance ??= new RealtimeQuoteStore();
  return storeInstance;
}

/** 订阅实时行情状态；返回当前快照与开关操作方法。 */
export function useRealtimeQuotes(): RealtimeQuoteState & {
  setEnabled: (value: boolean) => void;
  setSoundEnabled: (value: boolean) => void;
  reconnect: () => void;
} {
  const store = getRealtimeQuoteStore();
  const [state, setState] = useState<RealtimeQuoteState>(() => store.getState());

  useEffect(() => {
    store.init();
    // 放进微任务回调，避免在 effect 同步路径里直接 setState。
    void Promise.resolve().then(() => setState(store.getState()));
    return store.subscribe(setState);
  }, [store]);

  const setEnabled = useCallback((value: boolean) => store.setEnabled(value), [store]);
  const setSoundEnabled = useCallback(
    (value: boolean) => store.setSoundEnabled(value),
    [store],
  );
  const reconnect = useCallback(() => store.reconnect(), [store]);

  return { ...state, setEnabled, setSoundEnabled, reconnect };
}

/** 订阅实时推来的预警事件（站内通知用）。 */
export function subscribeRealtimeAlerts(listener: AlertListener): () => void {
  return getRealtimeQuoteStore().subscribeAlerts(listener);
}

/** 播放提示音（无需音频资源，用 WebAudio 生成短提示音）。 */
export function playAlertSound(): void {
  if (typeof window === "undefined" || typeof window.AudioContext !== "function") {
    return;
  }
  try {
    const context = new window.AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.value = 0.08;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.18);
    window.setTimeout(() => void context.close(), 500);
  } catch {
    // 浏览器未授权自动播放时静默失败，不影响站内提示。
  }
}

/** 浏览器通知是否可用及当前授权状态。 */
export function notificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || typeof window.Notification === "undefined") {
    return "unsupported";
  }
  return window.Notification.permission;
}

/** 请求浏览器通知授权；用户拒绝时返回 denied，由调用方降级为站内提示。 */
export async function requestNotificationPermission(): Promise<
  NotificationPermission | "unsupported"
> {
  if (typeof window === "undefined" || typeof window.Notification === "undefined") {
    return "unsupported";
  }
  try {
    return await window.Notification.requestPermission();
  } catch {
    return "denied";
  }
}

/** 弹出浏览器通知；未授权时静默跳过。 */
export function showBrowserNotification(event: AlertEvent): void {
  if (typeof window === "undefined" || typeof window.Notification === "undefined") {
    return;
  }
  if (window.Notification.permission !== "granted") {
    return;
  }
  try {
    new window.Notification("预警触发", { body: event.message, tag: event.id });
  } catch {
    // 部分浏览器在非安全上下文下会抛错，忽略即可。
  }
}
