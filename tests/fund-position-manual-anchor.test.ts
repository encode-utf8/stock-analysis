// 手动持仓净值锚点的异步装配测试：录入锚点、生效锚点固化与合并层级对齐。
import { beforeEach, describe, expect, it, vi } from "vitest";

const navMock = vi.hoisted(() => vi.fn());
const intradayMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/fund-data", () => ({ getFundNav: navMock }));
vi.mock("@/lib/fund-intraday", () => ({ getFundIntraday: intradayMock }));

import {
  resolveEffectiveManualAnchor,
  resolveManualAnchor,
  resolveManualMergeBase,
} from "@/lib/fund-position";
import type { FundPosition } from "@/lib/shared/types";

const TODAY = "2026-09-15";

/** 构造持仓记录。 */
function position(overrides: Partial<FundPosition> = {}): FundPosition {
  return {
    id: "p-1",
    code: "110022",
    name: "易方达消费行业股票",
    amount: 400.07,
    profit: 0.07,
    profit_caliber: "exclude_today",
    plan: null,
    calibration: null,
    manual_anchor: null,
    note: null,
    created_at: "2026-09-14T10:28:34.446Z",
    updated_at: "2026-09-14T10:38:29.577Z",
    ...overrides,
  };
}

/** 两个交易日的官方净值。 */
function navPoints() {
  return [
    {
      code: "110022",
      nav_date: "2026-09-11",
      unit_nav: 3.0094,
      cumulative_nav: 4.2,
      daily_change_pct: 0.5,
      source: "akshare",
      fetched_at: "2026-09-11T10:00:00.000Z",
    },
    {
      code: "110022",
      nav_date: "2026-09-14",
      unit_nav: 2.9823,
      cumulative_nav: 4.2,
      daily_change_pct: -0.9,
      source: "akshare",
      fetched_at: "2026-09-14T10:00:00.000Z",
    },
  ];
}

beforeEach(() => {
  navMock.mockReset();
  intradayMock.mockReset();
  // 缺省没有可用盘中行情：返回 null 让 resolveLiveQuote 走「不可用」分支。
  intradayMock.mockResolvedValue(null);
});

describe("resolveManualAnchor", () => {
  it("不含当日锚在严格早于录入日的最近收盘日", async () => {
    navMock.mockResolvedValue(navPoints());

    await expect(resolveManualAnchor("110022", "exclude_today", TODAY)).resolves.toEqual({
      nav_date: "2026-09-14",
      nav: 2.9823,
      source: "official",
    });
  });

  it("含当日优先当天官方净值，其次当天盘中估算", async () => {
    navMock.mockResolvedValue([
      ...navPoints(),
      {
        code: "110022",
        nav_date: TODAY,
        unit_nav: 3.05,
        cumulative_nav: 4.3,
        daily_change_pct: 2.27,
        source: "akshare",
        fetched_at: "2026-09-15T10:00:00.000Z",
      },
    ]);
    intradayMock.mockResolvedValue({
      code: "110022",
      mode: "estimate",
      ts: "2026-09-15T06:00:00.000Z",
      price: null,
      estimated_nav: 3.06,
      change_pct: 2.6,
      open: null,
      high: null,
      low: null,
      volume: null,
      amount: null,
      iopv: null,
      premium_rate: null,
      official_nav: 3.05,
      official_nav_date: TODAY,
      source: "sina",
      fetched_at: "2026-09-15T06:00:00.000Z",
    });

    await expect(resolveManualAnchor("110022", "include_today", TODAY)).resolves.toEqual({
      nav_date: TODAY,
      nav: 3.05,
      source: "official",
    });

    // 官方净值未公布（行情自带的是昨天净值）→ 用当天盘中估算锚定，待官方公布后重锚
    navMock.mockResolvedValue(navPoints());
    intradayMock.mockResolvedValue({
      code: "110022",
      mode: "estimate",
      ts: "2026-09-15T06:00:00.000Z",
      price: null,
      estimated_nav: 3.06,
      change_pct: 2.6,
      open: null,
      high: null,
      low: null,
      volume: null,
      amount: null,
      iopv: null,
      premium_rate: null,
      official_nav: 2.9823,
      official_nav_date: "2026-09-14",
      source: "sina",
      fetched_at: "2026-09-15T06:00:00.000Z",
    });
    await expect(resolveManualAnchor("110022", "include_today", TODAY)).resolves.toEqual({
      nav_date: TODAY,
      nav: 3.06,
      source: "estimate",
    });
  });
});

describe("resolveEffectiveManualAnchor", () => {
  it("已存锚点原样返回，不再取数", async () => {
    const anchor = { nav_date: "2026-09-14", nav: 2.9823, source: "official" as const };
    await expect(resolveEffectiveManualAnchor(position({ manual_anchor: anchor }))).resolves.toEqual(
      anchor,
    );
    expect(navMock).not.toHaveBeenCalled();
  });

  it("历史数据按录入时间推断", async () => {
    navMock.mockResolvedValue(navPoints());
    await expect(resolveEffectiveManualAnchor(position())).resolves.toEqual({
      nav_date: "2026-09-11",
      nav: 3.0094,
      source: "official",
    });
  });
});

describe("resolveManualMergeBase", () => {
  it("把既有记录推进到更靠后的新录入锚点层级后再叠加", async () => {
    navMock.mockResolvedValue(navPoints());
    const fresh = { nav_date: "2026-09-14", nav: 2.9823, source: "official" as const };

    await expect(resolveManualMergeBase(position(), fresh)).resolves.toEqual({
      amount: 396.47,
      profit: -3.53,
      anchor: fresh,
    });
  });

  it("既有锚点更靠后时保持既有层级，不重复推进", async () => {
    navMock.mockResolvedValue(navPoints());
    const anchor = { nav_date: TODAY, nav: 3.06, source: "estimate" as const };

    await expect(
      resolveManualMergeBase(position({ manual_anchor: anchor }), {
        nav_date: "2026-09-14",
        nav: 2.9823,
        source: "official",
      }),
    ).resolves.toEqual({ amount: 400.07, profit: 0.07, anchor });
  });

  it("两边都取不到锚点时原样返回", async () => {
    navMock.mockResolvedValue([]);
    await expect(resolveManualMergeBase(position({ manual_anchor: null }), null)).resolves.toEqual({
      amount: 400.07,
      profit: 0.07,
      anchor: null,
    });
  });
});