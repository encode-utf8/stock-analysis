// 净值结算纯函数测试：估算值的使用窗口、官方净值优先、校准基线重锚与净值缓存有效期。
import { describe, expect, it } from "vitest";

import { resolveNavCacheTtlMs } from "@/lib/fund-data";
import {
  buildCalibration,
  inferManualAnchor,
  isIntradayFromToday,
  isUsableNavSource,
  pickLaterManualAnchor,
  resolveLiveQuote,
  resolveManualAnchorSnapshot,
  resolveManualDisplayCaliber,
  resolveOfficialNavOn,
  resolvePrevNavPoint,
  resolveSettledChangePct,
  resolveSettleTarget,
  rollManualSnapshot,
  settleCalibration,
} from "@/lib/fund-nav-settlement";
import type { FundIntraday, FundNavPoint, FundPositionCalibration } from "@/lib/shared/types";

const TODAY = "2026-09-14";

/** 构造历史净值点。 */
function navPoint(overrides: Partial<FundNavPoint> = {}): FundNavPoint {
  return {
    code: "110022",
    nav_date: "2026-09-11",
    unit_nav: 3.5,
    cumulative_nav: 4.2,
    daily_change_pct: 0.5,
    source: "akshare",
    fetched_at: "2026-09-11T10:00:00.000Z",
    ...overrides,
  };
}

/** 构造盘中行情。 */
function intraday(overrides: Partial<FundIntraday> = {}): FundIntraday {
  return {
    code: "110022",
    mode: "estimate",
    ts: "2026-09-14T02:00:00.000Z",
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
    official_nav_date: "2026-09-11",
    source: "akshare",
    fetched_at: "2026-09-14T02:00:00.000Z",
    ...overrides,
  };
}

describe("isUsableNavSource", () => {
  it("只接受非空且非确定性降级的来源", () => {
    expect(isUsableNavSource("akshare")).toBe(true);
    expect(isUsableNavSource("deterministic-fallback")).toBe(false);
    expect(isUsableNavSource("")).toBe(false);
    expect(isUsableNavSource(null)).toBe(false);
  });
});

describe("resolvePrevNavPoint", () => {
  it("取严格早于今天的最近一个可用净值日", () => {
    const points = [
      navPoint({ nav_date: "2026-09-10", unit_nav: 3.4 }),
      navPoint({ nav_date: "2026-09-11", unit_nav: 3.5 }),
      navPoint({ nav_date: TODAY, unit_nav: 3.6 }),
    ];
    expect(resolvePrevNavPoint(points, TODAY)?.nav_date).toBe("2026-09-11");
  });

  it("忽略降级来源与非法净值", () => {
    const points = [
      navPoint({ nav_date: "2026-09-11", source: "deterministic-fallback" }),
      navPoint({ nav_date: "2026-09-10", unit_nav: 0 }),
      navPoint({ nav_date: "2026-09-09", unit_nav: 3.3 }),
    ];
    expect(resolvePrevNavPoint(points, TODAY)?.nav_date).toBe("2026-09-09");
    expect(resolvePrevNavPoint([], TODAY)).toBeNull();
  });
});

describe("resolveOfficialNavOn", () => {
  it("历史净值序列优先", () => {
    const official = resolveOfficialNavOn(
      [navPoint({ nav_date: TODAY, unit_nav: 3.6 })],
      intraday({ official_nav: 9.9, official_nav_date: TODAY }),
      TODAY,
    );
    expect(official?.nav).toBe(3.6);
  });

  it("序列里没有当天净值时退回盘中行情自带的公布净值", () => {
    const official = resolveOfficialNavOn(
      [navPoint({ nav_date: "2026-09-11" })],
      intraday({ official_nav: 3.62, official_nav_date: TODAY }),
      TODAY,
    );
    expect(official?.nav).toBe(3.62);
    expect(official?.nav_date).toBe(TODAY);
  });

  it("净值日不匹配或缺失时不参与判定，避免把历史净值当成今天", () => {
    const points = [navPoint({ nav_date: "2026-09-11" })];
    expect(resolveOfficialNavOn(points, intraday({ official_nav_date: null }), TODAY)).toBeNull();
    expect(resolveOfficialNavOn(points, intraday(), TODAY)).toBeNull();
    expect(resolveOfficialNavOn(points, null, "2026-09-12")).toBeNull();
  });
});

describe("isIntradayFromToday / resolveLiveQuote", () => {
  it("估算值只在抓取时间属于今天时可用", () => {
    expect(isIntradayFromToday(intraday(), TODAY)).toBe(true);
    // 抓取于昨天（北京 09-13 10:00）的 payload 属于跨日，不可用
    expect(isIntradayFromToday(intraday({ fetched_at: "2026-09-13T02:00:00.000Z" }), TODAY)).toBe(false);
    expect(isIntradayFromToday(intraday({ fetched_at: "not-a-date" }), TODAY)).toBe(false);
    expect(isIntradayFromToday(null, TODAY)).toBe(false);
  });

  it("跨日的估算 / 实时值被丢弃，不冒充今天的实时值", () => {
    const stale = intraday({ fetched_at: "2026-09-13T02:00:00.000Z" });
    expect(resolveLiveQuote(stale, TODAY)).toBeNull();
  });

  it("返回场外估算净值与场内实时价，并在取不到估值时返回 null", () => {
    expect(resolveLiveQuote(intraday(), TODAY)).toMatchObject({ nav: 3.57, mode: "estimate" });
    expect(
      resolveLiveQuote(intraday({ mode: "realtime", price: 1.234, estimated_nav: null }), TODAY),
    ).toMatchObject({ nav: 1.234, mode: "realtime" });
    expect(resolveLiveQuote(intraday({ estimated_nav: null }), TODAY)).toBeNull();
    expect(
      resolveLiveQuote(intraday({ source: "deterministic-fallback" }), TODAY),
    ).toBeNull();
  });
});

describe("resolveSettledChangePct", () => {
  it("用今日官方净值与昨收净值推算涨跌幅", () => {
    const points = [
      navPoint({ nav_date: "2026-09-11", unit_nav: 3.5 }),
      navPoint({ nav_date: TODAY, unit_nav: 3.6 }),
    ];
    expect(resolveSettledChangePct(points, TODAY)).toBe(2.86);
    expect(resolveSettledChangePct(points, TODAY, 3.5)).toBe(0);
  });

  it("缺少今天净值或昨收净值时返回 null", () => {
    expect(resolveSettledChangePct([navPoint({ nav_date: "2026-09-11" })], TODAY)).toBeNull();
    expect(resolveSettledChangePct([navPoint({ nav_date: TODAY, unit_nav: 3.6 })], TODAY)).toBeNull();
  });
});

describe("buildCalibration", () => {
  it("份额 = 锚定金额 / 锚定净值，本金 = 锚定金额 − 累计收益", () => {
    const calibration = buildCalibration({
      amount: 10_000,
      profit: 2_000,
      nav: 3.57,
      navDate: TODAY,
      anchor: "estimate",
    });
    expect(calibration.nav_date).toBe(TODAY);
    expect(calibration.nav).toBe(3.57);
    expect(calibration.shares).toBeCloseTo(10_000 / 3.57, 4);
    expect(calibration.cost).toBe(8_000);
    expect(calibration.anchor).toBe("estimate");
  });
});

describe("settleCalibration", () => {
  it("官方锚定的基线保持不变", () => {
    const calibration: FundPositionCalibration = {
      nav_date: TODAY,
      nav: 3.6,
      shares: 2777.7778,
      cost: 8_000,
      anchor: "official",
    };
    expect(settleCalibration(calibration, [navPoint({ nav_date: TODAY })], TODAY)).toEqual({
      calibration,
      pending: false,
    });
    expect(settleCalibration(null, [], TODAY)).toBeNull();
  });

  it("估算锚定在官方净值公布后按份额重锚，本金与净值日不变", () => {
    const calibration: FundPositionCalibration = {
      nav_date: TODAY,
      nav: 3.57,
      shares: 2801.1204,
      cost: 8_000,
      anchor: "estimate",
    };
    const result = settleCalibration(
      calibration,
      [navPoint({ nav_date: "2026-09-11", unit_nav: 3.5 }), navPoint({ nav_date: TODAY, unit_nav: 3.6 })],
      TODAY,
    );

    expect(result?.pending).toBe(false);
    expect(result?.calibration.anchor).toBe("official");
    expect(result?.calibration.nav).toBe(3.6);
    expect(result?.calibration.nav_date).toBe(TODAY);
    expect(result?.calibration.cost).toBe(8_000);
    expect(result?.calibration.shares).toBeCloseTo((2801.1204 * 3.57) / 3.6, 4);
    // 重锚后份额 × 官方净值仍等于录入时的持有金额（1 分以内）
    expect((result?.calibration.shares ?? 0) * 3.6).toBeCloseTo(10_000, 1);
  });

  it("官方净值尚未公布时保持估算并标记待结算", () => {
    const calibration: FundPositionCalibration = {
      nav_date: TODAY,
      nav: 3.57,
      shares: 2801.1204,
      cost: 8_000,
      anchor: "estimate",
    };
    const result = settleCalibration(calibration, [navPoint({ nav_date: "2026-09-11" })], TODAY);
    expect(result).toEqual({ calibration, pending: true });
  });

  it("历史数据没有锚定净值时不重锚（anchor 缺省视为 official）", () => {
    const legacy: FundPositionCalibration = {
      nav_date: "2026-09-01",
      nav: null,
      shares: 2_000,
      cost: 6_000,
      anchor: "official",
    };
    const result = settleCalibration(legacy, [navPoint({ nav_date: "2026-09-01", unit_nav: 3.4 })], TODAY);
    expect(result).toEqual({ calibration: legacy, pending: false });
  });
});

describe("resolveNavCacheTtlMs", () => {
  it("最新点属于今天缓存 6 小时，否则缩短到 10 分钟", () => {
    expect(resolveNavCacheTtlMs([navPoint({ nav_date: TODAY })], TODAY)).toBe(6 * 60 * 60_000);
    expect(resolveNavCacheTtlMs([navPoint({ nav_date: "2026-09-11" })], TODAY)).toBe(10 * 60_000);
    // 降级数据不算「今天已公布净值」，仍然走短缓存
    expect(
      resolveNavCacheTtlMs([navPoint({ nav_date: TODAY, source: "deterministic-fallback" })], TODAY),
    ).toBe(10 * 60_000);
  });
});
describe("rollManualSnapshot", () => {
  const anchor = { nav_date: "2026-09-11", nav: 3.0094, source: "official" as const };
  const points = [
    navPoint({ nav_date: "2026-09-11", unit_nav: 3.0094 }),
    navPoint({ nav_date: "2026-09-14", unit_nav: 2.9823 }),
  ];

  it("按官方净值推进到目标收盘日，市值与累计收益同步平移（本金不变）", () => {
    const roll = rollManualSnapshot(
      { amount: 400.07, profit: 0.07, anchor },
      points,
      "2026-09-14",
    );
    expect(roll.nav_date).toBe("2026-09-14");
    expect(roll.nav).toBe(2.9823);
    expect(roll.amount).toBe(396.47);
    expect(roll.profit).toBe(-3.53);
    expect(roll.source).toBe("official");
    expect(roll.rolled).toBe(true);
    expect(roll.resettled).toBe(false);
    // 本金不变：推进前后 金额 − 累计收益 恒定
    expect(400.07 - 0.07).toBeCloseTo(396.47 - -3.53, 2);
  });

  it("目标日不晚于锚定日或缺失时不推进", () => {
    const same = rollManualSnapshot({ amount: 400.07, profit: 0.07, anchor }, points, "2026-09-11");
    expect(same.rolled).toBe(false);
    expect(same.amount).toBe(400.07);
    expect(same.profit).toBe(0.07);

    const empty = rollManualSnapshot({ amount: 400.07, profit: 0.07, anchor }, [], "2026-09-14");
    expect(empty.rolled).toBe(false);
    expect(empty.amount).toBe(400.07);
  });

  it("估算锚定拿到锚定日官方净值后先重锚再推进", () => {
    const roll = rollManualSnapshot(
      { amount: 400, profit: 0, anchor: { nav_date: TODAY, nav: 3.6, source: "estimate" } },
      [navPoint({ nav_date: TODAY, unit_nav: 3.5 })],
      TODAY,
    );
    // 官方 3.5 / 估算 3.6 → 市值按比例缩到 388.89，累计收益平移同样金额
    expect(roll.resettled).toBe(true);
    expect(roll.source).toBe("official");
    expect(roll.amount).toBe(388.89);
    expect(roll.profit).toBe(-11.11);
    expect(roll.nav).toBe(3.5);
  });

  it("官方净值未公布时保持估算口径，不猜测", () => {
    const roll = rollManualSnapshot(
      { amount: 400, profit: 0, anchor: { nav_date: TODAY, nav: 3.6, source: "estimate" } },
      [navPoint({ nav_date: "2026-09-11", unit_nav: 3.5 })],
      "2026-09-14",
    );
    expect(roll.resettled).toBe(false);
    expect(roll.source).toBe("estimate");
    expect(roll.amount).toBe(400);
  });

  it("历史数据锚定净值未知时按锚定日官方净值对齐后推进", () => {
    const roll = rollManualSnapshot(
      { amount: 400, profit: 0, anchor: { nav_date: "2026-09-11", nav: null, source: "estimate" } },
      points,
      "2026-09-14",
    );
    expect(roll.rolled).toBe(true);
    expect(roll.nav_date).toBe("2026-09-14");
    expect(roll.amount).toBe(396.4);
    expect(roll.resettled).toBe(true);
  });
});

describe("resolveManualAnchorSnapshot", () => {
  const points = [
    navPoint({ nav_date: "2026-09-10", unit_nav: 3 }),
    navPoint({ nav_date: "2026-09-11", unit_nav: 3.0094 }),
    navPoint({ nav_date: TODAY, unit_nav: 3.6 }),
  ];

  it("不含当日锚在严格早于录入日的最近收盘日", () => {
    expect(
      resolveManualAnchorSnapshot({
        caliber: "exclude_today",
        recorded: TODAY,
        settled: { nav: 3.6, nav_date: TODAY },
        live: { nav: 3.61, mode: "estimate", source: "sina", fetched_at: "2026-09-14T02:00:00.000Z" },
        points,
      }),
    ).toEqual({ nav_date: "2026-09-11", nav: 3.0094, source: "official" });
  });

  it("含当日优先当天官方净值，其次盘中估算，最后回落上一收盘日", () => {
    expect(
      resolveManualAnchorSnapshot({
        caliber: "include_today",
        recorded: TODAY,
        settled: { nav: 3.6, nav_date: TODAY },
        live: null,
        points,
      }),
    ).toEqual({ nav_date: TODAY, nav: 3.6, source: "official" });

    expect(
      resolveManualAnchorSnapshot({
        caliber: "include_today",
        recorded: TODAY,
        settled: null,
        live: { nav: 3.61, mode: "estimate", source: "sina", fetched_at: "2026-09-14T02:00:00.000Z" },
        points,
      }),
    ).toEqual({ nav_date: TODAY, nav: 3.61, source: "estimate" });

    // 周末录入：当天没有官方净值也没有盘中估值，录入值就是上一个收盘口径
    expect(
      resolveManualAnchorSnapshot({
        caliber: "include_today",
        recorded: TODAY,
        settled: null,
        live: null,
        points,
      }),
    ).toEqual({ nav_date: "2026-09-11", nav: 3.0094, source: "official" });
  });

  it("取不到任何净值时返回 null", () => {
    expect(
      resolveManualAnchorSnapshot({
        caliber: "exclude_today",
        recorded: TODAY,
        settled: null,
        live: null,
        points: [],
      }),
    ).toBeNull();
  });
});

describe("resolveManualDisplayCaliber", () => {
  it("锚在今天之前按不含当日展示，锚在今天保持含当日", () => {
    expect(
      resolveManualDisplayCaliber({
        recorded: "include_today",
        anchor: { nav_date: "2026-09-11", nav: 3.0094, source: "official" },
        today: TODAY,
        changePct: 1.2,
      }),
    ).toBe("exclude_today");
    expect(
      resolveManualDisplayCaliber({
        recorded: "include_today",
        anchor: { nav_date: TODAY, nav: 3.61, source: "estimate" },
        today: TODAY,
        changePct: 1.2,
      }),
    ).toBe("include_today");
  });

  it("取不到当日涨跌幅或没有锚点时回落到录入口径", () => {
    expect(
      resolveManualDisplayCaliber({
        recorded: "include_today",
        anchor: { nav_date: "2026-09-11", nav: 3.0094, source: "official" },
        today: TODAY,
        changePct: null,
      }),
    ).toBe("include_today");
    expect(
      resolveManualDisplayCaliber({
        recorded: "exclude_today",
        anchor: null,
        today: TODAY,
        changePct: 1.2,
      }),
    ).toBe("exclude_today");
  });
});

describe("pickLaterManualAnchor", () => {
  it("取更靠后的锚点，同一天优先官方口径", () => {
    const earlier = { nav_date: "2026-09-11", nav: 3.0094, source: "official" as const };
    const later = { nav_date: "2026-09-14", nav: 2.9823, source: "official" as const };
    expect(pickLaterManualAnchor(earlier, later)).toEqual(later);
    expect(pickLaterManualAnchor(later, earlier)).toEqual(later);
    expect(pickLaterManualAnchor(null, earlier)).toEqual(earlier);
    expect(pickLaterManualAnchor(earlier, null)).toEqual(earlier);
    expect(pickLaterManualAnchor(later, { ...later, nav: 3, source: "estimate" })).toEqual(later);
  });
});

describe("inferManualAnchor", () => {
  const points = [
    navPoint({ nav_date: "2026-09-11", unit_nav: 3.0094 }),
    navPoint({ nav_date: "2026-09-14", unit_nav: 2.9823 }),
  ];

  it("不含当日历史数据锚在录入日之前最近收盘日", () => {
    expect(
      inferManualAnchor(
        {
          profit_caliber: "exclude_today",
          created_at: "2026-09-14T10:28:34.446Z",
          updated_at: "2026-09-14T10:38:29.577Z",
        },
        points,
      ),
    ).toEqual({ nav_date: "2026-09-11", nav: 3.0094, source: "official" });
  });

  it("含当日历史数据优先取录入日当天的官方净值", () => {
    expect(
      inferManualAnchor(
        {
          profit_caliber: "include_today",
          created_at: "2026-09-14T15:25:48.089Z",
          updated_at: "2026-09-14T15:25:48.089Z",
        },
        points,
      ),
    ).toEqual({ nav_date: "2026-09-14", nav: 2.9823, source: "official" });
  });

  it("时间戳非法或取不到净值时返回 null", () => {
    expect(
      inferManualAnchor(
        { profit_caliber: "exclude_today", created_at: "bad", updated_at: "bad" },
        points,
      ),
    ).toBeNull();
  });
});

describe("resolveSettleTarget", () => {
  it("今天官方净值已公布取今天，否则取最近一个收盘日", () => {
    const points = [
      navPoint({ nav_date: "2026-09-11", unit_nav: 3 }),
      navPoint({ nav_date: TODAY, unit_nav: 3.1 }),
    ];
    expect(resolveSettleTarget(points, TODAY)).toBe(TODAY);
    expect(resolveSettleTarget([navPoint({ nav_date: "2026-09-11", unit_nav: 3 })], TODAY)).toBe(
      "2026-09-11",
    );
    expect(resolveSettleTarget([], TODAY)).toBeNull();
  });
});
