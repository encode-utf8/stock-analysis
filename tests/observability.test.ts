// 可观测性计数测试：无数据库环境下的内存回退路径、计数增量与派生比率。
import { beforeEach, describe, expect, it } from "vitest";

import {
  ensureObservabilityHydrated,
  getObservabilitySnapshot,
  recordCacheHit,
  recordCacheMiss,
  recordExternalCall,
  recordTaskRun,
} from "@/lib/observability";

beforeEach(() => {
  // 明确走内存回退：不加载 .env 时数据层本就不连库，这里再兜底一次。
  delete process.env.DATABASE_URL;
});

describe("外部调用计数", () => {
  it("分别累计调用次数与失败次数，并给出失败率", () => {
    const before = getObservabilitySnapshot();

    recordExternalCall(true);
    recordExternalCall(false);
    recordExternalCall(false);

    const after = getObservabilitySnapshot();
    expect(after.externalCalls).toBe(before.externalCalls + 3);
    expect(after.externalFailures).toBe(before.externalFailures + 2);
    expect(after.externalFailureRate).toBe(
      Number(((after.externalFailures / after.externalCalls) * 100).toFixed(1)),
    );
    expect(after.lastEventAt).not.toBeNull();
    expect(Number.isNaN(Date.parse(after.lastEventAt ?? ""))).toBe(false);
  });
});

describe("缓存计数", () => {
  it("命中率按命中/(命中+未命中) 计算", () => {
    const before = getObservabilitySnapshot();

    recordCacheHit();
    recordCacheMiss();
    recordCacheMiss();
    recordCacheMiss();

    const after = getObservabilitySnapshot();
    expect(after.cacheHits).toBe(before.cacheHits + 1);
    expect(after.cacheMisses).toBe(before.cacheMisses + 3);
    expect(after.cacheHitRate).toBe(
      Number(((after.cacheHits / (after.cacheHits + after.cacheMisses)) * 100).toFixed(1)),
    );
  });
});

describe("任务计数", () => {
  it("四类任务分别累加各自计数器", () => {
    const before = getObservabilitySnapshot();

    recordTaskRun("analysis");
    recordTaskRun("chat");
    recordTaskRun("cleanup");
    recordTaskRun("refresh");

    const after = getObservabilitySnapshot();
    expect(after.analysisRuns).toBe(before.analysisRuns + 1);
    expect(after.chatRuns).toBe(before.chatRuns + 1);
    expect(after.cleanupRuns).toBe(before.cleanupRuns + 1);
    expect(after.refreshRuns).toBe(before.refreshRuns + 1);
  });
});

describe("水合流程", () => {
  it("无数据库时水合直接返回，快照可重复读取", async () => {
    await expect(ensureObservabilityHydrated()).resolves.toBeUndefined();
    expect(getObservabilitySnapshot()).toEqual(getObservabilitySnapshot());
  });
});
