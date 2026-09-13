// 基金持有面板仓储与估值测试：入参校验、净值口径解析、降级分支与本地文件回退。
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildFundPosition,
  buildFundPositionSnapshot,
  fundPositionRepository,
  resolveOfficialNav,
  resolvePricingSource,
  validateFundPositionInput,
  validateFundPositionUpdate,
  valueFundPosition,
} from "@/lib/fund-position";
import type {
  FundIntraday,
  FundNavPoint,
  FundPosition,
  FundPositionValuation,
} from "@/lib/shared/types";

/** 构造持仓记录。 */
function position(overrides: Partial<FundPosition> = {}): FundPosition {
  return {
    id: "p-1",
    code: "110022",
    name: "易方达消费行业股票",
    amount: 10_000,
    profit: 2_000,
    note: null,
    created_at: "2026-01-05T02:00:00.000Z",
    updated_at: "2026-01-05T02:00:00.000Z",
    ...overrides,
  };
}

/** 构造历史净值点。 */
function navPoint(overrides: Partial<FundNavPoint> = {}): FundNavPoint {
  return {
    code: "110022",
    nav_date: "2026-01-05",
    unit_nav: 3.5,
    cumulative_nav: 4.2,
    daily_change_pct: 0.5,
    source: "akshare",
    fetched_at: "2026-01-06T02:00:00.000Z",
    ...overrides,
  };
}

/** 构造盘中行情。 */
function intraday(overrides: Partial<FundIntraday> = {}): FundIntraday {
  return {
    code: "110022",
    mode: "estimate",
    ts: "2026-01-06T02:00:00.000Z",
    price: null,
    estimated_nav: 3.57,
    change_pct: 2,
    open: null,
    high: null,
    low: null,
    volume: null,
    amount: null,
    iopv: null,
    premium_rate: null,
    official_nav: 3.5,
    official_nav_date: "2026-01-05",
    source: "akshare",
    fetched_at: "2026-01-06T02:00:00.000Z",
    ...overrides,
  };
}

describe("validateFundPositionInput", () => {
  it("只接受代码、当前持有金额与当前累计收益", () => {
    const result = validateFundPositionInput({
      code: " 110022 ",
      amount: "15,000",
      profit: "-3000",
      note: " 定投 ",
    });
    expect("value" in result).toBe(true);
    if ("value" in result) {
      expect(result.value).toEqual({ code: "110022", amount: 15_000, profit: -3_000, note: "定投" });
    }
  });

  it("累计收益缺省按 0 处理", () => {
    const result = validateFundPositionInput({ code: "110022", amount: 5_000 });
    expect("value" in result && result.value.profit).toBe(0);
  });

  it("拒绝非法代码、非法金额与非法收益", () => {
    expect(validateFundPositionInput({ code: "12345", amount: 1_000 })).toEqual({
      error: "请输入 6 位基金代码。",
    });
    expect(validateFundPositionInput({ code: "110022", amount: 0 })).toEqual({
      error: "当前持有金额必须是大于 0 的数字。",
    });
    expect(validateFundPositionInput({ code: "110022", amount: "abc" })).toEqual({
      error: "当前持有金额必须是大于 0 的数字。",
    });
    expect(validateFundPositionInput({ code: "110022", amount: 1e13 })).toEqual({
      error: "当前持有金额过大，请确认输入是否正确。",
    });
    expect(validateFundPositionInput({ code: "110022", amount: 1_000, profit: "abc" })).toEqual({
      error: "当前累计收益必须是数字，可以为负。",
    });
  });
});

describe("validateFundPositionUpdate", () => {
  it("允许只改持有金额或收益", () => {
    expect(validateFundPositionUpdate({ amount: "8000" })).toEqual({ value: { amount: 8_000 } });
    expect(validateFundPositionUpdate({ profit: -1_200.5 })).toEqual({ value: { profit: -1_200.5 } });
  });

  it("空更新返回错误，备注传空串表示清空", () => {
    expect(validateFundPositionUpdate({})).toEqual({ error: "没有需要更新的字段。" });
    expect(validateFundPositionUpdate({ note: "   " })).toEqual({ value: { note: null } });
  });

  it("非法金额返回错误", () => {
    expect(validateFundPositionUpdate({ amount: "0" })).toEqual({
      error: "当前持有金额必须是大于 0 的数字。",
    });
  });
});

describe("buildFundPosition", () => {
  it("优先使用上游名称，缺失时回退本地档案名", () => {
    const named = buildFundPosition({ code: "110022", amount: 1, profit: 0, note: null }, " 易方达消费 ");
    expect(named.name).toBe("易方达消费");
    const fallback = buildFundPosition({ code: "110022", amount: 1, profit: 0, note: null });
    expect(fallback.name).toBe("易方达消费行业股票");
  });
});

describe("resolveOfficialNav", () => {
  it("取净值日期最新的一条，并忽略确定性降级数据", () => {
    const official = resolveOfficialNav(
      [
        navPoint({ nav_date: "2026-01-02", unit_nav: 3.4 }),
        navPoint({ nav_date: "2026-01-05", unit_nav: 3.5 }),
        navPoint({ nav_date: "2026-01-06", unit_nav: 9.9, source: "deterministic-fallback" }),
      ],
      null,
    );
    expect(official?.nav).toBe(3.5);
  });

  it("历史净值不可用时退回盘中行情自带的官方净值", () => {
    const official = resolveOfficialNav([], intraday({ official_nav: 3.52 }));
    expect(official?.nav).toBe(3.52);
    expect(resolveOfficialNav([], intraday({ source: "deterministic-fallback" }))).toBeNull();
    expect(resolveOfficialNav([], null)).toBeNull();
  });
});

describe("resolvePricingSource", () => {
  it("场外估算取估算净值，场内取实时价", () => {
    expect(resolvePricingSource(intraday(), null)?.mode).toBe("estimate");
    expect(resolvePricingSource(intraday(), null)?.nav).toBe(3.57);

    const realtime = resolvePricingSource(
      intraday({ mode: "realtime", price: 3.6, estimated_nav: null }),
      null,
    );
    expect(realtime?.mode).toBe("realtime");
    expect(realtime?.nav).toBe(3.6);
  });

  it("估算净值缺失时退回官方净值，且不使用确定性降级数据", () => {
    const fallback = resolvePricingSource(intraday({ estimated_nav: null }), null);
    expect(fallback?.mode).toBe("nav");
    expect(fallback?.nav).toBe(3.5);
    // 实时估值退回官方净值，但上游给出的当日涨跌幅仍可用于推导当日收益。
    expect(fallback?.changePct).toBe(2);

    const degraded = resolvePricingSource(
      intraday({ source: "deterministic-fallback" }),
      { nav: 3.48, source: "akshare", fetchedAt: "2026-01-06T02:00:00.000Z" },
    );
    expect(degraded?.nav).toBe(3.48);
  });

  it("既无估值也无官方净值时返回 null", () => {
    expect(resolvePricingSource(null, null)).toBeNull();
  });
});

describe("valueFundPosition", () => {
  it("有涨跌幅时推导当日收益与上一交易日累计收益", () => {
    const valuation = valueFundPosition(
      position(),
      { nav: 3.57, changePct: 2, mode: "estimate", source: "akshare", fetchedAt: "2026-01-06T02:00:00.000Z" },
      { nav: 3.5, source: "akshare", fetchedAt: "2026-01-06T02:00:00.000Z" },
    );

    expect(valuation.market_value).toBe(10_000);
    expect(valuation.cost_amount).toBe(8_000);
    expect(valuation.estimated_nav).toBe(3.57);
    expect(valuation.prev_nav).toBe(3.5);
    expect(valuation.day_profit).toBe(196.08);
    expect(valuation.prev_total_profit).toBe(1_803.92);
    expect(valuation.total_profit_pct).toBe(25);
    expect(valuation.quote_available).toBe(true);
    expect((valuation.prev_total_profit as number) + (valuation.day_profit as number)).toBeCloseTo(
      valuation.total_profit,
      2,
    );
  });

  it("行情不可用时当日口径置空，但持有金额与累计收益照常展示", () => {
    const valuation = valueFundPosition(position(), null, null);

    expect(valuation.nav_mode).toBe("unavailable");
    expect(valuation.quote_available).toBe(false);
    expect(valuation.estimated_nav).toBeNull();
    expect(valuation.prev_nav).toBeNull();
    expect(valuation.change_pct).toBeNull();
    expect(valuation.day_profit).toBeNull();
    expect(valuation.prev_total_profit).toBeNull();
    // 手动录入的口径不依赖行情
    expect(valuation.market_value).toBe(10_000);
    expect(valuation.total_profit).toBe(2_000);
    expect(valuation.total_profit_pct).toBe(25);
  });

  it("可取到官方净值但没有当日涨跌幅时，当日口径为空", () => {
    const valuation = valueFundPosition(
      position(),
      { nav: 3.5, changePct: null, mode: "nav", source: "akshare", fetchedAt: null },
      { nav: 3.5, source: "akshare", fetchedAt: null },
    );

    expect(valuation.quote_available).toBe(false);
    expect(valuation.change_pct).toBeNull();
    expect(valuation.day_profit).toBeNull();
    expect(valuation.estimated_nav).toBeNull();
    expect(valuation.prev_nav).toBe(3.5);
    expect(valuation.total_profit_pct).toBe(25);
  });

  it("涨跌幅异常时只置空当日口径", () => {
    const valuation = valueFundPosition(
      position(),
      { nav: 3.57, changePct: -100, mode: "estimate", source: "akshare", fetchedAt: null },
      null,
    );

    expect(valuation.day_profit).toBeNull();
    expect(valuation.prev_total_profit).toBeNull();
    expect(valuation.total_profit).toBe(2_000);
    expect(valuation.total_profit_pct).toBe(25);
  });

  it("累计收益不小于持有金额时收益率留空", () => {
    const valuation = valueFundPosition(position({ amount: 1_000, profit: 1_000 }), null, null);
    expect(valuation.cost_amount).toBe(0);
    expect(valuation.total_profit_pct).toBeNull();
  });
});

describe("buildFundPositionSnapshot", () => {
  it("汇总合计行并按已有估值统计持仓数", () => {
    const valuations: FundPositionValuation[] = [
      valueFundPosition(
        position({ id: "a", amount: 10_000, profit: 2_000 }),
        { nav: 3.57, changePct: 2, mode: "estimate", source: "akshare", fetchedAt: null },
        null,
      ),
      valueFundPosition(position({ id: "b", code: "000001", amount: 5_000, profit: -500 }), null, null),
    ];

    const snapshot = buildFundPositionSnapshot(valuations, "2026-01-06T02:00:00.000Z");

    expect(snapshot.summary.total_market_value).toBe(15_000);
    expect(snapshot.summary.total_cost).toBe(13_500);
    expect(snapshot.summary.total_profit).toBe(1_500);
    expect(snapshot.summary.total_profit_pct).toBe(11.11);
    expect(snapshot.summary.total_day_profit).toBe(196.08);
    expect(snapshot.summary.holdings_count).toBe(2);
    expect(snapshot.summary.generated_at).toBe("2026-01-06T02:00:00.000Z");
    expect(snapshot.holdings).toHaveLength(2);
    expect(snapshot.source_note.length).toBeGreaterThan(0);
  });
});

describe("fundPositionRepository 本地文件回退", () => {
  const file = path.join(process.cwd(), ".data", "fund-positions.json");
  let backup: string | null = null;

  beforeAll(async () => {
    // 备份并清空回退文件，避免影响本机已有数据。
    try {
      backup = await readFile(file, "utf8");
    } catch {
      backup = null;
    }
    await rm(file, { force: true });
  });

  afterAll(async () => {
    if (backup === null) {
      await rm(file, { force: true });
      return;
    }
    await writeFile(file, backup, "utf8");
  });

  it("未配置数据库时增删改查走本地 JSON 文件", async () => {
    const record = buildFundPosition(
      { code: "110022", amount: 10_000, profit: 2_000, note: "回退测试" },
      "易方达消费行业股票",
    );

    await fundPositionRepository.add(record);
    expect(await fundPositionRepository.getById(record.id)).toEqual(record);
    expect((await fundPositionRepository.getByCode("110022"))?.amount).toBe(10_000);

    await fundPositionRepository.update(record.id, { amount: 12_000, profit: -300 });
    const updated = await fundPositionRepository.getById(record.id);
    expect(updated?.amount).toBe(12_000);
    expect(updated?.profit).toBe(-300);
    expect(updated?.updated_at).not.toBe(record.updated_at);

    await fundPositionRepository.remove(record.id);
    expect(await fundPositionRepository.list()).toEqual([]);
  });
});