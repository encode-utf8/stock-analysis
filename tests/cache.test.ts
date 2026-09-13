// 进程内 TTL 缓存测试：命中/未命中、过期清除、前缀失效与单次加载。
import { afterEach, describe, expect, it, vi } from "vitest";

import { cacheGet, cacheGetOrSet, cacheInvalidatePrefix, cacheSet } from "@/lib/cache";

afterEach(() => {
  vi.useRealTimers();
});

describe("cacheGet / cacheSet", () => {
  it("未命中返回 null，写入后命中", () => {
    const key = "test:basic";
    expect(cacheGet(key)).toBeNull();
    cacheSet(key, { value: 1 }, 1000);
    expect(cacheGet<{ value: number }>(key)).toEqual({ value: 1 });
  });

  it("过期后自动清除", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-13T00:00:00.000Z"));
    const key = "test:expire";
    cacheSet(key, "data", 1000);
    expect(cacheGet(key)).toBe("data");

    vi.advanceTimersByTime(1001);
    expect(cacheGet(key)).toBeNull();
  });
});

describe("cacheGetOrSet", () => {
  it("未命中时执行 loader 并回写，命中时不再执行", async () => {
    const key = "test:loader";
    const loader = vi.fn(async () => "loaded");

    expect(await cacheGetOrSet(key, 1000, loader)).toBe("loaded");
    expect(await cacheGetOrSet(key, 1000, loader)).toBe("loaded");
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

describe("cacheInvalidatePrefix", () => {
  it("只清理匹配前缀的键", () => {
    cacheSet("test:prefix:a", 1, 1000);
    cacheSet("test:prefix:b", 2, 1000);
    cacheSet("test:other:c", 3, 1000);

    expect(cacheInvalidatePrefix("test:prefix:")).toBe(2);
    expect(cacheGet("test:prefix:a")).toBeNull();
    expect(cacheGet("test:other:c")).toBe(3);
    expect(cacheInvalidatePrefix("test:missing:")).toBe(0);
  });
});
