// 定投计划账本单测：期次生成、净值对齐、断档补齐（时间无关性）、校准基线与估值推导。
import { describe, expect, it } from "vitest";

import {
  addMonths,
  addPlanPeriod,
  buildPlanPeriods,
  buildPlanTargetDates,
  computeDcaPositionMath,
  computePlanLedger,
  isDateKey,
  isPlanFrequency,
  isPlanWeekday,
  resolvePlanNavRange,
  round4,
  weekdayOf,
} from "@/lib/fund-dca-plan";
import type { FundDcaPlan, FundNavPoint, FundPositionCalibration } from "@/lib/shared/types";

/** 构造净值点。 */
function navPoint(nav_date: string, unit_nav: number): FundNavPoint {
  return {
    code: "110022",
    nav_date,
    unit_nav,
    cumulative_nav: unit_nav,
    daily_change_pct: 0,
    source: "akshare",
    fetched_at: "2026-09-14T10:00:00.000Z",
  };
}

/** 构造定投计划。 */
function plan(overrides: Partial<FundDcaPlan> = {}): FundDcaPlan {
  return {
    frequency: "monthly",
    weekday: null,
    amount: 1000,
    start_date: "2026-06-15",
    ...overrides,
  };
}

describe("计划参数与日期工具", () => {
  it("识别合法频率与星期几", () => {
    expect(isPlanFrequency("monthly")).toBe(true);
    expect(isPlanFrequency("yearly")).toBe(false);
    expect(isPlanWeekday(3)).toBe(true);
    expect(isPlanWeekday(0)).toBe(false);
    expect(isPlanWeekday(6)).toBe(false);
    expect(isPlanWeekday(null)).toBe(false);
  });

  it("校验日期键", () => {
    expect(isDateKey("2026-06-15")).toBe(true);
    expect(isDateKey("2026-6-5")).toBe(false);
    expect(isDateKey("2026-02-30")).toBe(false);
    expect(isDateKey(null)).toBe(false);
  });

  it("按月推进时收敛到月末，按天推进按周期累加", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-01-15", 2)).toBe("2026-03-15");
    expect(addPlanPeriod("2026-06-15", "monthly")).toBe("2026-07-15");
    expect(addPlanPeriod("2026-06-15", "daily")).toBe("2026-06-16");
    expect(addPlanPeriod("2026-06-15", "weekly")).toBe("2026-06-22");
    expect(addPlanPeriod("2026-06-15", "biweekly")).toBe("2026-06-29");
  });

  it("按日期键取星期几（1=周一，7=周日）", () => {
    expect(weekdayOf("2026-06-15")).toBe(1);
    expect(weekdayOf("2026-07-04")).toBe(6);
  });
});

describe("buildPlanTargetDates", () => {
  it("首期为启用日，按月推进到今天（含当日）", () => {
    expect(buildPlanTargetDates(plan(), "2026-09-14")).toEqual([
      "2026-06-15",
      "2026-07-15",
      "2026-08-15",
    ]);
    // 目标日正好等于今天时计入。
    expect(buildPlanTargetDates(plan(), "2026-09-15")).toContain("2026-09-15");
  });

  it("每日 / 每两周频率按周期推进", () => {
    expect(buildPlanTargetDates(plan({ frequency: "daily", start_date: "2026-09-10" }), "2026-09-14")).toEqual([
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
      "2026-09-14",
    ]);
    expect(
      buildPlanTargetDates(plan({ frequency: "biweekly", start_date: "2026-08-03" }), "2026-09-14"),
    ).toEqual(["2026-08-03", "2026-08-17", "2026-08-31", "2026-09-14"]);

  });

  it("每周定投锚定到所选星期几", () => {
    // 2026-07-01 是周三，选周一 → 首期为 2026-07-06。
    const dates = buildPlanTargetDates(
      plan({ frequency: "weekly", weekday: 1, start_date: "2026-07-01" }),
      "2026-07-20",
    );
    expect(dates).toEqual(["2026-07-06", "2026-07-13", "2026-07-20"]);
  });

  it("启用日晚于今天时不产生期次", () => {
    expect(buildPlanTargetDates(plan({ start_date: "2026-10-01" }), "2026-09-14")).toEqual([]);
  });
});

describe("buildPlanPeriods 净值对齐", () => {
  it("目标日休市时取不晚于该日的最近净值日", () => {
    // 目标 2026-07-04 是周六，只有 07-03 的净值 → 用 07-03 扣款。
    const periods = buildPlanPeriods([navPoint("2026-07-03", 1.5)], ["2026-07-04"]);
    expect(periods).toEqual([{ target_date: "2026-07-04", nav_date: "2026-07-03", nav: 1.5 }]);
  });

  it("忽略非正净值并回退到最近可用净值，目标日早于全部净值时跳过", () => {
    const nav = [navPoint("2026-06-10", 1.2), navPoint("2026-06-11", 0)];
    expect(buildPlanPeriods(nav, ["2026-06-01"])).toEqual([]);
    // 06-11 的净值不可用 → 回退到 06-10。
    expect(buildPlanPeriods(nav, ["2026-06-11"])).toEqual([
      { target_date: "2026-06-11", nav_date: "2026-06-10", nav: 1.2 },
    ]);
  });

});

describe("computePlanLedger", () => {
  const nav = [
    navPoint("2026-06-15", 1),
    navPoint("2026-07-15", 1.25),
    navPoint("2026-08-15", 0.8),
    navPoint("2026-09-14", 1.1),
  ];

  it("按已到期期次累计投入与份额", () => {
    const ledger = computePlanLedger({ nav, plan: plan(), calibration: null, today: "2026-09-14" });

    expect(ledger.period_count).toBe(3);
    expect(ledger.invested).toBe(3000);
    // 1000/1 + 1000/1.25 + 1000/0.8 = 1000 + 800 + 1250
    expect(ledger.shares).toBe(3050);
    expect(ledger.last_period_date).toBe("2026-08-15");
    expect(ledger.periods.map((item) => item.nav_date)).toEqual([
      "2026-06-15",
      "2026-07-15",
      "2026-08-15",
    ]);
  });

  it("断档补齐：期次只由计划与净值决定，与运行状态、计算时刻无关", () => {
    // 场景：计划三个月前启用，期间服务器一直没运行；今天首次启动直接重算。
    const firstRun = computePlanLedger({ nav, plan: plan(), calibration: null, today: "2026-09-14" });
    const secondRun = computePlanLedger({ nav, plan: plan(), calibration: null, today: "2026-09-14" });

    // 没有任何累计状态，两次结果必然一致；期数即为「应投期数」而非「实际执行次数」。
    expect(secondRun).toEqual(firstRun);
    expect(firstRun.period_count).toBe(3);
    expect(firstRun.invested).toBe(3000);
  });

  it("跨过下一期后自动追加一期，无需补跑任务", () => {
    const before = computePlanLedger({ nav, plan: plan(), calibration: null, today: "2026-09-14" });
    const after = computePlanLedger({ nav, plan: plan(), calibration: null, today: "2026-09-15" });

    expect(after.period_count).toBe(before.period_count + 1);
    expect(after.invested).toBe(4000);
    // 09-15 当天还没有当日净值，按不晚于目标日的最近净值 09-14 计份额。
    expect(after.periods.at(-1)).toEqual({
      target_date: "2026-09-15",
      nav_date: "2026-09-14",
      nav: 1.1,
    });
    expect(after.shares).toBe(round4(3050 + 1000 / 1.1));
  });

  it("手动校准后只累加校准日之后的期次", () => {
    const calibration: FundPositionCalibration = {
      nav_date: "2026-07-15",
      nav: 1.1,
      shares: 2100,
      cost: 2000,
      anchor: "official",
    };
    const ledger = computePlanLedger({ nav, plan: plan(), calibration, today: "2026-09-14" });

    // 校准已涵盖 06-15 / 07-15 两期，只剩 08-15 一期继续累加。
    expect(ledger.period_count).toBe(1);
    expect(ledger.periods.map((item) => item.nav_date)).toEqual(["2026-08-15"]);
    expect(ledger.invested).toBe(3000);
    expect(ledger.shares).toBe(round4(2100 + 1000 / 0.8));
  });

  it("启用当天即计入首期（按最近可用净值成交）", () => {
    const ledger = computePlanLedger({
      nav,
      plan: plan({ start_date: "2026-09-14" }),
      calibration: null,
      today: "2026-09-14",
    });
    expect(ledger.period_count).toBe(1);
    expect(ledger.invested).toBe(1000);
    expect(ledger.shares).toBe(round4(1000 / 1.1));
    expect(ledger.last_period_date).toBe("2026-09-14");
  });

  it("完全没有可用净值时账本为空", () => {
    const ledger = computePlanLedger({ nav: [], plan: plan(), calibration: null, today: "2026-09-14" });
    expect(ledger.period_count).toBe(0);
    expect(ledger.invested).toBe(0);
    expect(ledger.shares).toBe(0);
    expect(ledger.last_period_date).toBeNull();
  });

});

describe("computeDcaPositionMath", () => {
  it("按份额与净值推导市值、当日收益与累计收益", () => {
    const math = computeDcaPositionMath({
      shares: 3050,
      invested: 3000,
      prevNav: 1.1,
      estimatedNav: 1.155,
    });

    expect(math?.prevMarketValue).toBe(3355);
    expect(math?.marketValue).toBe(3522.75);
    expect(math?.dayProfit).toBe(167.75);
    expect(math?.totalProfit).toBe(522.75);
    expect(math?.totalProfitPct).toBe(17.43);
  });

  it("取不到实时估值时当日收益留空，但市值与累计收益仍可用", () => {
    const math = computeDcaPositionMath({
      shares: 3050,
      invested: 3000,
      prevNav: 1.1,
      estimatedNav: null,
    });

    expect(math?.dayProfit).toBeNull();
    expect(math?.marketValue).toBe(3355);
    expect(math?.totalProfit).toBe(355);
  });

  it("净值或份额不可用时返回 null", () => {
    expect(computeDcaPositionMath({ shares: 3050, invested: 3000, prevNav: null, estimatedNav: 1.1 })).toBeNull();
    expect(computeDcaPositionMath({ shares: 0, invested: 0, prevNav: 1.1, estimatedNav: 1.1 })).toBeNull();
    expect(computeDcaPositionMath({ shares: 100, invested: 0, prevNav: -1, estimatedNav: null })).toBeNull();
  });

  it("本金非正时不输出收益率", () => {
    const math = computeDcaPositionMath({ shares: 100, invested: 0, prevNav: 1, estimatedNav: 1 });
    expect(math?.totalProfitPct).toBeNull();
  });
});

describe("resolvePlanNavRange", () => {
  it("按起点到今天的跨度选择最小区间", () => {
    expect(resolvePlanNavRange("2026-09-01", "2026-09-14")).toBe("1m");
    expect(resolvePlanNavRange("2026-07-01", "2026-09-14")).toBe("3m");
    expect(resolvePlanNavRange("2026-04-01", "2026-09-14")).toBe("6m");
    expect(resolvePlanNavRange("2025-10-01", "2026-09-14")).toBe("1y");
    expect(resolvePlanNavRange("2024-06-01", "2026-09-14")).toBe("3y");

    expect(resolvePlanNavRange("2015-01-01", "2026-09-14")).toBe("all");
  });
});