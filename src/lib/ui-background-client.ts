"use client";

// 背景设置的前端运行时：本地缓存立即生效 + 服务端防抖落库 + 外部存储订阅。
// 采用“本地先行、服务端兜底”的策略：接口挂了界面依然可用，只是状态提示同步失败。
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import {
  BACKGROUND_SETTINGS_VERSION,
  DEFAULT_BACKGROUND_SETTINGS,
  mergeBackgroundSettings,
  normalizeBackgroundSettings,
  type BackgroundSettings,
} from "@/lib/ui-background";

/** 本地缓存键与同步状态事件名。 */
const STORAGE_KEY = "stock-analysis:ui-background";
const SYNC_EVENT = "ui-background:sync";

/** 设置写库的防抖间隔，兼顾拖动滑块的即时反馈与请求数量。 */
const PERSIST_DEBOUNCE_MS = 350;

/** 同步状态：界面据此提示“保存中 / 已保存 / 保存失败”。 */
export interface BackgroundSyncState {
  status: "idle" | "saving" | "saved" | "error";
  message?: string;
}

/** 判断当前是否具备浏览器环境（SSR 与单测下没有 window）。 */
function hasWindow(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

/** 读取本地缓存设置；缺失或损坏时回退默认值。 */
export function readCachedBackgroundSettings(): BackgroundSettings {
  if (!hasWindow()) {
    return { ...DEFAULT_BACKGROUND_SETTINGS };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_BACKGROUND_SETTINGS };
    }
    const parsed = (JSON.parse(raw) ?? {}) as Record<string, unknown>;
    const version = typeof parsed.version === "number" ? parsed.version : 0;
    // 与服务器同一套规则：旧版本缓存做一次性迁移，避免首帧闪回旧默认值。
    return normalizeBackgroundSettings(parsed, {
      migrateLegacyDefaults: version < BACKGROUND_SETTINGS_VERSION,
    });
  } catch {
    return { ...DEFAULT_BACKGROUND_SETTINGS };
  }
}

/** 写入本地缓存。 */
function cacheBackgroundSettings(settings: BackgroundSettings): void {
  if (!hasWindow()) {
    return;
  }
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...settings, version: BACKGROUND_SETTINGS_VERSION }),
    );
  } catch {
    // 隐私模式等场景写入失败时忽略，仅影响下次打开时的即时生效。
  }
}

/**
 * 把设置映射为全局 CSS 变量：面板透明度、遮罩与模糊由样式层消费，
 * 交互光效强度同时写入 data 属性，便于动效层快速判断开关。
 */
export function applyBackgroundSettings(settings: BackgroundSettings): void {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  root.style.setProperty("--bg-overlay", String(settings.overlay));
  root.style.setProperty("--bg-blur", settings.blur + "px");
  root.style.setProperty("--panel-alpha", String(settings.panelAlpha));
  root.style.setProperty(
    "--fx-intensity",
    settings.fxEnabled ? String(settings.fxIntensity) : "0",
  );
  root.dataset.fx = settings.fxEnabled ? "on" : "off";
}

/* ------------------------------------------------------------ 外部存储层 */

/** 当前设置的模块级快照，供 useSyncExternalStore 读取。 */
let latestSettings: BackgroundSettings = { ...DEFAULT_BACKGROUND_SETTINGS };
let hydrated = false;
const storeListeners = new Set<() => void>();

/** 发布新设置：更新快照并通知所有订阅组件。 */
function publish(settings: BackgroundSettings): void {
  latestSettings = settings;
  for (const listener of storeListeners) {
    listener();
  }
}

/** 订阅设置快照（useSyncExternalStore 的 subscribe）。 */
function subscribeStore(listener: () => void): () => void {
  storeListeners.add(listener);
  return () => {
    storeListeners.delete(listener);
  };
}

/** 客户端快照。 */
function getSnapshot(): BackgroundSettings {
  return latestSettings;
}

/** 服务端快照：始终返回默认值，保证首屏 HTML 与客户端首次渲染一致。 */
function getServerSnapshot(): BackgroundSettings {
  return DEFAULT_BACKGROUND_SETTINGS;
}

/** 广播同步状态，供设置面板展示“保存中 / 已保存 / 失败”。 */
function emitSync(state: BackgroundSyncState): void {
  if (!hasWindow()) {
    return;
  }
  window.dispatchEvent(new CustomEvent<BackgroundSyncState>(SYNC_EVENT, { detail: state }));
}

/** 订阅同步状态，返回取消订阅函数。 */
function subscribeSync(listener: (state: BackgroundSyncState) => void): () => void {
  if (!hasWindow()) {
    return () => {};
  }
  const handler = (event: Event) => {
    listener((event as CustomEvent<BackgroundSyncState>).detail);
  };
  window.addEventListener(SYNC_EVENT, handler);
  return () => window.removeEventListener(SYNC_EVENT, handler);
}

/** 带超时的请求封装：接口异常时抛出可读错误。 */
async function request<T>(url: string, init?: RequestInit, timeoutMs = 15_000): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload = (await response.json().catch(() => null)) as {
      success?: boolean;
      data?: T;
      error?: { message?: string };
    } | null;
    if (!response.ok || !payload?.success || payload.data === undefined) {
      throw new Error(payload?.error?.message ?? "背景设置保存失败。");
    }
    return payload.data;
  } finally {
    window.clearTimeout(timer);
  }
}

/** 拉取服务端设置；失败时返回 null，由调用方沿用本地缓存。 */
export async function fetchBackgroundSettings(): Promise<BackgroundSettings | null> {
  try {
    return normalizeBackgroundSettings(await request<unknown>("/api/ui/background"));
  } catch {
    return null;
  }
}

/** 应用一份设置：写 CSS 变量 + 写本地缓存 + 发布给订阅方。 */
function applyAndPublish(settings: BackgroundSettings): void {
  cacheBackgroundSettings(settings);
  applyBackgroundSettings(settings);
  publish(settings);
}

/**
 * 首次挂载时的对齐：本地缓存立即生效（首屏不闪），随后与服务端对齐。
 * 整个过程只更新外部存储与模块级快照，不在渲染期改动 React 状态。
 */
async function hydrateBackgroundSettings(): Promise<void> {
  if (hydrated || !hasWindow()) {
    return;
  }
  hydrated = true;

  applyAndPublish(readCachedBackgroundSettings());

  const remote = await fetchBackgroundSettings();
  if (remote) {
    applyAndPublish(remote);
  }
}

/* -------------------------------------------------------------- 写库逻辑 */

let pendingPatch: Record<string, unknown> = {};
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingResolvers: Array<(settings: BackgroundSettings) => void> = [];

/** 执行累积的补丁写入，并把结果广播给等待中的调用方。 */
async function flushPendingPatch(): Promise<void> {
  const patch = pendingPatch;
  const resolvers = pendingResolvers;
  pendingPatch = {};
  pendingResolvers = [];
  pendingTimer = null;

  if (Object.keys(patch).length === 0) {
    resolvers.forEach((resolve) => resolve(latestSettings));
    return;
  }

  emitSync({ status: "saving" });
  try {
    const saved = normalizeBackgroundSettings(
      await request<unknown>("/api/ui/background", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    );
    applyAndPublish(saved);
    emitSync({ status: "saved" });
    resolvers.forEach((resolve) => resolve(saved));
  } catch (error) {
    emitSync({
      status: "error",
      message: error instanceof Error ? error.message : "背景设置保存失败。",
    });
    resolvers.forEach((resolve) => resolve(latestSettings));
  }
}

/**
 * 更新设置：本地立即生效并广播，服务端写入按 350ms 防抖合并。
 * 返回值在落库完成后给出最终设置，供调用方展示提示。
 */
export function updateBackgroundSettings(
  patch: Partial<BackgroundSettings>,
): Promise<BackgroundSettings> {
  applyAndPublish(mergeBackgroundSettings(latestSettings, patch));
  pendingPatch = { ...pendingPatch, ...patch };

  if (!hasWindow()) {
    return Promise.resolve(latestSettings);
  }

  return new Promise<BackgroundSettings>((resolve) => {
    pendingResolvers.push(resolve);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
    }
    pendingTimer = setTimeout(() => void flushPendingPatch(), PERSIST_DEBOUNCE_MS);
  });
}

/** 上传自定义背景图片：成功后立即应用并落库。 */
export async function uploadBackgroundImage(file: File): Promise<BackgroundSettings> {
  const form = new FormData();
  form.append("file", file);
  emitSync({ status: "saving" });
  try {
    const saved = normalizeBackgroundSettings(
      await request<unknown>(
        "/api/ui/background/upload",
        { method: "POST", body: form },
        60_000,
      ),
    );
    applyAndPublish(saved);
    emitSync({ status: "saved" });
    return saved;
  } catch (error) {
    const message = error instanceof Error ? error.message : "背景图片上传失败。";
    emitSync({ status: "error", message });
    throw new Error(message);
  }
}

/** 删除自定义背景图片（其余设置保留）。 */
export async function clearBackgroundImage(): Promise<BackgroundSettings> {
  emitSync({ status: "saving" });
  try {
    const saved = normalizeBackgroundSettings(
      await request<unknown>("/api/ui/background", { method: "DELETE" }),
    );
    applyAndPublish(saved);
    emitSync({ status: "saved" });
    return saved;
  } catch (error) {
    const message = error instanceof Error ? error.message : "背景图片删除失败。";
    emitSync({ status: "error", message });
    throw new Error(message);
  }
}

/** 恢复默认设置：先清掉自定义图片，再写回默认参数。 */
export async function resetBackgroundSettings(): Promise<BackgroundSettings> {
  emitSync({ status: "saving" });
  try {
    const cleared = normalizeBackgroundSettings(
      await request<unknown>("/api/ui/background", { method: "DELETE" }),
    );
    const saved = normalizeBackgroundSettings(
      await request<unknown>("/api/ui/background", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...DEFAULT_BACKGROUND_SETTINGS, customImage: cleared.customImage }),
      }),
    );
    applyAndPublish(saved);
    emitSync({ status: "saved" });
    return saved;
  } catch (error) {
    const message = error instanceof Error ? error.message : "恢复默认设置失败。";
    emitSync({ status: "error", message });
    throw new Error(message);
  }
}

/**
 * 背景设置 Hook：首屏用默认值渲染，挂载后用本地缓存与服务端结果对齐。
 * 返回的设置对象始终是合法值，组件无需再判空。
 */
export function useBackgroundSettings(): {
  settings: BackgroundSettings;
  sync: BackgroundSyncState;
  update: (patch: Partial<BackgroundSettings>) => void;
  upload: (file: File) => Promise<void>;
  clearImage: () => Promise<void>;
  reset: () => Promise<void>;
} {
  const settings = useSyncExternalStore(subscribeStore, getSnapshot, getServerSnapshot);
  const [sync, setSync] = useState<BackgroundSyncState>({ status: "idle" });

  useEffect(() => {
    void hydrateBackgroundSettings();
    return subscribeSync(setSync);
  }, []);

  const update = useCallback((patch: Partial<BackgroundSettings>) => {
    void updateBackgroundSettings(patch);
  }, []);

  const upload = useCallback(async (file: File) => {
    await uploadBackgroundImage(file);
  }, []);

  const clearImage = useCallback(async () => {
    await clearBackgroundImage();
  }, []);

  const reset = useCallback(async () => {
    await resetBackgroundSettings();
  }, []);

  return useMemo(
    () => ({ settings, sync, update, upload, clearImage, reset }),
    [settings, sync, update, upload, clearImage, reset],
  );
}
