"use client";

/**
 * 自选池变更事件总线。
 *
 * 左侧自选股/自选基金面板与预警面板分属两棵独立的组件树，但共享同一份后端自选池数据。
 * 这里用浏览器事件做一次轻量广播：自选池增删后通知订阅者立即重新拉取可选标的，
 * 用户不需要刷新页面，也不用为此引入全局状态库。
 */

/** 自选池种类：股票自选股 / 基金自选基金。 */
export type WatchlistKind = "stock" | "fund";

const WATCHLIST_CHANGED_EVENT = "watchlist:changed";

/** 判断当前环境是否可用浏览器事件（服务端渲染与单元测试下可能没有 window）。 */
function hasWindowEvents(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.addEventListener === "function" &&
    typeof window.dispatchEvent === "function"
  );
}

/** 构造携带自选池种类的事件，兼容缺少 CustomEvent 的运行环境。 */
function buildWatchlistEvent(kind: WatchlistKind): Event {
  if (typeof CustomEvent === "function") {
    return new CustomEvent<WatchlistKind>(WATCHLIST_CHANGED_EVENT, { detail: kind });
  }
  const event = new Event(WATCHLIST_CHANGED_EVENT);
  Object.assign(event, { detail: kind });
  return event;
}

/** 广播某个自选池发生变更（新增、删除或重命名后调用）。 */
export function emitWatchlistChange(kind: WatchlistKind): void {
  if (!hasWindowEvents()) {
    return;
  }
  window.dispatchEvent(buildWatchlistEvent(kind));
}

/**
 * 订阅自选池变更事件，返回取消订阅函数。
 * 事件负载缺失或非法时按股票自选池处理，保证订阅方总能拿到合法种类。
 */
export function subscribeWatchlistChange(
  listener: (kind: WatchlistKind) => void,
): () => void {
  if (!hasWindowEvents()) {
    return () => {};
  }

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<WatchlistKind>).detail;
    listener(detail === "fund" ? "fund" : "stock");
  };

  window.addEventListener(WATCHLIST_CHANGED_EVENT, handler);
  return () => window.removeEventListener(WATCHLIST_CHANGED_EVENT, handler);
}