// 自选名称自愈回归测试：只回填占位名，上游异常时保留原名称。
import { describe, expect, it, vi } from "vitest";

import type { CodeVerifyResult } from "@/lib/code-verify";
import { repairWatchlistNames } from "@/lib/watchlist-name-repair";

interface Item {
  code: string;
  name: string;
}

/** 构造名称条目。 */
function item(code: string, name: string): Item {
  return { code, name };
}

/** 构造 ok 结论。 */
function ok(code: string, name: string | null): CodeVerifyResult {
  return { code, status: "ok", name };
}

describe("repairWatchlistNames", () => {
  it("没有占位名时不请求上游", async () => {
    const verify = vi.fn();
    const updateName = vi.fn();
    const items = [item("510300", "沪深300ETF")];

    const result = await repairWatchlistNames(items, "fund", verify, updateName);

    expect(result).toEqual(items);
    expect(verify).not.toHaveBeenCalled();
    expect(updateName).not.toHaveBeenCalled();
  });

  it("占位名命中上游时回填并落库", async () => {
    const verify = vi.fn(async (code: string) => ok(code, "船舶ETF富国"));
    const updateName = vi.fn(async () => {});
    const items = [item("560710", "基金 560710"), item("510300", "沪深300ETF")];

    const result = await repairWatchlistNames(items, "fund", verify, updateName);

    expect(verify).toHaveBeenCalledTimes(1);
    expect(updateName).toHaveBeenCalledWith("560710", "船舶ETF富国");
    expect(result[0]).toEqual({ code: "560710", name: "船舶ETF富国" });
    expect(result[1]).toEqual({ code: "510300", name: "沪深300ETF" });
  });

  it("上游查不到或不可用时保留占位名", async () => {
    const verify = vi.fn(async (code: string) => ({
      code,
      status: "not_found" as const,
      name: null,
    }));
    const updateName = vi.fn(async () => {});
    const items = [item("560713", "基金 560713")];

    const result = await repairWatchlistNames(items, "fund", verify, updateName);

    expect(updateName).not.toHaveBeenCalled();
    expect(result).toEqual(items);
  });

  it("单个条目校验异常不影响其它条目", async () => {
    const verify = vi.fn(async (code: string) => {
      if (code === "560713") {
        throw new Error("上游抖动");
      }
      return ok(code, "船舶ETF富国");
    });
    const updateName = vi.fn(async () => {});
    const items = [item("560713", "基金 560713"), item("560710", "基金 560710")];

    const result = await repairWatchlistNames(items, "fund", verify, updateName);

    expect(result[0]).toEqual({ code: "560713", name: "基金 560713" });
    expect(result[1]).toEqual({ code: "560710", name: "船舶ETF富国" });
  });

  it("名称按股票口径回填", async () => {
    const verify = vi.fn(async (code: string) => ok(code, "贵州茅台"));
    const updateName = vi.fn(async () => {});
    const items = [item("600519", "股票 600519")];

    const result = await repairWatchlistNames(items, "stock", verify, updateName);

    expect(result).toEqual([{ code: "600519", name: "贵州茅台" }]);
  });
});