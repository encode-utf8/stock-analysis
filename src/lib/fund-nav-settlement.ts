// 净值结算纯函数：估算值的使用窗口、官方净值优先与校准基线重锚。
//
// 设计要点（详见 docs/fund-nav-settlement-plan.md）：
//   1. 官方优先：净值序列里出现「净值日 = 今天」的官方单位净值时，当日涨跌幅、当日收益与
//      估值口径一律改用官方净值推算，盘中估算不再参与展示（R1）。
//   2. 估算不跨日：估算 / 场内实时值只有在「抓取时间属于北京今天」时可用（R2），
//      跨日的陈旧 payload 直接视为不可用，回落官方净值。
//   3. 基线不锁定估算：校准基线优先锚定今天的官方净值；只能拿到估算时记录
//      anchor = "estimate"，待官方净值公布后按「估算锚定净值 / 官方净值」重锚份额（R4 / R5）。
import { round4 } from "@/lib/fund-dca-plan";
import { round2, roundPct } from "@/lib/fund-position-calc";
import { beijingDateKey } from "@/lib/trading-calendar";
import type {
  FundIntraday,
  FundNavPoint,
  FundPositionCalibration,
  FundPositionCalibrationAnchor,
  FundPositionManualAnchor,
  FundProfitCaliber,
} from "@/lib/shared/types";

/** 判断净值 / 行情来源是否可用于估值；确定性降级数据只保证页面可渲染，不参与估值。 */
export function isUsableNavSource(source: string | null | undefined): boolean {
  return typeof source === "string" && source.length > 0 && source !== "deterministic-fallback";
}

/** 过滤出可用的官方净值点（来源可用且单位净值有效）。 */
export function usableNavPoints(
  points: readonly FundNavPoint[] | null | undefined,
): FundNavPoint[] {
  return (points ?? []).filter(
    (point) => isUsableNavSource(point.source) && Number.isFinite(point.unit_nav) && point.unit_nav > 0,
  );
}

/** 严格早于 today 的最近一个可用净值日（「昨收」）；取不到返回 null。 */
export function resolvePrevNavPoint(
  points: readonly FundNavPoint[] | null | undefined,
  today: string,
): FundNavPoint | null {
  let latest: FundNavPoint | null = null;
  for (const point of usableNavPoints(points)) {
    if (point.nav_date >= today) {
      continue;
    }
    if (latest === null || point.nav_date > latest.nav_date) {
      latest = point;
    }
  }
  return latest;
}

/** 取「净值日 = date」的官方净值点；今天是否已公布官方净值即用 today 判断。 */
export function resolveNavPointOn(
  points: readonly FundNavPoint[] | null | undefined,
  date: string,
): FundNavPoint | null {
  return usableNavPoints(points).find((point) => point.nav_date === date) ?? null;
}

/** 官方净值的统一形态：既可能是历史序列里的点，也可能是盘中行情自带的公布净值。 */
export interface OfficialNavSnapshot {
  nav: number;
  nav_date: string;
  source: string | null;
  fetched_at: string | null;
}

/**
 * 取指定净值日的官方单位净值：历史净值序列优先，其次盘中行情自带的官方净值。
 * 上游未给出净值日（official_nav_date 为空）时不参与判定，避免把历史净值当成今天。
 */
export function resolveOfficialNavOn(
  points: readonly FundNavPoint[] | null | undefined,
  intraday: FundIntraday | null | undefined,
  date: string,
): OfficialNavSnapshot | null {
  const point = resolveNavPointOn(points, date);
  if (point) {
    return {
      nav: point.unit_nav,
      nav_date: point.nav_date,
      source: point.source,
      fetched_at: point.fetched_at,
    };
  }

  if (
    intraday &&
    isUsableNavSource(intraday.source) &&
    intraday.official_nav_date === date &&
    typeof intraday.official_nav === "number" &&
    Number.isFinite(intraday.official_nav) &&
    intraday.official_nav > 0
  ) {
    return {
      nav: intraday.official_nav,
      nav_date: date,
      source: intraday.source,
      fetched_at: intraday.fetched_at,
    };
  }

  return null;
}

/** 行情抓取时间是否属于北京今天；跨日的估算 / 实时值一律不可用。 */
export function isIntradayFromToday(
  intraday: FundIntraday | null | undefined,
  today: string,
): boolean {
  if (!intraday || typeof intraday.fetched_at !== "string") {
    return false;
  }
  const time = Date.parse(intraday.fetched_at);
  return Number.isFinite(time) && beijingDateKey(new Date(time)) === today;
}

/** 盘中可用估值：场外估算净值 / 场内实时价（跨日值视为不可用）。 */
export interface LiveQuote {
  nav: number;
  mode: "estimate" | "realtime";
  source: string;
  fetched_at: string;
}

/** 取当天可用的盘中估值；官方净值已公布时由调用方改用官方净值（见 resolveOfficialNavOn）。 */
export function resolveLiveQuote(
  intraday: FundIntraday | null | undefined,
  today: string,
): LiveQuote | null {
  if (!intraday || !isUsableNavSource(intraday.source) || !isIntradayFromToday(intraday, today)) {
    return null;
  }
  const nav = intraday.mode === "realtime" ? intraday.price : intraday.estimated_nav;
  if (typeof nav !== "number" || !Number.isFinite(nav) || nav <= 0) {
    return null;
  }
  return {
    nav,
    mode: intraday.mode === "realtime" ? "realtime" : "estimate",
    source: intraday.source,
    fetched_at: intraday.fetched_at,
  };
}

/** 已结算的当日涨跌幅：今日官方净值 / 昨收净值 − 1（百分比，保留 2 位）；取不到返回 null。 */
export function resolveSettledChangePct(
  points: readonly FundNavPoint[] | null | undefined,
  today: string,
  settledNav?: number | null,
): number | null {
  const settled =
    settledNav ?? resolveOfficialNavOn(points, null, today)?.nav ?? null;
  const prev = resolvePrevNavPoint(points, today);
  if (settled === null || !Number.isFinite(settled) || settled <= 0 || prev === null) {
    return null;
  }
  return roundPct((settled / prev.unit_nav - 1) * 100);
}

/** 校准基线的结算结果。 */
export interface CalibrationSettlement {
  /** 结算后的有效基线（估算锚定且官方净值已可取到时会被重锚）。 */
  calibration: FundPositionCalibration;
  /** 基线仍锚定在估算值上、官方净值尚未取到：界面标注「待结算」。 */
  pending: boolean;
}

/**
 * 结算校准基线（R5 读时投影）：
 * 估算锚定的基线一旦拿到「锚定日的官方净值」，就按 `份额 × 估算净值 / 官方净值` 重锚，
 * 本金（cost）与净值日（nav_date）不变，因此不会改变用户的录入事实，只把份额换成官方口径。
 * 官方净值还没公布时保持估算值并标记待结算，不用估算冒充官方。
 */
export function settleCalibration(
  calibration: FundPositionCalibration | null,
  points: readonly FundNavPoint[] | null | undefined,
  today: string,
): CalibrationSettlement | null {
  if (calibration === null) {
    return null;
  }
  if (calibration.anchor !== "estimate" || calibration.nav === null) {
    return { calibration, pending: false };
  }
  if (calibration.nav_date > today) {
    // 锚定日不可能晚于今天：数据异常时保持估算并标记待结算，不做重锚。
    return { calibration, pending: true };
  }

  const official = resolveOfficialNavOn(points, null, calibration.nav_date);
  if (official === null || !Number.isFinite(official.nav) || official.nav <= 0) {
    return { calibration, pending: true };
  }

  const shares = round4((calibration.shares * calibration.nav) / official.nav);
  return {
    calibration: {
      nav_date: calibration.nav_date,
      nav: round4(official.nav),
      shares,
      cost: calibration.cost,
      anchor: "official",
    },
    pending: false,
  };
}

export function buildCalibration(
  input: { amount: number; profit: number; nav: number; navDate: string; anchor: FundPositionCalibrationAnchor },
): FundPositionCalibration {
  return {
    nav_date: input.navDate,
    nav: round4(input.nav),
    shares: round4(input.amount / input.nav),
    cost: round2(input.amount - input.profit),
    anchor: input.anchor,
  };
}

/** 手动持仓的净值锚点输入：一组「持有金额 + 累计收益」对应的净值日。 */
export interface ManualSnapshotInput {
  amount: number;
  profit: number;
  anchor: FundPositionManualAnchor;
}

/** 手动持仓快照的滚存结果。 */
export interface ManualSnapshotRoll {
  /** 滚存后的净值日（记录值对应的收盘口径日）。 */
  nav_date: string;
  /** 滚存后锚定的净值：官方口径为官方单位净值，仍未结算时为原估算值或 null。 */
  nav: number | null;
  /** 滚存后的持有金额。 */
  amount: number;
  /** 滚存后的累计收益（与市值同步平移，因此推算本金不变）。 */
  profit: number;
  /** 有效锚定来源：重锚或滚存后为 official，否则保持原来源。 */
  source: FundPositionCalibrationAnchor;
  /** 是否发生了「估算锚定 → 官方净值」的重锚。 */
  resettled: boolean;
  /** 记录值是否被推进（重锚或按官方净值折算）。 */
  rolled: boolean;
}

/**
 * 定时结算的目标收盘日：今天官方净值已公布取今天，否则取今天之前最近一个收盘日。
 * 读时投影的目标日不同（必须是「今天之前」的收盘日，当日涨跌幅由当日口径单独叠加）。
 */
export function resolveSettleTarget(
  points: readonly FundNavPoint[] | null | undefined,
  today: string,
): string | null {
  if (resolveOfficialNavOn(points, null, today) !== null) {
    return today;
  }
  return resolvePrevNavPoint(points, today)?.nav_date ?? null;
}

/**
 * 把手动录入值推进到 target 日的收盘口径（target 由调用方给出：读时取今天之前最近收盘日，
 * 定时结算取已公布的最新收盘日）：
 * 1. 估算锚定先结算：
 *    - 锚定净值已知（盘中录入，锚定值 = 当时估算净值）且锚定日官方净值已公布 → 按「官方 / 估算」
 *      缩放市值，累计收益平移同样金额（本金不变）；
 *    - 锚定净值未知（历史数据）但锚定日官方净值可得 → 直接把录入值当作该日收盘口径看待。
 * 2. 按「target 收盘净值 / 锚定净值」一步折算市值与累计收益，不做逐日连乘（避免中间取整漂移）。
 * 取不到锚定净值、target 不晚于锚定日或 target 净值缺失时原样返回，不猜测、不补数据。
 */
export function rollManualSnapshot(
  input: ManualSnapshotInput,
  points: readonly FundNavPoint[] | null | undefined,
  target: string | null,
): ManualSnapshotRoll {
  let amount = input.amount;
  let profit = input.profit;
  let anchorNav = input.anchor.nav;
  let source = input.anchor.source;
  let resettled = false;

  if (source === "estimate") {
    const official = resolveOfficialNavOn(points, null, input.anchor.nav_date);
    if (official !== null && official.nav > 0) {
      if (anchorNav !== null && anchorNav > 0) {
        const nextAmount = round2((amount * official.nav) / anchorNav);
        profit = round2(profit + (nextAmount - amount));
        amount = nextAmount;
      }
      anchorNav = official.nav;
      source = "official";
      resettled = true;
    }
  }

  // 结算中间态：已换成官方净值，但还没有推进到 target。
  const settled: ManualSnapshotRoll = {
    nav_date: input.anchor.nav_date,
    nav: anchorNav === null ? null : round4(anchorNav),
    amount,
    profit,
    source,
    resettled,
    rolled: resettled,
  };

  if (target === null || target <= input.anchor.nav_date) {
    return settled;
  }
  if (anchorNav === null || anchorNav <= 0) {
    return settled;
  }
  const point = resolveNavPointOn(points, target);
  if (point === null || point.unit_nav <= 0) {
    return settled;
  }

  const nextAmount = round2((amount * point.unit_nav) / anchorNav);
  return {
    nav_date: point.nav_date,
    nav: round4(point.unit_nav),
    amount: nextAmount,
    profit: round2(profit + (nextAmount - amount)),
    source: "official",
    resettled,
    rolled: true,
  };
}

/** 锚定日官方净值的归一形态：历史净值点与盘中行情自带的公布净值都归到这里。 */
export interface ManualAnchorNav {
  nav: number;
  nav_date: string;
}

/** 组装录入锚点所需的净值素材（净值均按「录入当天」取）。 */
export interface ManualAnchorInput {
  /** 录入口径：决定把录入值钉在哪一天的收盘口径上。 */
  caliber: FundProfitCaliber;
  /** 基准日（录入当天的北京日期键）。 */
  recorded: string;
  /** 基准日的官方净值；尚未公布时为 null。 */
  settled: ManualAnchorNav | null;
  /** 基准日盘中可用估值：只有「含当日」且盘中录入时才存在。 */
  live: LiveQuote | null;
  points: readonly FundNavPoint[] | null | undefined;
}

/**
 * 组装「这一组录入值对应哪一天的收盘口径」：
 * - 不含当日：锚在「严格早于基准日」的最近一个收盘日，这样它之后的收益才能被补进来；
 * - 含当日：优先基准日官方净值（收盘后录入），其次基准日盘中估算值（盘中录入，待官方公布后重锚），
 *   最后回落到基准日之前最近的收盘日（周末 / 节假日录入，录入值就是上一个收盘口径）。
 * 取不到任何净值时返回 null：记录按录入口径原样展示，不做跨日推进。
 */
export function resolveManualAnchorSnapshot(
  input: ManualAnchorInput,
): FundPositionManualAnchor | null {
  const prev = resolvePrevNavPoint(input.points, input.recorded);
  const fallback = prev
    ? { nav_date: prev.nav_date, nav: round4(prev.unit_nav), source: "official" as const }
    : null;
  if (input.caliber === "exclude_today") {
    return fallback;
  }
  if (input.settled !== null) {
    return {
      nav_date: input.settled.nav_date,
      nav: round4(input.settled.nav),
      source: "official",
    };
  }
  if (input.live !== null) {
    return { nav_date: input.recorded, nav: round4(input.live.nav), source: "estimate" };
  }
  return fallback;
}

/**
 * 展示口径：记录值锚在「今天之前」的收盘口径上时，当前市值 = 记录值 ×（1 + 当日涨跌幅），
 * 与「不含当日」的展示口径一致；只有锚在今天的当前值上（当天录入且尚未跨日）才按「含当日」展示。
 * 取不到当日涨跌幅时无从折算，回落到录入口径，避免把已有数字显示成空。
 */
export function resolveManualDisplayCaliber(input: {
  recorded: FundProfitCaliber;
  anchor: FundPositionManualAnchor | null;
  today: string;
  changePct: number | null;
}): FundProfitCaliber {
  if (input.anchor === null || input.changePct === null) {
    return input.recorded;
  }
  return input.anchor.nav_date < input.today ? "exclude_today" : "include_today";
}

/** 取更靠后的锚点：合并记录时以更靠后的层级为准，避免把已结算的旧值再滚一遍。 */
export function pickLaterManualAnchor(
  left: FundPositionManualAnchor | null,
  right: FundPositionManualAnchor | null,
): FundPositionManualAnchor | null {
  if (left === null || right === null) {
    return left ?? right;
  }
  if (left.nav_date !== right.nav_date) {
    return left.nav_date > right.nav_date ? left : right;
  }
  if (left.source !== right.source) {
    return left.source === "official" ? left : right;
  }
  return left;
}

/** 把 ISO 时间戳转成北京日期键；非法输入返回 null。 */
function toBeijingDateKey(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? beijingDateKey(new Date(time)) : null;
}

/**
 * 历史数据（本机制上线前录入）没有锚点，按录入时间推断，口径语义与
 * resolveManualAnchorSnapshot 完全一致；推断不出来时返回 null，记录原样展示。
 */
export function inferManualAnchor(
  input: {
    profit_caliber: FundProfitCaliber;
    created_at: string;
    updated_at: string;
  },
  points: readonly FundNavPoint[] | null | undefined,
): FundPositionManualAnchor | null {
  const recorded =
    toBeijingDateKey(input.updated_at) ?? toBeijingDateKey(input.created_at) ?? null;
  if (recorded === null) {
    return null;
  }
  const point = resolveNavPointOn(points, recorded);
  return resolveManualAnchorSnapshot({
    caliber: input.profit_caliber,
    recorded,
    settled: point ? { nav: point.unit_nav, nav_date: point.nav_date } : null,
    live: null,
    points,
  });
}

/** 有效锚点：优先用记录里存的锚点，缺失时按录入时间推断（历史数据兼容）。 */
export function resolveManualAnchorOf(
  position: {
    profit_caliber: FundProfitCaliber;
    created_at: string;
    updated_at: string;
    manual_anchor?: FundPositionManualAnchor | null;
  },
  points: readonly FundNavPoint[] | null | undefined,
): FundPositionManualAnchor | null {
  return position.manual_anchor ?? inferManualAnchor(position, points);
}

/**
 * 记录值可能锚定的最早净值日：只用于决定读取多长的净值区间，
 * 不做口径判定（判定一律走 resolveManualAnchorOf）。
 */
export function resolveManualAnchorSeedDate(position: {
  created_at: string;
  updated_at: string;
  manual_anchor?: FundPositionManualAnchor | null;
}): string | null {
  return (
    position.manual_anchor?.nav_date ??
    toBeijingDateKey(position.updated_at) ??
    toBeijingDateKey(position.created_at) ??
    null
  );
}