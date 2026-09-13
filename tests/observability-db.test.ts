// 可观测性数据库分支测试：mock 掉 @/lib/db，覆盖计数落库与水合恢复路径。
// 现有 observability.test.ts 只覆盖内存回退，这里补齐「数据库可用」的两个分支。
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    rows: [] as Array<Record<string, unknown>>,
    inserted: [] as Array<Record<string, unknown>>,
    conflictUpdates: [] as Array<Record<string, unknown>>,
  };
  const db = {
    execute: vi.fn(async () => undefined),
    insert: vi.fn(() => ({
      values: vi.fn((row: Record<string, unknown>) => {
        state.inserted.push(row);
        return {
          onConflictDoUpdate: vi.fn(async (arg: Record<string, unknown>) => {
            state.conflictUpdates.push(arg);
          }),
        };
      }),
    })),
    select: vi.fn(() => ({ from: vi.fn(async () => state.rows) })),
  };
  return { state, db, getDb: vi.fn(() => db) };
});

vi.mock("@/lib/db", () => ({
  hasRealDatabaseUrl: () => true,
  getDb: () => mocks.getDb(),
  schema: { observabilityMetrics: { key: "observability_metrics.key" } },
}));

import {
  ensureObservabilityHydrated,
  getObservabilitySnapshot,
  recordCacheHit,
  recordExternalCall,
} from "@/lib/observability";

/** 等待 touch() 里 fire-and-forget 的持久化 Promise 落地。 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("可观测性持久化", () => {
  it("数据库不可用时静默跳过落库", async () => {
    mocks.getDb.mockImplementation(() => {
      throw new Error("缺少 DATABASE_URL");
    });
    const before = mocks.state.inserted.length;

    recordCacheHit();
    await flush();

    expect(mocks.state.inserted).toHaveLength(before);
    mocks.getDb.mockImplementation(() => mocks.db);
  });

  it("数据库可用时写入计数与最近事件时间，并走 upsert", async () => {
    const beforeHits = getObservabilitySnapshot().cacheHits;

    recordExternalCall(true);
    recordCacheHit();
    await flush();

    const keys = mocks.state.inserted.map((row) => row.key);
    expect(keys).toContain("externalCalls");
    expect(keys).toContain("cacheHits");
    expect(keys).toContain("lastEventAt");
    expect(mocks.state.conflictUpdates.length).toBeGreaterThan(0);
    expect(mocks.db.execute).toHaveBeenCalled();
    expect(getObservabilitySnapshot().cacheHits).toBe(beforeHits + 1);
  });

  it("水合时按最大值恢复计数，旧快照不回退新事件", async () => {
    const localLastEventAt = getObservabilitySnapshot().lastEventAt;
    mocks.state.rows = [
      { key: "externalCalls", metricValue: 100000, timestampValue: null },
      { key: "cacheHits", metricValue: -5, timestampValue: null },
      { key: "lastEventAt", metricValue: 0, timestampValue: new Date("2026-01-01T00:00:00.000Z") },
      { key: "unknown_key", metricValue: 3, timestampValue: null },
    ];

    await ensureObservabilityHydrated();
    const hydrated = getObservabilitySnapshot();

    expect(hydrated.externalCalls).toBeGreaterThanOrEqual(100000);
    expect(hydrated.lastEventAt).toBe(localLastEventAt);
  });

  it("持久化的最近事件时间更新时覆盖本地值", async () => {
    mocks.state.rows = [
      { key: "lastEventAt", metricValue: 0, timestampValue: new Date("2099-01-01T00:00:00.000Z") },
    ];

    await ensureObservabilityHydrated();

    expect(getObservabilitySnapshot().lastEventAt).toBe("2099-01-01T00:00:00.000Z");
  });
});