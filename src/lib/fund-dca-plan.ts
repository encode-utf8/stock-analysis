// 基金定投计划账本（纯函数，不依赖网络与数据库，便于单元测试）。
//
// 设计要点（详见 docs/fund-dca-plan-tracking-plan.md）：
//   1. 计划只统计「启用日」之后（含启用日）的期次：不回溯历史、不建模底仓。
//   2. 账本是「计划参数 + 历史净值」的纯函数，不依赖任何运行状态：
//      服务器停机期间无需补跑任何任务，重新启动后按同一份净值数据重算，
//      得到的期数、累计投入与份额与「一直在线」完全一致。
//   3. 每期目标日按频率推进（每日 / 每周指定星期几 / 每两周 / 每月）；
//      实际扣款净值取「不晚于目标日的最近一个可用净值日」，
//      因此定投日当天就能看到已投期次，当晚公布真实净值后自动修正。
//   4. 手动校准：把某净值日的实际持有金额与累计收益折算成「份额 + 本金」基线，
//      校准日之前的期次不再重复计入，校准之后继续按期累加。
import type {
  FundDcaPlan,
  FundNavPoint,
  FundPlanFrequency,
  FundPlanWeekday,
  FundPositionCalibration,
} from "@/lib/shared/types";
import type { FundNavRange } from "@/lib/fund-data";

/** 支持的定投频率；界面下拉与校验共用。 */
export const PLAN_FREQUENCIES: FundPlanFrequency[] = ["daily", "weekly", "biweekly", "monthly"];

/** 每周定投可选的星期几（仅交易时段内的周一至周五）。 */
export const PLAN_WEEKDAYS: FundPlanWeekday[] = [1, 2, 3, 4, 5];

/** 单份计划的最大期数保护：按每日定投约 8 年，避免异常参数导致超长循环。 */
export const MAX_PLAN_PERIODS = 2000;

const MS_PER_DAY = 86_400_000;

/** 判断是否为受支持的定投频率。 */
export function isPlanFrequency(value: unknown): value is FundPlanFrequency {
  return PLAN_FREQUENCIES.includes(value as FundPlanFrequency);
}

/** 判断是否为受支持的每周定投星期几。 */
export function isPlanWeekday(value: unknown): value is FundPlanWeekday {
  return typeof value === "number" && PLAN_WEEKDAYS.includes(value as FundPlanWeekday);
}

/** 金额保留两位小数。 */
export function round2(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

/** 份额保留四位小数：足以让金额误差低于 0.01 元。 */
export function round4(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 10000) / 10000 : 0;
}

/** 判断是否为合法的 YYYY-MM-DD 日期键。 */
export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const time = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** 按天平移日期键。 */
export function shiftDays(dateKey: string, days: number): string {
  return new Date(Date.parse(dateKey + "T00:00:00Z") + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** 取日期键的星期几：1 = 周一 … 7 = 周日。 */
export function weekdayOf(dateKey: string): number {
  const weekday = new Date(Date.parse(dateKey + "T00:00:00Z")).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** 按月推进日期键；目标月天数不足时收敛到月末（1 月 31 日 + 1 月 → 2 月 28/29 日）。 */
export function addMonths(dateKey: string, months: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const totalMonths = year * 12 + (month - 1) + months;
  const nextYear = Math.floor(totalMonths / 12);
  const nextMonth = (totalMonths % 12) + 1;
  const lastDay = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
  const pad = (value: number) => String(value).padStart(2, "0");
  return pad(nextYear) + "-" + pad(nextMonth) + "-" + pad(Math.min(day, lastDay));
}

/** 按频率推进一期目标日。 */
export function addPlanPeriod(dateKey: string, frequency: FundPlanFrequency): string {
  if (frequency === "daily") {
    return shiftDays(dateKey, 1);
  }
  if (frequency === "weekly") {
    return shiftDays(dateKey, 7);
  }
  if (frequency === "biweekly") {
    return shiftDays(dateKey, 14);
  }
  return addMonths(dateKey, 1);
}

/**
 * 生成计划的目标日序列：首期为启用日，之后按频率推进到 today（含）。
 * 每周定投会先锚定到「不早于启用日的第一个所选星期几」。
 */
export function buildPlanTargetDates(
  plan: Pick<FundDcaPlan, "frequency" | "weekday" | "start_date">,
  today: string,
): string[] {
  if (!isDateKey(plan.start_date) || plan.start_date > today) {
    return [];
  }

  let cursor = plan.start_date;
  if (plan.frequency === "weekly" && plan.weekday) {
    // 最多向后找 7 天即可命中目标星期几。
    for (let offset = 0; offset < 7 && weekdayOf(cursor) !== plan.weekday; offset += 1) {
      cursor = shiftDays(cursor, 1);
    }
  }

  const dates: string[] = [];
  while (cursor <= today && dates.length < MAX_PLAN_PERIODS) {
    dates.push(cursor);
    cursor = addPlanPeriod(cursor, plan.frequency);
  }
  return dates;
}

/** 一期实际扣款记录。 */
export interface FundPlanPeriod {
  /** 计划目标日（按频率推进所得）。 */
  target_date: string;
  /** 实际采用的净值日（不晚于目标日的最近一个可用净值日）。 */
  nav_date: string;
  /** 该期单位净值。 */
  nav: number;
}

/** 把目标日映射到实际扣款净值日；找不到可用净值的目标日直接跳过。 */
export function buildPlanPeriods(nav: FundNavPoint[], targetDates: string[]): FundPlanPeriod[] {
  const usable = nav
    .filter((point) => Number.isFinite(point.unit_nav) && point.unit_nav > 0)
    .slice()
    .sort((left, right) => left.nav_date.localeCompare(right.nav_date));
  if (usable.length === 0) {
    return [];
  }

  const periods: FundPlanPeriod[] = [];
  for (const target of targetDates) {
    // 取不晚于目标日的最近一个净值日：定投日当天即可看到已投期次，净值公布后自动修正。
    let hit: FundNavPoint | null = null;
    for (const point of usable) {
      if (point.nav_date <= target) {
        hit = point;
      } else {
        break;
      }
    }
    if (hit) {
      periods.push({ target_date: target, nav_date: hit.nav_date, nav: hit.unit_nav });
    }
  }
  return periods;
}

/** 计划账本：期次、累计投入（本金）与持仓份额。 */
export interface FundPlanLedger {
  /** 计入的期次（已排除校准日之前的期次）。 */
  periods: FundPlanPeriod[];
  /** 计入的期数。 */
  period_count: number;
  /** 累计投入（本金）= 校准基线本金 + 期数 × 每期金额。 */
  invested: number;
  /** 持仓份额 = 校准基线份额 + Σ(每期金额 / 该期净值)。 */
  shares: number;
  /** 最近一期实际扣款日；尚无期次时为 null。 */
  last_period_date: string | null;
}

/**
 * 计算计划账本。
 * @param input.nav 计划窗口内的历史净值（调用方已过滤可用来源）。
 * @param input.calibration 手动校准基线；null 表示未校准。
 * @param input.today 当前北京日期（YYYY-MM-DD）。
 */
export function computePlanLedger(input: {
  nav: FundNavPoint[];
  plan: FundDcaPlan;
  calibration: FundPositionCalibration | null;
  today: string;
}): FundPlanLedger {
  const { nav, plan, calibration, today } = input;
  const targets = buildPlanTargetDates(plan, today);
  const allPeriods = buildPlanPeriods(nav, targets);
  // 校准已经涵盖校准日（含）之前的所有期次，因此不重复计入。
  const periods = calibration
    ? allPeriods.filter((period) => period.nav_date > calibration.nav_date)
    : allPeriods;

  const periodInvested = periods.length * plan.amount;
  const periodShares = periods.reduce((sum, period) => sum + plan.amount / period.nav, 0);

  return {
    periods,
    period_count: periods.length,
    invested: round2((calibration?.cost ?? 0) + periodInvested),
    shares: round4((calibration?.shares ?? 0) + periodShares),
    last_period_date: periods.length > 0 ? periods.at(-1)!.nav_date : null,
  };
}

/** 计划窗口所需的净值区间：覆盖「起点（校准日或启用日）→ 今天」即可，避免整段全量拉取。 */
export function resolvePlanNavRange(from: string, today: string): FundNavRange {
  const start = isDateKey(from) ? from : today;
  const days = Math.max(
    0,
    Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / MS_PER_DAY),
  );
  if (days <= 25) {
    return "1m";
  }
  if (days <= 80) {
    return "3m";
  }
  if (days <= 170) {
    return "6m";
  }
  if (days <= 350) {
    return "1y";
  }
  if (days <= 1000) {
    return "3y";
  }
  return "all";
}

/** 定投持仓的估值结果（金额与百分比均已取整）。 */
export interface FundDcaPositionMath {
  marketValue: number;
  prevMarketValue: number;
  dayProfit: number | null;
  totalProfit: number;
  totalProfitPct: number | null;
}

/**
 * 由份额、累计投入与净值推导弹出估值：
 *   上一交易日市值 = 份额 × 上一交易日官方净值
 *   当前市值       = 份额 × 实时估值净值（取不到则等同上一交易日市值）
 *   当日收益       = 当前市值 − 上一交易日市值（取不到实时估值时留空，不用 0 冒充）
 *   累计收益       = 当前市值 − 累计投入
 */
export function computeDcaPositionMath(input: {
  shares: number;
  invested: number;
  prevNav: number | null;
  estimatedNav: number | null;
}): FundDcaPositionMath | null {
  const { shares, invested } = input;
  const prevNav = input.prevNav;
  if (!Number.isFinite(shares) || shares <= 0 || prevNav === null || !Number.isFinite(prevNav) || prevNav <= 0) {
    return null;
  }

  const estimated =
    input.estimatedNav !== null && Number.isFinite(input.estimatedNav) && input.estimatedNav > 0
      ? input.estimatedNav
      : null;
  const prevMarketValue = round2(shares * prevNav);
  const marketValue = round2(shares * (estimated ?? prevNav));
  const totalProfit = round2(marketValue - invested);

  return {
    marketValue,
    prevMarketValue,
    dayProfit: estimated === null ? null : round2(marketValue - prevMarketValue),
    totalProfit,
    // 先乘后除只做一次取整，避免 (522.75/3000)*10000 这类中间结果被浮点误差压到 1742.4999…。
    totalProfitPct: invested > 0 ? Math.round((totalProfit * 10000) / invested) / 100 : null,

  };
}