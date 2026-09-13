// 带故障回退的 store 测试：数据库可用时走持久化实现，失败一次后整体切到内存实现。
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  persistedGetByCode: vi.fn(),
  persistedUpsert: vi.fn(),
  persistedList: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  hasRealDatabaseUrl: () => true,
}));

vi.mock("@/lib/store/drizzle-store", () => ({
  createDrizzleStore: () => ({
    stocks: {
      getByCode: mocks.persistedGetByCode,
      upsert: mocks.persistedUpsert,
      list: mocks.persistedList,
    },
    marketQuotes: { getLatest: vi.fn(), insert: vi.fn() },
    klines: { list: vi.fn(async () => []), insertMany: vi.fn() },
    newsItems: {
      listByCode: vi.fn(async () => []),
      insert: vi.fn(),
      updateStatus: vi.fn(),
      listExpired: vi.fn(async () => []),
    },
    analysisReports: { listByCode: vi.fn(async () => []), insert: vi.fn(), deleteById: vi.fn() },
    conversations: {
      getById: vi.fn(async () => null),
      listByCode: vi.fn(async () => []),
      create: vi.fn(),
      delete: vi.fn(),
    },
    messages: {
      listByConversation: vi.fn(async () => []),
      insert: vi.fn(),
      deleteByConversation: vi.fn(),
    },
    jobRuns: { insert: vi.fn(), listRecent: vi.fn(async () => []) },
  }),
}));

import { getStore } from "@/lib/store";
import type { Stock } from "@/lib/shared/types";

const SAVED_STOCK: Stock = {
  code: "600519",
  name: "来自数据库的茅台",
  exchange: "SH",
  industry: "白酒",
  meta: null,
};

describe("getStore 故障回退", () => {
  it("数据库正常时使用持久化实现", async () => {
    mocks.persistedGetByCode.mockResolvedValue(SAVED_STOCK);

    const stock = await getStore().stocks.getByCode("600519");

    expect(stock?.name).toBe("来自数据库的茅台");
    expect(mocks.persistedGetByCode).toHaveBeenCalledWith("600519");
  });

  it("数据库报错后整体切换到内存实现", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.persistedGetByCode.mockRejectedValue(new Error("connection refused"));

    expect(await getStore().stocks.getByCode("600519")).toBeNull();
    expect(warn).toHaveBeenCalled();
    expect(mocks.persistedGetByCode).toHaveBeenCalledTimes(1);

    // 回退标记生效后，后续写读都只走内存，不再触碰数据库。
    await getStore().stocks.upsert(SAVED_STOCK);
    expect(mocks.persistedUpsert).not.toHaveBeenCalled();
    expect((await getStore().stocks.getByCode("600519"))?.name).toBe("来自数据库的茅台");
    expect(mocks.persistedGetByCode).toHaveBeenCalledTimes(1);

    warn.mockRestore();
  });
});
