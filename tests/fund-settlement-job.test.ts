// 净值结算任务测试：估算锚定的校准在官方净值可取到时落库重锚，取不到时计入待结算。
import { describe, expect, it, vi } from "vitest";

const navMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/fund-data", () => ({
  getFundNav: navMock,
}));

import { settleFundPositions } from "@/lib/fund-position";
import { round4 } from "@/lib/fund-dca-plan";
import { beijingDateKey, shiftDateKey } from "@/lib/trading-calendar";
import type { FundNavPoint, FundPosition } from "@/lib/shared/types";

const TODAY = beijingDateKey(new Date());
const PREV = shiftDateKey(TODAY, -3);
const OLDER = shiftDateKey(TODAY, -7);

/** 构造持仓记录。 */
function position(overrides: Partial<FundPosition> = {}): FundPosition {
  return {
    id: "p-1",
    code: "110022",
    name: "易方达消费行业股票",
    amount: 0,
    profit: 0,
    profit_caliber: "include_today",
    plan: { frequency: "monthly", weekday: null, amount: 100, start_date: TODAY },
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
    nav_date: PREV,
    unit_nav: 3,
    cumulative_nav: 4.2,
    daily_change_pct: 0.5,
    source: "akshare",
    fetched_at: "2026-01-06T02:00:00.000Z",
    ...overrides,
  };
}

/** 估算锚定的校准基线：锚定金额 1000、本金 900。 */
function estimateCalibration() {
  return {
    nav_date: TODAY,
    nav: 3.07,
    shares: round4(1000 / 3.07),
    cost: 900,
    anchor: "estimate" as const,
  };
}

describe("settleFundPositions", () => {
  it("估算锚定的校准在官方净值可取到时按官方口径落库", async () => {
    navMock.mockReset();
    const update = vi.fn(async () => undefined);
    navMock.mockResolvedValue([
      navPoint({ nav_date: PREV, unit_nav: 3 }),
      navPoint({ nav_date: TODAY, unit_nav: 3.03 }),
    ]);

    const result = await settleFundPositions([position({ calibration: estimateCalibration() })], {
      update,
    });

    expect(result).toEqual({ checked: 1, resettled: ["110022"], pending: [] });
    // 锚定日就是今天，取最近一个月即可
    expect(navMock.mock.calls[0][1]).toBe("1m");
    expect(update).toHaveBeenCalledTimes(1);
    const [id, patch] = update.mock.calls[0] as unknown as [string, { calibration: {
      nav: number;
      shares: number;
      cost: number;
      nav_date: string;
      anchor: string;
    } }];
    expect(id).toBe("p-1");
    expect(patch.calibration.nav).toBe(3.03);
    expect(patch.calibration.anchor).toBe("official");
    expect(patch.calibration.cost).toBe(900);
    expect(patch.calibration.nav_date).toBe(TODAY);
    // 重锚后份额 = 锚定金额 / 今日官方净值，本金保持不变
    expect(patch.calibration.shares).toBeCloseTo(1000 / 3.03, 3);
  });

  it("官方净值尚未公布时只计入待结算，不写库", async () => {
    navMock.mockReset();
    const update = vi.fn(async () => undefined);
    navMock.mockResolvedValue([navPoint({ nav_date: PREV, unit_nav: 3 })]);

    const result = await settleFundPositions([position({ calibration: estimateCalibration() })], {
      update,
    });

    expect(result).toEqual({ checked: 1, resettled: [], pending: ["110022"] });
    expect(update).not.toHaveBeenCalled();
  });

  it("官方锚定的校准与未校准持仓都不做处理", async () => {
    navMock.mockReset();
    const update = vi.fn(async () => undefined);
    navMock.mockResolvedValue([
      navPoint({ nav_date: PREV, unit_nav: 3 }),
      navPoint({ nav_date: TODAY, unit_nav: 3.03 }),
    ]);

    const result = await settleFundPositions(
      [
        position({
          calibration: { ...estimateCalibration(), anchor: "official" },
        }),
        position({ id: "p-2", code: "000001", plan: null, calibration: null }),
      ],
      { update },
    );

    expect(result).toEqual({ checked: 2, resettled: [], pending: [] });
    expect(update).not.toHaveBeenCalled();
  });

  it("单只取数失败只跳过该只，不影响其它持仓", async () => {
    navMock.mockReset();
    const update = vi.fn(async () => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    navMock.mockRejectedValueOnce(new Error("侧车不可用"));
    navMock.mockResolvedValue([
      navPoint({ nav_date: PREV, unit_nav: 3 }),
      navPoint({ nav_date: TODAY, unit_nav: 3.03 }),
    ]);

    const result = await settleFundPositions(
      [
        position({ id: "p-1", code: "110022", calibration: estimateCalibration() }),
        position({ id: "p-2", code: "000001", calibration: estimateCalibration() }),
      ],
      { update },
    );

    expect(result.checked).toBe(2);
    expect(result.resettled).toEqual(["000001"]);
    // 取数失败的持仓按待结算处理，并单独记录错误
    expect(result.pending).toEqual(["110022"]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
describe("settleFundPositions 手动持仓", () => {
  it("按官方净值把手动录入值推进到最新收盘口径并落库", async () => {
    navMock.mockReset();
    const update = vi.fn(async () => undefined);
    navMock.mockResolvedValue([
      navPoint({ nav_date: PREV, unit_nav: 3 }),
      navPoint({ nav_date: TODAY, unit_nav: 3.03 }),
    ]);

    const result = await settleFundPositions(
      [
        position({
          plan: null,
          amount: 300,
          profit: 30,
          profit_caliber: "exclude_today",
          manual_anchor: { nav_date: OLDER, nav: 2.9, source: "official" },
        }),
      ],
      { update },
    );

    expect(result).toEqual({ checked: 1, resettled: ["110022"], pending: [] });
    expect(update).toHaveBeenCalledWith("p-1", {
      amount: 313.45,
      profit: 43.45,
      manual_anchor: { nav_date: TODAY, nav: 3.03, source: "official" },
    });
  });

  it("估算锚定且官方净值未公布时计入待结算，不写库", async () => {
    navMock.mockReset();
    const update = vi.fn(async () => undefined);
    navMock.mockResolvedValue([navPoint({ nav_date: PREV, unit_nav: 3 })]);

    const result = await settleFundPositions(
      [
        position({
          plan: null,
          amount: 300,
          profit: 30,
          manual_anchor: { nav_date: TODAY, nav: 3.07, source: "estimate" },
        }),
      ],
      { update },
    );

    expect(result).toEqual({ checked: 1, resettled: [], pending: ["110022"] });
    expect(update).not.toHaveBeenCalled();
  });

  it("已锚定在最新收盘口径的手动持仓不重复推进", async () => {
    navMock.mockReset();
    const update = vi.fn(async () => undefined);
    navMock.mockResolvedValue([
      navPoint({ nav_date: PREV, unit_nav: 3 }),
      navPoint({ nav_date: TODAY, unit_nav: 3.03 }),
    ]);

    const result = await settleFundPositions(
      [
        position({
          plan: null,
          amount: 300,
          profit: 30,
          manual_anchor: { nav_date: TODAY, nav: 3.03, source: "official" },
        }),
      ],
      { update },
    );

    expect(result).toEqual({ checked: 1, resettled: [], pending: [] });
    expect(update).not.toHaveBeenCalled();
  });
});
