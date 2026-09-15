// 基金持有面板仓储与估值测试：入参校验、净值口径解析、降级分支与本地文件回退。
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildFundPosition,
  buildFundPositionSnapshot,
  fundPositionRepository,
  resolveFundPositionUpsert,
  resolveOfficialNav,
  resolvePlanInput,
  resolvePricingSource,

  validateFundPositionInput,
  validateFundPositionUpdate,
  valueFundPosition,
} from "@/lib/fund-position";
import type {
  FundDcaPlan,
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
    profit_caliber: "include_today",
    plan: null,
    calibration: null,
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
      expect(result.value).toEqual({
        code: "110022",
        amount: 15_000,
        profit: -3_000,
        profit_caliber: "include_today",
        plan: null,
        note: "定投",
      });
    }
  });

  it("累计收益缺省按 0 处理", () => {
    const result = validateFundPositionInput({ code: "110022", amount: 5_000 });
    expect("value" in result && result.value.profit).toBe(0);
  });

  it("累计收益口径缺省为含当日，可显式指定，非法值被拒绝", () => {
    const fallback = validateFundPositionInput({ code: "110022", amount: 5_000 });
    expect("value" in fallback && fallback.value.profit_caliber).toBe("include_today");

    const empty = validateFundPositionInput({ code: "110022", amount: 5_000, profit_caliber: "" });
    expect("value" in empty && empty.value.profit_caliber).toBe("include_today");

    const explicit = validateFundPositionInput({
      code: "110022",
      amount: 5_000,
      profit_caliber: "exclude_today",
    });
    expect("value" in explicit && explicit.value.profit_caliber).toBe("exclude_today");

    expect(
      validateFundPositionInput({ code: "110022", amount: 5_000, profit_caliber: "yesterday" }),
    ).toEqual({ error: "累计收益口径只能是「含当日收益」或「不含当日收益」。" });
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

  it("允许只切换累计收益口径，非法口径返回错误", () => {
    expect(validateFundPositionUpdate({ profit_caliber: "exclude_today" })).toEqual({
      value: { profit_caliber: "exclude_today" },
    });
    expect(validateFundPositionUpdate({ profit_caliber: "bogus" })).toEqual({
      error: "累计收益口径只能是「含当日收益」或「不含当日收益」。",
    });
  });
});

describe("resolveFundPositionUpsert（同一代码只保留一条记录）", () => {
  it("普通 + 普通：持有金额与累计收益叠加，口径必须一致", () => {
    const existing = position({ amount: 1000, profit: 100, profit_caliber: "exclude_today" });

    expect(
      resolveFundPositionUpsert(existing, {
        amount: 500,
        profit: 20,
        profit_caliber: "exclude_today",
        plan: null,
        note: null,
      }),
    ).toEqual({
      action: "merge_manual",
      patch: {
        amount: 1500,
        profit: 120,
        profit_caliber: "exclude_today",
        manual_anchor: null,
        note: null,
      },
    });

    // 口径不同则两种语义的金额不能相加，直接拒绝而不是猜测。
    expect(
      resolveFundPositionUpsert(existing, {
        amount: 500,
        profit: 20,
        profit_caliber: "include_today",
        plan: null,
        note: null,
      }),
    ).toEqual({
      error: "该基金已在持有列表中（累计收益口径：不含当日收益），再次录入的口径必须一致才能叠加。",
    });
  });

  it("普通 → 定投：在既有持仓上启用计划，并把既有录入值折算成校准基线", () => {
    const existing = position({ amount: 4000, profit: 200, note: "旧备注" });
    const plan: FundDcaPlan = {
      frequency: "monthly",
      weekday: null,
      amount: 500,
      start_date: "2026-09-01",
    };

    expect(
      resolveFundPositionUpsert(existing, {
        amount: 0,
        profit: 0,
        profit_caliber: "include_today",
        plan,
        note: "新备注",
      }),
    ).toEqual({
      action: "attach_plan",
      patch: {
        plan,
        amount: 0,
        profit: 0,
        profit_caliber: "include_today",
        manual_anchor: null,
        note: "新备注",
      },
      calibrationFrom: { amount: 4000, profit: 200 },
    });
  });

  it("定投 → 定投：只更新这一个计划，备注缺省时保留原值", () => {
    const existing = position({
      amount: 0,
      profit: 0,
      plan: { frequency: "monthly", weekday: null, amount: 500, start_date: "2026-06-15" },
      note: "旧备注",
    });
    const plan: FundDcaPlan = {
      frequency: "weekly",
      weekday: 3,
      amount: 800,
      start_date: "2026-09-01",
    };

    expect(
      resolveFundPositionUpsert(existing, {
        amount: 0,
        profit: 0,
        profit_caliber: "include_today",
        plan,
        note: null,
      }),
    ).toEqual({
      action: "update_plan",
      patch: {
        plan,
        amount: 0,
        profit: 0,
        profit_caliber: "include_today",
        manual_anchor: null,
        note: "旧备注",
      },
    });
  });

  it("定投 → 普通：拒绝，要求先取消定投", () => {
    const existing = position({
      amount: 0,
      profit: 0,
      plan: { frequency: "monthly", weekday: null, amount: 500, start_date: "2026-06-15" },
    });

    expect(
      resolveFundPositionUpsert(existing, {
        amount: 1000,
        profit: 0,
        profit_caliber: "include_today",
        plan: null,
        note: null,
      }),
    ).toEqual({
      error: "该基金已启用定投计划，持有金额由计划派生；请先在「修改」中取消定投，再按普通持有录入。",
    });
  });
});

describe("buildFundPosition", () => {
  it("优先使用上游名称，缺失时回退本地档案名", () => {
    const input = {
      code: "110022",
      amount: 1,
      profit: 0,
      profit_caliber: "include_today" as const,
      plan: null,
      note: null,
    };

    const named = buildFundPosition(input, " 易方达消费 ");
    expect(named.name).toBe("易方达消费");
    const fallback = buildFundPosition(input);
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
      { nav: 3.48, navDate: "2026-01-05", source: "akshare", fetchedAt: "2026-01-06T02:00:00.000Z" },

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
      { nav: 3.5, navDate: "2026-01-05", source: "akshare", fetchedAt: "2026-01-06T02:00:00.000Z" },

    );

    // 含当日口径：录入值即当前市值，上一交易日市值由涨跌幅反推
    expect(valuation.market_value).toBe(10_000);
    expect(valuation.prev_market_value).toBe(9_803.92);
    expect(valuation.cost_amount).toBe(8_000);
    expect(valuation.estimated_nav).toBe(3.57);
    expect(valuation.prev_nav).toBe(3.5);
    expect(valuation.day_profit).toBe(196.08);
    expect(valuation.prev_total_profit).toBe(1_803.92);
    expect(valuation.total_profit_pct).toBe(25);
    expect(valuation.quote_available).toBe(true);
    expect((valuation.prev_total_profit as number) + (valuation.day_profit as number)).toBeCloseTo(
      valuation.total_profit as number,
      2,
    );
  });

  it("当日官方净值已公布时按官方口径结算：昨收取前一个净值日，涨跌幅改由官方净值推算", () => {
    const valuation = valueFundPosition(
      position(),
      { nav: 3.6, changePct: 2, mode: "estimate", source: "akshare", fetchedAt: null },
      { nav: 3.6, navDate: "2026-01-06", source: "akshare", fetchedAt: null },
      [
        navPoint({ nav_date: "2026-01-05", unit_nav: 3.5 }),
        navPoint({ nav_date: "2026-01-06", unit_nav: 3.6 }),
      ],
      "2026-01-06",
    );

    // 当日净值 3.6 属于「今天」，昨收应取 2026-01-05 的 3.5
    expect(valuation.prev_nav).toBe(3.5);
    // R1：官方净值已公布，当日涨跌幅改用官方净值推算（3.6 / 3.5 − 1 = 2.86%），不再用估算的 2%
    expect(valuation.change_pct).toBe(2.86);
    expect(valuation.nav_mode).toBe("nav");
    expect(valuation.nav_date).toBe("2026-01-06");
    expect(valuation.estimated_nav).toBeNull();
    // 录入值锚在 2026-01-05 收盘口径上（含当日录入 = 当天收盘值）：今天按官方涨跌幅折算，
    // 上一交易日市值就是录入值，恒等式 prev_total_profit + day_profit = total_profit 依旧成立
    expect(valuation.market_value).toBe(10_286);
    expect(valuation.prev_market_value).toBe(10_000);
    expect(valuation.day_profit).toBe(286);
    expect(valuation.prev_total_profit).toBe(2_000);
  });

  it("官方净值未公布时按估算值展示，并保留盘中涨跌幅", () => {
    const valuation = valueFundPosition(
      position(),
      { nav: 3.57, changePct: 2, mode: "estimate", source: "akshare", fetchedAt: null },
      { nav: 3.5, navDate: "2026-01-05", source: "akshare", fetchedAt: null },
      [
        navPoint({ nav_date: "2026-01-05", unit_nav: 3.5 }),
      ],
      "2026-01-06",
    );

    // R3：官方净值未公布，允许用估算值展示；涨跌幅沿用盘中口径
    expect(valuation.nav_mode).toBe("estimate");
    expect(valuation.estimated_nav).toBe(3.57);
    expect(valuation.change_pct).toBe(2);
    expect(valuation.nav_date).toBe("2026-01-05");
    expect(valuation.prev_nav).toBe(3.5);
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
    expect(valuation.prev_market_value).toBeNull();
    // 手动录入的口径不依赖行情
    expect(valuation.market_value).toBe(10_000);
    expect(valuation.total_profit).toBe(2_000);
    expect(valuation.total_profit_pct).toBe(25);
  });

  it("可取到官方净值但没有当日涨跌幅时，当日口径为空", () => {
    const valuation = valueFundPosition(
      position(),
      { nav: 3.5, changePct: null, mode: "nav", source: "akshare", fetchedAt: null },
      { nav: 3.5, navDate: "2026-01-05", source: "akshare", fetchedAt: null },

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

  it("不含当日口径：录入值即上一交易日口径，当前市值与累计收益按涨跌幅折算", () => {
    const valuation = valueFundPosition(
      position({ profit: 1_803.92, profit_caliber: "exclude_today" }),
      { nav: 3.57, changePct: 2, mode: "estimate", source: "akshare", fetchedAt: null },
      null,
    );

    expect(valuation.profit_caliber).toBe("exclude_today");
    expect(valuation.prev_market_value).toBe(10_000);
    expect(valuation.market_value).toBe(10_200);
    expect(valuation.day_profit).toBe(200);
    expect(valuation.prev_total_profit).toBe(1_803.92);
    expect(valuation.total_profit).toBe(2_003.92);
    expect(valuation.cost_amount).toBe(8_196.08);
  });

  it("不含当日口径且行情不可用时，当前市值与当前累计收益留空，不用 0 冒充", () => {
    const valuation = valueFundPosition(
      position({ profit: 1_803.92, profit_caliber: "exclude_today" }),
      null,
      null,
    );

    expect(valuation.market_value).toBeNull();
    expect(valuation.day_profit).toBeNull();
    expect(valuation.total_profit).toBeNull();
    expect(valuation.total_profit_pct).toBeNull();
    // 上一交易日口径与推算本金只依赖录入值，仍然可用
    expect(valuation.prev_market_value).toBe(10_000);
    expect(valuation.prev_total_profit).toBe(1_803.92);
    expect(valuation.cost_amount).toBe(8_196.08);
  });

  it("历史记录缺少口径字段时按含当日收益处理", () => {
    const legacy = { ...position(), profit_caliber: undefined } as unknown as FundPosition;
    const valuation = valueFundPosition(
      legacy,
      { nav: 3.57, changePct: 2, mode: "estimate", source: "akshare", fetchedAt: null },
      null,
    );

    expect(valuation.profit_caliber).toBe("include_today");
    expect(valuation.total_profit).toBe(2_000);
    expect(valuation.prev_total_profit).toBe(1_803.92);
    // 手动持仓不带定投计划账本。
    expect(valuation.dca).toBeNull();
  });


  it("累计收益不小于持有金额时收益率留空", () => {
    const valuation = valueFundPosition(position({ amount: 1_000, profit: 1_000 }), null, null);
    expect(valuation.cost_amount).toBe(0);
    expect(valuation.total_profit_pct).toBeNull();
  });
});

describe("定投计划入参校验", () => {
  it("缺省不启用计划，可显式传入每月/每周/每两周/每日计划", () => {
    expect(resolvePlanInput(undefined)).toEqual({ value: null });
    expect(resolvePlanInput(null)).toEqual({ value: null });

    expect(resolvePlanInput({ frequency: "monthly", amount: "1000" })).toEqual({
      value: { frequency: "monthly", weekday: null, amount: 1000, start_date: expect.any(String) },
    });
    expect(resolvePlanInput({ frequency: "weekly", weekday: "3", amount: 500 })).toEqual({
      value: { frequency: "weekly", weekday: 3, amount: 500, start_date: expect.any(String) },
    });
    expect(resolvePlanInput({ frequency: "biweekly", amount: 500 })).toEqual({
      value: { frequency: "biweekly", weekday: null, amount: 500, start_date: expect.any(String) },
    });
    expect(resolvePlanInput({ frequency: "daily", amount: 100, start_date: "2026-09-01" })).toEqual({
      value: { frequency: "daily", weekday: null, amount: 100, start_date: "2026-09-01" },
    });
  });

  it("拒绝非法频率、缺失星期几、非法金额与未来启用日", () => {
    expect(resolvePlanInput({ frequency: "yearly", amount: 100 })).toEqual({
      error: "定投频率只能是每日、每周、每两周或每月。",
    });
    expect(resolvePlanInput({ frequency: "weekly", amount: 100 })).toEqual({
      error: "每周定投需要选择星期几（周一至周五）。",
    });
    expect(resolvePlanInput({ frequency: "weekly", weekday: 6, amount: 100 })).toEqual({
      error: "每周定投需要选择星期几（周一至周五）。",
    });
    expect(resolvePlanInput({ frequency: "monthly", amount: 0 })).toEqual({
      error: "每期定投金额必须是大于 0 的数字。",
    });
    expect(resolvePlanInput({ frequency: "monthly", amount: 100, start_date: "2099-01-01" })).toEqual({
      error: "定投启用日不能晚于今天。",
    });
    expect(resolvePlanInput({ frequency: "monthly", amount: 100, start_date: "2026/09/01" })).toEqual({
      error: "定投启用日格式应为 YYYY-MM-DD。",
    });
  });

  it("启用计划时无需再填持有金额与累计收益", () => {
    const result = validateFundPositionInput({
      code: "110022",
      plan: { frequency: "monthly", amount: 1000, start_date: "2026-09-01" },
    });
    expect("value" in result && result.value.amount).toBe(0);
    expect("value" in result && result.value.profit).toBe(0);
    expect("value" in result && result.value.plan?.amount).toBe(1000);

    // 未启用计划时仍然必须填持有金额。
    expect(validateFundPositionInput({ code: "110022" })).toEqual({
      error: "当前持有金额必须是大于 0 的数字。",
    });
  });

  it("取消定投时必须同时固化持有金额与累计收益，并一并清除校准", () => {
    const existing = position({
      plan: { frequency: "monthly", weekday: null, amount: 1000, start_date: "2026-06-15" },
      calibration: { nav_date: "2026-07-15", nav: 1.1, shares: 2100, cost: 2000, anchor: "official" },
    });

    expect(validateFundPositionUpdate({ plan: null }, existing)).toEqual({
      error: "取消定投时请同时填写当前持有金额与累计收益，用于固化为手动持仓。",
    });
    expect(validateFundPositionUpdate({ plan: null, amount: 3200, profit: 200 }, existing)).toEqual({
      value: { plan: null, calibration_input: null, amount: 3200, profit: 200 },
    });
    // 手动持仓传 plan: null（本来就为空）不需要额外字段，也不会动校准。
    expect(validateFundPositionUpdate({ plan: null }, position())).toEqual({ value: { plan: null } });
  });

  it("「修改」不再接受启用/调整计划，只能在「添加」里按代码合并", () => {
    const plan: FundDcaPlan = {
      frequency: "monthly",
      weekday: null,
      amount: 500,
      start_date: "2026-09-01",
    };

    expect(validateFundPositionUpdate({ plan }, position())).toEqual({
      error: "如需启用或调整定投计划，请在「添加持有基金」中改用定投方式录入；「修改」只支持取消定投。",
    });
  });

  it("校准入参校验：金额必填、收益可为负、传 null 表示清除", () => {
    expect(validateFundPositionUpdate({ calibration: { amount: 5000, profit: 300 } })).toEqual({
      value: { calibration_input: { amount: 5000, profit: 300 } },
    });
    expect(validateFundPositionUpdate({ calibration: { amount: 5000 } })).toEqual({
      value: { calibration_input: { amount: 5000, profit: 0 } },
    });
    expect(validateFundPositionUpdate({ calibration: { amount: 0 } })).toEqual({
      error: "校准时请填写大于 0 的当前持有金额。",
    });
    expect(validateFundPositionUpdate({ calibration: null })).toEqual({
      value: { calibration_input: null },
    });
  });
});

describe("定投计划持仓估值", () => {
  const planPosition = (overrides: Partial<FundPosition> = {}) =>
    position({
      amount: 0,
      profit: 0,
      plan: { frequency: "monthly", weekday: null, amount: 1000, start_date: "2026-06-15" },
      ...overrides,
    });

  const navPoints = [
    navPoint({ nav_date: "2026-06-15", unit_nav: 1 }),
    navPoint({ nav_date: "2026-07-15", unit_nav: 1.25 }),
    navPoint({ nav_date: "2026-08-15", unit_nav: 0.8 }),
    navPoint({ nav_date: "2026-09-11", unit_nav: 1.1 }),
  ];

  it("由计划账本推导期数、份额、市值与累计收益", () => {
    const valuation = valueFundPosition(
      planPosition(),
      { nav: 1.155, changePct: 5, mode: "estimate", source: "akshare", fetchedAt: null },
      { nav: 1.1, navDate: "2026-09-11", source: "akshare", fetchedAt: null },
      navPoints,
      "2026-09-14",
    );

    expect(valuation.dca).toEqual({
      frequency: "monthly",
      weekday: null,
      amount: 1000,
      start_date: "2026-06-15",
      periods: 3,
      invested: 3000,
      shares: 3050,
      last_period_date: "2026-08-15",
      calibrated: false,
    });
    expect(valuation.cost_amount).toBe(3000);
    expect(valuation.prev_market_value).toBe(3355);
    expect(valuation.market_value).toBe(3522.75);
    expect(valuation.day_profit).toBe(167.75);
    expect(valuation.total_profit).toBe(522.75);
    expect(valuation.total_profit_pct).toBe(17.43);
    // 上一交易日累计收益 = 上一交易日市值 − 累计投入
    expect(valuation.prev_total_profit).toBe(355);
  });

  it("当日官方净值已公布时按收盘净值计价，昨收取前一个净值日", () => {
    const settled = [...navPoints, navPoint({ nav_date: "2026-09-14", unit_nav: 1.2 })];
    const valuation = valueFundPosition(
      planPosition(),
      { nav: 1.25, changePct: 5, mode: "estimate", source: "akshare", fetchedAt: null },
      { nav: 1.2, navDate: "2026-09-14", source: "akshare", fetchedAt: null },
      settled,
      "2026-09-14",
    );

    // 份额 3050（期次只到 08-15，共 3 期）
    expect(valuation.dca?.shares).toBe(3050);
    // 现价改用当日已公布的收盘净值 1.2，而不是已过期的盘中估算 1.25
    expect(valuation.nav_mode).toBe("nav");
    expect(valuation.estimated_nav).toBeNull();
    expect(valuation.market_value).toBe(3660);
    // 昨收取 09-11 的 1.1，而不是今天的 1.2
    expect(valuation.prev_nav).toBe(1.1);
    expect(valuation.prev_market_value).toBe(3355);
    expect(valuation.day_profit).toBe(305);
    expect(valuation.total_profit).toBe(660);
    expect(valuation.prev_total_profit).toBe(355);
  });

  it("净值不可用时保留期数信息，金额字段留空而不用 0 冒充", () => {
    const valuation = valueFundPosition(planPosition(), null, null, [], "2026-09-14");

    expect(valuation.market_value).toBeNull();
    expect(valuation.prev_market_value).toBeNull();
    expect(valuation.total_profit).toBeNull();
    expect(valuation.total_profit_pct).toBeNull();
    expect(valuation.prev_total_profit).toBeNull();
    // 账本本身不依赖行情：期数与累计投入照常可算（此处无净值，故为 0 期）。
    expect(valuation.dca?.periods).toBe(0);
    expect(valuation.dca?.invested).toBe(0);
    expect(valuation.cost_amount).toBe(0);
  });

  it("有官方净值但没有实时估值时，当日收益留空", () => {
    const valuation = valueFundPosition(
      planPosition(),
      null,
      { nav: 1.1, navDate: "2026-09-11", source: "akshare", fetchedAt: null },
      navPoints,
      "2026-09-14",
    );

    expect(valuation.market_value).toBe(3355);
    expect(valuation.day_profit).toBeNull();
    expect(valuation.total_profit).toBe(355);
  });

  it("校准后只累加校准日之后的期次", () => {
    const valuation = valueFundPosition(
      planPosition({ calibration: { nav_date: "2026-07-15", nav: 1.1, shares: 2100, cost: 2000, anchor: "official" } }),
      null,
      { nav: 1.1, navDate: "2026-09-11", source: "akshare", fetchedAt: null },
      navPoints,
      "2026-09-14",
    );

    // 校准涵盖 06-15 / 07-15，只剩 08-15 一期继续累加：2000 + 1000 本金，2100 + 1250 份额。
    expect(valuation.dca?.periods).toBe(1);
    expect(valuation.dca?.calibrated).toBe(true);
    expect(valuation.dca?.invested).toBe(3000);
    expect(valuation.dca?.shares).toBe(3350);
    expect(valuation.cost_amount).toBe(3000);
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
      {
        code: "110022",
        amount: 10_000,
        profit: 2_000,
        profit_caliber: "include_today",
        plan: null,
        note: "回退测试",
      },

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
describe("valueFundPosition 手动持仓跨日推进", () => {
  const points = [
    navPoint({ nav_date: "2026-09-11", unit_nav: 3.0094 }),
    navPoint({ nav_date: "2026-09-14", unit_nav: 2.9823 }),
  ];
  const pricing = {
    nav: 3.0723,
    changePct: 3.02,
    mode: "estimate" as const,
    source: "sina",
    fetchedAt: "2026-09-15T08:30:30.000Z",
  };
  const official = {
    nav: 2.9823,
    navDate: "2026-09-14",
    source: "sina",
    fetchedAt: "2026-09-15T08:30:30.000Z",
  };

  it("不含当日：跨交易日后上一交易日累计收益包含已收盘的收益", () => {
    const valuation = valueFundPosition(
      position({
        amount: 400.07,
        profit: 0.07,
        profit_caliber: "exclude_today",
        created_at: "2026-09-14T10:28:34.446Z",
        updated_at: "2026-09-14T10:38:29.577Z",
      }),
      pricing,
      official,
      points,
      "2026-09-15",
    );
    expect(valuation.cost_amount).toBe(400);
    // 录入值锚在 09-11 收盘：推进到 09-14 后上一交易日累计收益 = 0.07 + (396.47 − 400.07)
    expect(valuation.prev_market_value).toBe(396.47);
    expect(valuation.prev_total_profit).toBe(-3.53);
    expect(valuation.market_value).toBe(408.44);
    expect(valuation.day_profit).toBe(11.97);
    expect(valuation.total_profit).toBe(8.44);
  });

  it("含当日：跨交易日后按官方净值推进，改用不含当日口径展示当日涨跌", () => {
    const valuation = valueFundPosition(
      position({
        amount: 393.87,
        profit: -6.13,
        profit_caliber: "include_today",
        created_at: "2026-09-14T15:25:48.089Z",
        updated_at: "2026-09-14T15:25:48.089Z",
      }),
      { ...pricing, changePct: 3.34, nav: 3.1173 },
      official,
      points,
      "2026-09-15",
    );
    // 锚定日 = 录入日 09-14 的官方净值，不再往前推进；录入值即上一交易日市值
    expect(valuation.prev_market_value).toBe(393.87);
    expect(valuation.prev_total_profit).toBe(-6.13);
    expect(valuation.market_value).toBe(407.03);
    expect(valuation.day_profit).toBe(13.16);
    // 录入口径原样回显，展示口径不改变用户设置
    expect(valuation.profit_caliber).toBe("include_today");
  });

  it("当天录入不含当日：锚在昨天收盘，当日涨跌幅单独叠加", () => {
    const valuation = valueFundPosition(
      position({
        amount: 400.07,
        profit: 0.07,
        profit_caliber: "exclude_today",
        created_at: "2026-09-15T02:00:00.000Z",
        updated_at: "2026-09-15T02:00:00.000Z",
      }),
      pricing,
      official,
      points,
      "2026-09-15",
    );
    expect(valuation.prev_market_value).toBe(400.07);
    expect(valuation.prev_total_profit).toBe(0.07);
    expect(valuation.market_value).toBe(412.15);
  });

  it("当天盘中录入含当日：按录入值展示当前市值并标注待结算", () => {
    const valuation = valueFundPosition(
      position({
        amount: 396.47,
        profit: -3.53,
        profit_caliber: "include_today",
        created_at: "2026-09-15T02:00:00.000Z",
        updated_at: "2026-09-15T02:00:00.000Z",
        manual_anchor: { nav_date: "2026-09-15", nav: 3.0723, source: "estimate" },
      }),
      pricing,
      official,
      points,
      "2026-09-15",
    );
    expect(valuation.market_value).toBe(396.47);
    expect(valuation.settlement_pending).toBe(true);
  });
});
