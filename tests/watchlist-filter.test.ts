import { describe, expect, it } from "vitest";

import { matchesWatchlistKeyword } from "@/lib/watchlist-filter";

/** 自选搜索框的关键字匹配：空关键字放行、忽略大小写、多字段任一命中。 */
describe("matchesWatchlistKeyword", () => {
  it("关键字为空或只有空格时全部命中", () => {
    expect(matchesWatchlistKeyword(["600519", "贵州茅台"], "")).toBe(true);
    expect(matchesWatchlistKeyword(["600519", "贵州茅台"], "   ")).toBe(true);
  });

  it("按代码命中", () => {
    expect(matchesWatchlistKeyword(["600519", "贵州茅台", "", "默认"], "6005")).toBe(true);
    expect(matchesWatchlistKeyword(["600519", "贵州茅台", "", "默认"], "000001")).toBe(false);
  });

  it("按名称命中且忽略大小写", () => {
    expect(matchesWatchlistKeyword(["510300", "沪深300ETF"], "沪深")).toBe(true);
    expect(matchesWatchlistKeyword(["510300", "hs300etf"], "HS300")).toBe(true);
  });

  it("按备注与分组命中", () => {
    expect(matchesWatchlistKeyword(["600519", "贵州茅台", "白酒龙头", "默认"], "白酒")).toBe(true);
    expect(matchesWatchlistKeyword(["600519", "贵州茅台", "白酒龙头", "消费"], "消费")).toBe(true);
  });

  it("忽略字段首尾空格后再匹配", () => {
    expect(matchesWatchlistKeyword(["600519", "贵州茅台"], "  茅台  ")).toBe(true);
  });

  it("空值字段不会报错", () => {
    expect(matchesWatchlistKeyword([null, undefined, "", "默认"], "默认")).toBe(true);
    expect(matchesWatchlistKeyword([null, undefined, ""], "任意")).toBe(false);
  });
});
