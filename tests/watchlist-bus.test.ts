// 自选池事件总线回归测试：广播、订阅、取消订阅与非法负载回退。
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  emitWatchlistChange,
  subscribeWatchlistChange,
  type WatchlistKind,
} from "@/lib/watchlist-bus";

/** 用 EventTarget 充当 window 替身，只实现事件总线用到的方法。 */
function stubWindow(): EventTarget {
  const fakeWindow = new EventTarget();
  vi.stubGlobal("window", fakeWindow);
  return fakeWindow;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("自选池事件总线", () => {
  it("广播后订阅者能收到对应种类", () => {
    stubWindow();
    const received: WatchlistKind[] = [];
    const unsubscribe = subscribeWatchlistChange((kind) => received.push(kind));

    emitWatchlistChange("stock");
    emitWatchlistChange("fund");

    expect(received).toEqual(["stock", "fund"]);
    unsubscribe();
  });

  it("取消订阅后不再收到事件", () => {
    stubWindow();
    const received: WatchlistKind[] = [];
    const unsubscribe = subscribeWatchlistChange((kind) => received.push(kind));

    emitWatchlistChange("stock");
    unsubscribe();
    emitWatchlistChange("fund");

    expect(received).toEqual(["stock"]);
  });

  it("多个订阅者互不影响", () => {
    stubWindow();
    const first: WatchlistKind[] = [];
    const second: WatchlistKind[] = [];
    const unsubscribeFirst = subscribeWatchlistChange((kind) => first.push(kind));
    const unsubscribeSecond = subscribeWatchlistChange((kind) => second.push(kind));

    emitWatchlistChange("fund");

    expect(first).toEqual(["fund"]);
    expect(second).toEqual(["fund"]);
    unsubscribeFirst();
    unsubscribeSecond();
  });

  it("负载缺失或非法时回退为股票自选池", () => {
    const fakeWindow = stubWindow();
    const received: WatchlistKind[] = [];
    const unsubscribe = subscribeWatchlistChange((kind) => received.push(kind));

    fakeWindow.dispatchEvent(new Event("watchlist:changed"));

    expect(received).toEqual(["stock"]);
    unsubscribe();
  });

  it("没有 window 时广播与订阅都不抛错", () => {
    vi.stubGlobal("window", undefined);
    const received: WatchlistKind[] = [];
    const unsubscribe = subscribeWatchlistChange((kind) => received.push(kind));

    expect(() => emitWatchlistChange("stock")).not.toThrow();
    expect(received).toEqual([]);
    expect(() => unsubscribe()).not.toThrow();
  });
});