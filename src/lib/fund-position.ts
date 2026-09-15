// 基金持有组合数据访问与估值编排。
// 存储策略与自选池、个股持仓一致：优先 PostgreSQL，失败时回退 .data/fund-positions.json。
// 录入口径为极简四项（代码、当前持有金额、累计收益、累计收益是否含当日收益），
// 当日收益由盘中涨跌幅推导，数值计算全部复用纯函数 fund-position-calc。
// 启用定投计划后，持有金额与累计收益改由「计划 + 历史净值」派生（纯函数 fund-dca-plan），
// 停机期间的期次无需补跑：重启后重算即可得到与一直在线一致的结果。

// 两种口径的定义与降级约定见 docs/fund-position-caliber-plan.md。
import { asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getDb, schema } from "@/lib/db";
import { getFundNav, type FundNavRange } from "@/lib/fund-data";
import {
  computeDcaPositionMath,
  computePlanLedger,
  isDateKey,
  isPlanFrequency,
  isPlanWeekday,
  resolvePlanNavRange,
  round4,
} from "@/lib/fund-dca-plan";
import {
  buildCalibration,
  isIntradayFromToday,
  isUsableNavSource,
  pickLaterManualAnchor,
  resolveLiveQuote,
  resolveManualAnchorOf,
  resolveManualAnchorSeedDate,
  resolveManualAnchorSnapshot,
  resolveManualDisplayCaliber,
  resolveOfficialNavOn,
  resolvePrevNavPoint,
  resolveSettledChangePct,
  resolveSettleTarget,
  rollManualSnapshot,
  settleCalibration,
} from "@/lib/fund-nav-settlement";
import type { OfficialNavSnapshot } from "@/lib/fund-nav-settlement";
import { beijingDateKey } from "@/lib/trading-calendar";

import { getFundIntraday } from "@/lib/fund-intraday";
import { normalizeFundCode, resolveFundProfile } from "@/lib/fund-market";
import {
  computeFundPositionMath,
  computeWeights,
  DEFAULT_FUND_PROFIT_CALIBER,
  isFundProfitCaliber,
  normalizeFundProfitCaliber,
  parseNumericInput,
  round2,
  sumValuations,
} from "@/lib/fund-position-calc";
import type {
  FundDcaPlan,
  FundDcaPlanInput,
  FundIntraday,
  FundNavPoint,
  FundPlanWeekday,
  FundPosition,
  FundPositionCalibration,
  FundPositionInput,
  FundPositionManualAnchor,
  FundProfitCaliber,

  FundPositionNavMode,
  FundPositionSnapshot,
  FundPositionSummary,
  FundPositionUpdateInput,
  FundPositionValuation,
} from "@/lib/shared/types";

/** 本地持久化文件；数据库不可用时保证重启后仍保留。 */
const POSITION_FILE = path.join(process.cwd(), ".data", "fund-positions.json");

/** 持有金额与累计收益的取值范围，超出视为脏数据直接拒绝。 */
const AMOUNT_MAX = 1e12;
const PROFIT_ABS_MAX = 1e13;

/** 备注长度上限，避免超长文本写库。 */
const NOTE_MAX_LENGTH = 120;

/** 每期定投金额上限，超出视为误输入。 */
const PLAN_AMOUNT_MAX = 1e8;


/** 界面统一展示的数据来源与口径说明。 */
const DEFAULT_SOURCE_NOTE =
  "当日涨跌幅与实时估值来自本地行情侧车（场内实时价 / 场外盘中估算净值，60 秒缓存），昨收净值取最新公布单位净值；取不到时对应字段显示为空。";

/** 明细备注归一化：去空白，空串转为 null，超长截断。 */
function normalizeNote(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, NOTE_MAX_LENGTH) : null;
}

/**
 * 校验并归一化定投计划入参。
 * 缺省返回 null（不启用计划）；日常校验失败返回错误文案。
 */
export function resolvePlanInput(raw: unknown): { value: FundDcaPlan | null } | { error: string } {
  if (raw === undefined || raw === null) {
    return { value: null };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "定投计划格式不正确。" };
  }
  const plan = raw as FundDcaPlanInput;

  if (!isPlanFrequency(plan.frequency)) {
    return { error: "定投频率只能是每日、每周、每两周或每月。" };
  }
  const frequency = plan.frequency;

  // 仅每周计划需要星期几；其它频率忽略该字段，避免前端多传导致保存失败。
  let weekday: FundPlanWeekday | null = null;
  if (frequency === "weekly") {
    const parsed = typeof plan.weekday === "string" ? Number(plan.weekday) : plan.weekday;
    if (!isPlanWeekday(parsed)) {
      return { error: "每周定投需要选择星期几（周一至周五）。" };
    }
    weekday = parsed;
  }

  const amount = parseNumericInput(plan.amount);
  if (amount === null || amount <= 0) {
    return { error: "每期定投金额必须是大于 0 的数字。" };
  }
  if (amount > PLAN_AMOUNT_MAX) {
    return { error: "每期定投金额过大，请确认输入是否正确。" };
  }

  // 启用日缺省为今天：定投计划只统计启用之后的期次，不回溯历史。
  const today = beijingDateKey(new Date());
  let startDate = today;
  const startRaw = plan.start_date;
  if (startRaw !== undefined && startRaw !== null && startRaw !== "") {
    if (!isDateKey(startRaw)) {
      return { error: "定投启用日格式应为 YYYY-MM-DD。" };
    }
    if (startRaw > today) {
      return { error: "定投启用日不能晚于今天。" };
    }
    startDate = startRaw;
  }

  return { value: { frequency, weekday, amount: round2(amount), start_date: startDate } };
}

/** 归一化持久化数据中的定投计划；结构不可用时按「未启用」处理。 */
function normalizeStoredPlan(value: unknown): FundDcaPlan | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const plan = value as Partial<FundDcaPlan>;
  const amount = Number(plan.amount);
  if (!isPlanFrequency(plan.frequency) || !isDateKey(plan.start_date)) {
    return null;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  return {
    frequency: plan.frequency,
    weekday: isPlanWeekday(plan.weekday) ? plan.weekday : null,
    amount: round2(amount),
    start_date: plan.start_date,
  };
}

/** 归一化持久化数据中的校准基线；结构不可用时按「未校准」处理。 */
function normalizeStoredCalibration(value: unknown): FundPositionCalibration | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const item = value as Partial<FundPositionCalibration>;
  const shares = Number(item.shares);
  const cost = Number(item.cost);
  const nav = Number(item.nav);
  if (!isDateKey(item.nav_date) || !Number.isFinite(shares) || shares <= 0 || !Number.isFinite(cost)) {
    return null;
  }
  return {
    nav_date: item.nav_date,
    // 历史数据没有锚定净值：不重锚（anchor 缺省 official），避免追溯改写既有数值。
    nav: Number.isFinite(nav) && nav > 0 ? round4(nav) : null,
    shares: round4(shares),
    cost: round2(cost),
    anchor: item.anchor === "estimate" ? "estimate" : "official",
  };
}

/** 归一化持久化数据中的手动持仓锚点；结构不可用时按「无锚点」处理（回落到按录入时间推断）。 */
function normalizeStoredManualAnchor(value: unknown): FundPositionManualAnchor | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const item = value as Partial<FundPositionManualAnchor>;
  if (!isDateKey(item.nav_date)) {
    return null;
  }
  const nav = Number(item.nav);
  return {
    nav_date: item.nav_date,
    nav: Number.isFinite(nav) && nav > 0 ? round4(nav) : null,
    source: item.source === "estimate" ? "estimate" : "official",
  };
}

/** 校验新增持仓入参：只接受代码、当前持有金额、当前累计收益、累计收益口径与可选定投计划。 */


export function validateFundPositionInput(
  input: FundPositionInput,
): {
  value: {
    code: string;
    amount: number;
    profit: number;
    profit_caliber: FundProfitCaliber;
    plan: FundDcaPlan | null;
    note: string | null;
  };
} | { error: string } {

  const code = typeof input?.code === "string" ? normalizeFundCode(input.code) : null;
  if (!code) {
    return { error: "请输入 6 位基金代码。" };
  }

  const planResult = resolvePlanInput(input?.plan);
  if ("error" in planResult) {
    return planResult;
  }
  const plan = planResult.value;

  // 启用定投计划时持有金额与累计收益由计划派生，录入值无意义，统一落 0。
  let amount = 0;
  let profit = 0;
  let profitCaliber: FundProfitCaliber = DEFAULT_FUND_PROFIT_CALIBER;

  if (plan === null) {
    const amountValue = parseNumericInput(input?.amount);
    if (amountValue === null || amountValue <= 0) {
      return { error: "当前持有金额必须是大于 0 的数字。" };
    }
    if (amountValue > AMOUNT_MAX) {
      return { error: "当前持有金额过大，请确认输入是否正确。" };
    }
    amount = round2(amountValue);

    const profitValue =
      input.profit === undefined || input.profit === null ? 0 : parseNumericInput(input.profit);
    if (profitValue === null) {
      return { error: "当前累计收益必须是数字，可以为负。" };
    }
    if (Math.abs(profitValue) > PROFIT_ABS_MAX) {
      return { error: "当前累计收益过大，请确认输入是否正确。" };
    }
    profit = round2(profitValue);

    // 口径缺省为「含当日收益」：与历史数据语义一致，避免旧调用方被拒。
    const caliberRaw = input.profit_caliber;
    const caliber =
      caliberRaw === undefined || caliberRaw === null || caliberRaw === ""
        ? undefined
        : isFundProfitCaliber(caliberRaw)
          ? caliberRaw
          : null;
    if (caliber === null) {
      return { error: "累计收益口径只能是「含当日收益」或「不含当日收益」。" };
    }
    profitCaliber = caliber ?? DEFAULT_FUND_PROFIT_CALIBER;
  }

  return {
    value: {
      code,
      amount,
      profit,
      profit_caliber: profitCaliber,
      plan,
      note: normalizeNote(input.note),
    },
  };
}


/**
 * 校验更新持仓入参；允许调整持有金额、累计收益、累计收益口径、定投计划、手动校准与备注。
 * @param existing 变更前的记录，用于判断「关闭定投计划」是否需要同时固化手动值。
 */
export function validateFundPositionUpdate(
  input: FundPositionUpdateInput,
  existing?: FundPosition,
): {
  value: {
    amount?: number;
    profit?: number;
    profit_caliber?: FundProfitCaliber;
    plan?: FundDcaPlan | null;
    /** 待折算的校准入参；调用方结合当前估值净值转成 FundPositionCalibration 后再落库。 */
    calibration_input?: { amount: number; profit: number } | null;
    note?: string | null;
  };
} | { error: string } {
  const value: {
    amount?: number;
    profit?: number;
    profit_caliber?: FundProfitCaliber;
    plan?: FundDcaPlan | null;
    calibration_input?: { amount: number; profit: number } | null;
    note?: string | null;
  } = {};

  if (input.amount !== undefined) {
    const amount = parseNumericInput(input.amount);
    if (amount === null || amount <= 0) {
      return { error: "当前持有金额必须是大于 0 的数字。" };
    }
    if (amount > AMOUNT_MAX) {
      return { error: "当前持有金额过大，请确认输入是否正确。" };
    }
    value.amount = round2(amount);
  }

  if (input.profit !== undefined) {
    const profit = parseNumericInput(input.profit);
    if (profit === null) {
      return { error: "当前累计收益必须是数字，可以为负。" };
    }
    if (Math.abs(profit) > PROFIT_ABS_MAX) {
      return { error: "当前累计收益过大，请确认输入是否正确。" };
    }
    value.profit = round2(profit);
  }

  // 口径只在显式传入时更新；传 null/缺省表示不动。
  if (input.profit_caliber !== undefined && input.profit_caliber !== null) {
    if (!isFundProfitCaliber(input.profit_caliber)) {
      return { error: "累计收益口径只能是「含当日收益」或「不含当日收益」。" };
    }
    value.profit_caliber = input.profit_caliber;
  }

  if (input.plan !== undefined) {
    // 定投计划只在「添加持有基金」里创建（按代码合并到已有条目）；「修改」只允许取消定投。
    if (input.plan !== null) {
      return {
        error: "如需启用或调整定投计划，请在「添加持有基金」中改用定投方式录入；「修改」只支持取消定投。",
      };
    }
    value.plan = null;
    // 取消计划后持有金额与累计收益失去派生来源，必须同时固化一组手动值。
    if (existing?.plan) {
      if (value.amount === undefined || value.profit === undefined) {
        return { error: "取消定投时请同时填写当前持有金额与累计收益，用于固化为手动持仓。" };
      }
      // 校准基线只服务于计划派生，取消计划后一并清除。
      value.calibration_input = null;
    }
  }

  if (input.calibration !== undefined) {
    if (input.calibration === null) {
      value.calibration_input = null;
    } else {
      const amount = parseNumericInput(input.calibration.amount);
      if (amount === null || amount <= 0) {
        return { error: "校准时请填写大于 0 的当前持有金额。" };
      }
      if (amount > AMOUNT_MAX) {
        return { error: "当前持有金额过大，请确认输入是否正确。" };
      }
      const profit =
        input.calibration.profit === undefined || input.calibration.profit === null
          ? 0
          : parseNumericInput(input.calibration.profit);
      if (profit === null || Math.abs(profit) > PROFIT_ABS_MAX) {
        return { error: "校准的累计收益必须是数字，可以为负。" };
      }
      value.calibration_input = { amount: round2(amount), profit: round2(profit) };
    }
  }

  if (input.note !== undefined) {
    value.note = normalizeNote(input.note);
  }

  if (Object.keys(value).length === 0) {
    return { error: "没有需要更新的字段。" };
  }

  return { value };
}


/** 同一基金代码只保留一条记录：再次录入时自动合并到已有条目 / 换用定投计划。 */
export type FundPositionUpsert =
  | { action: "merge_manual" | "update_plan"; patch: FundPositionPatch }
  | {
      action: "attach_plan";
      patch: FundPositionPatch;
      /** 在既有手动持仓上启用计划时，用既有录入值折算的校准基线，避免已录入的持有凭空消失。 */
      calibrationFrom: { amount: number; profit: number };
    }
  | { error: string };

/**
 * 新增录入按基金代码合并到已有条目（持有列表里一个代码只保留一条记录）。
 * - 普通 → 普通：持有金额与累计收益叠加（口径必须一致，否则两种语义无法相加）
 * - 普通 → 定投：在既有持仓上启用计划，并用既有录入值折算校准基线
 * - 定投 → 定投：更新计划参数（一个基金只能有一个定投计划），已有校准保留
 * - 定投 → 普通：拒绝，请先取消定投，避免手动金额与计划派生的金额混在一起
 */
export function resolveFundPositionUpsert(
  existing: FundPosition,
  input: {
    amount: number;
    profit: number;
    profit_caliber: FundProfitCaliber;
    plan: FundDcaPlan | null;
    note: string | null;
  },
  options: { manualAnchor?: FundPositionManualAnchor | null } = {},
): FundPositionUpsert {
  const note = input.note ?? existing.note;
  const manualAnchor = options.manualAnchor ?? null;

  if (existing.plan && input.plan === null) {
    return {
      error:
        "该基金已启用定投计划，持有金额由计划派生；请先在「修改」中取消定投，再按普通持有录入。",
    };
  }

  if (existing.plan && input.plan) {
    return {
      action: "update_plan",
      patch: {
        plan: input.plan,
        amount: 0,
        profit: 0,
        profit_caliber: "include_today",
        manual_anchor: null,
        note,
      },
    };
  }

  if (input.plan) {
    return {
      action: "attach_plan",
      patch: {
        plan: input.plan,
        amount: 0,
        profit: 0,
        profit_caliber: "include_today",
        manual_anchor: null,
        note,
      },
      calibrationFrom: { amount: existing.amount, profit: existing.profit },
    };
  }

  // 普通持有叠加：口径不同则金额不可相加，直接拒绝而不是猜测。
  const existingCaliber = normalizeFundProfitCaliber(existing.profit_caliber);
  if (existingCaliber !== input.profit_caliber) {
    const label = existingCaliber === "include_today" ? "含当日收益" : "不含当日收益";
    return {
      error: `该基金已在持有列表中（累计收益口径：${label}），再次录入的口径必须一致才能叠加。`,
    };
  }

  return {
    action: "merge_manual",
    patch: {
      amount: round2(existing.amount + input.amount),
      profit: round2(existing.profit + input.profit),
      profit_caliber: input.profit_caliber,
      manual_anchor: manualAnchor,
      note,
    },
  };
}

/** 构建可持久化的持仓记录；名称优先取上游校验结果，其次本地档案。 */
export function buildFundPosition(
  input: {
    code: string;
    amount: number;
    profit: number;
    profit_caliber: FundProfitCaliber;
    plan: FundDcaPlan | null;
    manual_anchor?: FundPositionManualAnchor | null;
    note: string | null;
  },
  name?: string | null,
): FundPosition {
  const now = new Date().toISOString();
  const fallbackName = resolveFundProfile(input.code).name;
  return {
    id: randomUUID(),
    code: input.code,
    name: name?.trim() || fallbackName,
    amount: input.amount,
    profit: input.profit,
    profit_caliber: input.profit_caliber,
    plan: input.plan,
    calibration: null,
    manual_anchor: input.manual_anchor ?? null,
    note: input.note,
    created_at: now,
    updated_at: now,
  };
}


/** 判断来源是否可用于估值；确定性降级数据只保证页面可渲染，不参与估值。 */
function isUsableSource(source: string | null | undefined): boolean {
  return isUsableNavSource(source);
}

/** 计价来源：当前用于推导当日收益的涨跌幅及其口径。 */
export interface PricingSource {
  nav: number;
  changePct: number | null;
  mode: FundPositionNavMode;
  source: string | null;
  fetchedAt: string | null;
}

/** 官方最新单位净值（展示为「上一个交易日收盘净值」）。 */
export interface OfficialNav {
  nav: number;
  /** 该净值对应的净值日（YYYY-MM-DD）；上游未给出时为 null。 */
  navDate: string | null;
  source: string | null;
  fetchedAt: string | null;
}


/** 从历史净值中挑出最新一条官方单位净值；整体不可用时退回盘中行情自带的官方净值。 */
export function resolveOfficialNav(
  points: FundNavPoint[],
  intraday: FundIntraday | null,
): OfficialNav | null {
  const usable = points.filter(
    (point) => isUsableSource(point.source) && Number.isFinite(point.unit_nav) && point.unit_nav > 0,
  );
  if (usable.length > 0) {
    const latest = usable.reduce((left, right) => (left.nav_date >= right.nav_date ? left : right));
    return {
      nav: latest.unit_nav,
      navDate: latest.nav_date,
      source: latest.source,
      fetchedAt: latest.fetched_at,
    };

  }

  if (
    intraday &&
    isUsableSource(intraday.source) &&
    typeof intraday.official_nav === "number" &&
    Number.isFinite(intraday.official_nav) &&
    intraday.official_nav > 0
  ) {
    return {
      nav: intraday.official_nav,
      navDate: intraday.official_nav_date ?? null,
      source: intraday.source,
      fetchedAt: intraday.fetched_at,
    };

  }

  return null;
}

/**
 * 「上一个交易日收盘净值」对应的净值点：取严格早于今天的最近一个可用净值日。
 * 不能直接取「最新一条」——收盘后当日净值已公布，它代表今天收盘而不是昨收，
 * 拿它当昨收会把定投持仓的当日收益算成噪声（实测 110022 在 2026-09-14 晚间即为此情形）。
 */
export function resolvePrevTradingNav(points: FundNavPoint[], today: string): FundNavPoint | null {
  return resolvePrevNavPoint(points, today);
}
/** 确定计价来源：优先场内实时价 / 场外估算净值，其次官方净值，最后视为不可用。 */
export function resolvePricingSource(
  intraday: FundIntraday | null,
  official: OfficialNav | null,
  today?: string,
): PricingSource | null {
  // 跨日的估算 / 实时值不可用（R2）：上游返回陈旧 payload 时，不拿昨天的估值冒充今天的实时值。
  const usableIntraday =
    intraday &&
    isUsableSource(intraday.source) &&
    (today === undefined || isIntradayFromToday(intraday, today))
      ? intraday
      : null;

  if (usableIntraday) {
    const changePct =
      typeof usableIntraday.change_pct === "number" && Number.isFinite(usableIntraday.change_pct)
        ? usableIntraday.change_pct
        : null;
    const estimate =
      usableIntraday.mode === "realtime" ? usableIntraday.price : usableIntraday.estimated_nav;
    if (typeof estimate === "number" && Number.isFinite(estimate) && estimate > 0) {
      return {
        nav: estimate,
        changePct,
        mode: usableIntraday.mode === "realtime" ? "realtime" : "estimate",
        source: usableIntraday.source,
        fetchedAt: usableIntraday.fetched_at,
      };
    }
    if (typeof usableIntraday.official_nav === "number" && usableIntraday.official_nav > 0) {
      // 实时估值退回官方净值展示，但当日涨跌幅若上游给出仍可用于推导当日收益。
      return {
        nav: usableIntraday.official_nav,
        changePct,
        mode: "nav",
        source: usableIntraday.source,
        fetchedAt: usableIntraday.fetched_at,
      };
    }
  }
  if (official) {
    return {
      nav: official.nav,
      changePct: null,
      mode: "nav",
      source: official.source,
      fetchedAt: official.fetchedAt,
    };
  }

  return null;
}

/** 当日官方净值：历史序列优先，其次盘中行情自带的公布净值；非空即表示今天已可结算。 */
function resolveSettledToday(
  navPoints: FundNavPoint[],
  official: OfficialNav | null,
  today: string,
): OfficialNavSnapshot | null {
  const point = resolveOfficialNavOn(navPoints, null, today);
  if (point) {
    return point;
  }
  if (official && official.navDate === today) {
    return {
      nav: official.nav,
      nav_date: today,
      source: official.source,
      fetched_at: official.fetchedAt,
    };
  }
  return null;
}

/**
 * 定投计划持仓的估值：份额与累计投入由计划账本派生，市值按净值折算。
 * 净值不可用时保留「期数 / 累计投入」信息，金额字段留空而不是用 0 冒充。
 */
function valuePlanFundPosition(
  position: FundPosition,
  plan: FundDcaPlan,
  pricing: PricingSource | null,
  official: OfficialNav | null,
  navPoints: FundNavPoint[],
  today: string,
): FundPositionValuation {
  const usableNav = navPoints.filter(
    (point) => isUsableSource(point.source) && point.unit_nav > 0 && point.nav_date <= today,
  );
  // R1：当天官方净值已公布即视为已结算，当日涨跌幅改由官方净值推算，盘中估算不再参与展示。
  const settledToday = resolveSettledToday(navPoints, official, today);
  const settledChangePct =
    settledToday === null ? null : resolveSettledChangePct(navPoints, today, settledToday.nav);
  const effectivePricing: PricingSource | null = settledToday
    ? {
        nav: settledToday.nav,
        changePct: settledChangePct,
        mode: "nav",
        source: settledToday.source,
        fetchedAt: settledToday.fetched_at,
      }
    : pricing;
  const changePct = effectivePricing?.changePct ?? null;
  // R5：估算锚定的校准基线一旦拿到锚定日的官方净值就自动重锚（本金与净值日不变）。
  const settlement = settleCalibration(position.calibration, navPoints, today);
  const ledger = computePlanLedger({
    nav: usableNav,
    plan,
    calibration: settlement?.calibration ?? null,
    today,
  });
  // 昨收取严格早于今天的最近净值日；当日净值已公布时它属于「今天」，不能拿来当昨收。
  const prevPoint = resolvePrevNavPoint(usableNav, today);
  // 历史净值取不到时退回盘中行情自带的昨收；当日净值已公布则不再退回，避免把今天当昨天。
  const prevNav = prevPoint?.unit_nav ?? (settledToday ? null : (official?.nav ?? null));
  // 官方净值已公布时现价即官方净值（估算已过期）；否则优先估算 / 实时价。
  // 只有估算 / 实时口径的净值才代表「含当日」，纯官方净值口径下当日收益留空。
  const liveNav = effectivePricing && effectivePricing.mode !== "nav" ? effectivePricing.nav : null;
  const estimatedNav = settledToday ? settledToday.nav : liveNav;
  const math = computeDcaPositionMath({
    shares: ledger.shares,
    invested: ledger.invested,
    prevNav,
    estimatedNav,
  });

  return {
    position,
    market_value: math?.marketValue ?? null,
    prev_market_value: math?.prevMarketValue ?? null,
    cost_amount: ledger.invested,
    total_profit: math?.totalProfit ?? null,
    profit_caliber: "include_today",
    display_caliber: "include_today",
    dca: {
      frequency: plan.frequency,
      weekday: plan.weekday,
      amount: plan.amount,
      start_date: plan.start_date,
      periods: ledger.period_count,
      invested: ledger.invested,
      shares: ledger.shares,
      last_period_date: ledger.last_period_date,
      calibrated: position.calibration !== null,
    },
    total_profit_pct: math?.totalProfitPct ?? null,
    day_profit: math?.dayProfit ?? null,
    prev_total_profit: math ? round2(math.prevMarketValue - ledger.invested) : null,
    change_pct: changePct,
    // 当日净值已公布时它代表「现价」而不是「实时估值」，因此留空并标注为官方净值口径。
    estimated_nav: settledToday || estimatedNav === null ? null : round2(estimatedNav),
    prev_nav: prevNav === null ? null : round2(prevNav),
    weight_pct: null,
    nav_date: settledToday ? settledToday.nav_date : (official?.navDate ?? null),
    settlement_pending: settlement?.pending ?? false,
    nav_mode: settledToday ? "nav" : (effectivePricing?.mode ?? "unavailable"),
    quote_available: changePct !== null,
    source: settledToday ? settledToday.source : (effectivePricing?.source ?? official?.source ?? null),
    fetched_at: settledToday
      ? settledToday.fetched_at
      : (effectivePricing?.fetchedAt ?? official?.fetchedAt ?? null),
  };
}

/** 把录入的持有金额/累计收益与盘中 / 官方净值合成为面板展示口径（手动持仓分支）。 */
export function valueFundPosition(
  position: FundPosition,
  pricing: PricingSource | null,
  official: OfficialNav | null,
  navPoints: FundNavPoint[] = [],
  today: string = beijingDateKey(new Date()),
): FundPositionValuation {
  if (position.plan) {
    return valuePlanFundPosition(position, position.plan, pricing, official, navPoints, today);
  }

  // R1：当天官方净值已公布即视为已结算，当日涨跌幅改由官方净值精确推算，不再用估算值。
  const settledToday = resolveSettledToday(navPoints, official, today);
  const settledChangePct =
    settledToday === null ? null : resolveSettledChangePct(navPoints, today, settledToday.nav);
  const effectivePricing: PricingSource | null = settledToday
    ? {
        nav: settledToday.nav,
        changePct: settledChangePct,
        mode: "nav",
        source: settledToday.source,
        fetchedAt: settledToday.fetched_at,
      }
    : pricing;
  const changePct = effectivePricing?.changePct ?? null;
  // 「昨收净值」同样必须早于今天：收盘后当日净值已公布，直接取最新一条会把今天当昨天。
  const prevPoint = resolvePrevNavPoint(navPoints, today);
  const prevNav = prevPoint?.unit_nav ?? (settledToday ? null : (official?.nav ?? null));
  // 手动录入值是「某一天收盘口径」的一组快照：先按官方净值推进到「今天之前最近收盘日」再叠加当日
  // 涨跌幅，因此每个交易日收盘后「上一交易日累计收益」都会自动往前推进（R6）。
  const recordedCaliber = normalizeFundProfitCaliber(position.profit_caliber);
  const anchor = resolveManualAnchorOf(position, navPoints);
  const roll =
    anchor === null
      ? null
      : rollManualSnapshot(
          { amount: position.amount, profit: position.profit, anchor },
          navPoints,
          prevPoint?.nav_date ?? null,
        );
  const math = computeFundPositionMath({
    marketValue: roll?.amount ?? position.amount,
    totalProfit: roll?.profit ?? position.profit,
    changePct,
    profitCaliber: resolveManualDisplayCaliber({
      recorded: recordedCaliber,
      anchor,
      today,
      changePct,
    }),
  });

  return {
    position,
    market_value: math.marketValue,
    prev_market_value: math.prevMarketValue,
    cost_amount: math.costAmount,
    total_profit: math.totalProfit,
    profit_caliber: recordedCaliber,
    display_caliber: math.profitCaliber,
    dca: null,
    total_profit_pct: math.totalProfitPct,

    day_profit: math.dayProfit,
    prev_total_profit: math.prevTotalProfit,
    change_pct: changePct,
    // 只有估算/实时口径才展示实时估值；回退官方净值时保持空值，避免误读。
    estimated_nav:
      effectivePricing && effectivePricing.mode !== "nav" ? round2(effectivePricing.nav) : null,
    prev_nav: prevNav === null ? null : round2(prevNav),
    weight_pct: null,
    nav_date: settledToday ? settledToday.nav_date : (official?.navDate ?? null),
    // 仍锚定在盘中估算上（含当日录入且官方净值未公布）：界面标注「待结算」。
    settlement_pending: roll !== null && roll.source === "estimate",
    nav_mode: effectivePricing?.mode ?? "unavailable",
    quote_available: changePct !== null,
    source: effectivePricing?.source ?? official?.source ?? null,
    fetched_at: effectivePricing?.fetchedAt ?? official?.fetchedAt ?? null,
  };
}

/**
 * 把用户输入的实际持有金额与累计收益折算成校准基线。
 * 锚点优先「今天的官方净值」（官方口径，无需结算）；其次「今天的估算 / 实时价」
 * （标记 anchor = estimate，官方净值公布后自动重锚）；两者都取不到时退回最近公布的官方净值，
 * 周末与节假日录入即为此情形。完全取不到净值时返回 null 由调用方拒绝。
 */
export async function resolveCalibration(
  code: string,
  input: { amount: number; profit: number },
): Promise<FundPositionCalibration | null> {
  const today = beijingDateKey(new Date());
  const [intraday, navPoints] = await Promise.all([
    getFundIntraday(code).catch((): FundIntraday | null => null),
    getFundNav(code, "1m", "unit").catch((): FundNavPoint[] => []),
  ]);
  const usableIntraday = intraday && isUsableSource(intraday.source) ? intraday : null;
  const official = resolveOfficialNav(navPoints, usableIntraday);

  const settledToday = resolveOfficialNavOn(navPoints, usableIntraday, today);
  if (settledToday) {
    return buildCalibration({
      amount: input.amount,
      profit: input.profit,
      nav: settledToday.nav,
      navDate: today,
      anchor: "official",
    });
  }

  // R2：跨日的估算 / 实时值不参与基线折算，避免把陈旧的估值写进持久化基线。
  const live = resolveLiveQuote(usableIntraday, today);
  if (live) {
    return buildCalibration({
      amount: input.amount,
      profit: input.profit,
      nav: live.nav,
      navDate: today,
      anchor: "estimate",
    });
  }

  if (official) {
    return buildCalibration({
      amount: input.amount,
      profit: input.profit,
      nav: official.nav,
      navDate: official.navDate ?? today,
      anchor: "official",
    });
  }

  return null;
}

/**
 * 当前生效的手动锚点：已存锚点直接返回；历史数据按录入时间推断（需要拉一次净值）。
 * 修改接口在「快照未变」时用它把推断结果固化，避免 updated_at 变化后按新日期重新推断。
 */
export async function resolveEffectiveManualAnchor(
  position: FundPosition,
): Promise<FundPositionManualAnchor | null> {
  if (position.manual_anchor) {
    return position.manual_anchor;
  }
  const today = beijingDateKey(new Date());
  const navPoints = await getFundNav(
    position.code,
    resolveSettlementRange(resolveManualAnchorSeedDate(position), today),
    "unit",
  ).catch((): FundNavPoint[] => []);
  return resolveManualAnchorOf(position, navPoints);
}

/**
 * 合并录入前的既有层级：把既有手动录入值推进到「更靠后的锚点」层级，并返回该锚点。
 * 新增值与既有记录必须落在同一口径层级上，叠加后才有明确含义（一个代码只保留一条记录）。
 */
export async function resolveManualMergeBase(
  existing: FundPosition,
  fresh: FundPositionManualAnchor | null,
): Promise<{ amount: number; profit: number; anchor: FundPositionManualAnchor | null }> {
  const today = beijingDateKey(new Date());
  const navPoints = await getFundNav(
    existing.code,
    resolveSettlementRange(resolveManualAnchorSeedDate(existing), today),
    "unit",
  ).catch((): FundNavPoint[] => []);
  const anchor = resolveManualAnchorOf(existing, navPoints);
  const target = pickLaterManualAnchor(anchor, fresh);
  if (anchor === null || target === null) {
    return { amount: existing.amount, profit: existing.profit, anchor: target };
  }
  const roll = rollManualSnapshot(
    { amount: existing.amount, profit: existing.profit, anchor },
    navPoints,
    target.nav_date,
  );
  return { amount: roll.amount, profit: roll.profit, anchor: target };
}

/**
 * 手动持仓的净值锚点：把「这一组录入值」钉在录入当天的口径层级上（规则见 resolveManualAnchorSnapshot）。
 * 取不到任何净值时返回 null，此时记录按录入口径原样展示，不做跨日推进。
 */
export async function resolveManualAnchor(
  code: string,
  caliber: FundProfitCaliber,
  today: string = beijingDateKey(new Date()),
): Promise<FundPositionManualAnchor | null> {
  const [intraday, navPoints] = await Promise.all([
    getFundIntraday(code).catch((): FundIntraday | null => null),
    getFundNav(code, "1m", "unit").catch((): FundNavPoint[] => []),
  ]);
  const usableIntraday = intraday && isUsableSource(intraday.source) ? intraday : null;
  return resolveManualAnchorSnapshot({
    caliber,
    recorded: today,
    settled: resolveOfficialNavOn(navPoints, usableIntraday, today),
    live: resolveLiveQuote(usableIntraday, today),
    points: navPoints,
  });
}

export async function valueFundPositions(
  positions: FundPosition[],
): Promise<FundPositionValuation[]> {
  const today = beijingDateKey(new Date());
  const valued = await Promise.all(
    positions.map(async (position) => {
      // 定投计划需要覆盖「起点（校准日或启用日）→ 今天」的净值；手动持仓按锚点日取区间，
      // 保证锚定日的历史净值落在序列里（录入满一个月以上的老记录同样能正确推进）。
      const from = position.plan
        ? (position.calibration?.nav_date ?? position.plan.start_date)
        : resolveManualAnchorSeedDate(position);
      const range: FundNavRange =
        from && from < today ? resolvePlanNavRange(from, today) : "1m";
      const [intraday, navPoints] = await Promise.all([
        getFundIntraday(position.code).catch((): FundIntraday | null => null),
        getFundNav(position.code, range, "unit").catch((): FundNavPoint[] => []),
      ]);
      const usableIntraday = intraday && isUsableSource(intraday.source) ? intraday : null;
      const official = resolveOfficialNav(navPoints, usableIntraday);
      return valueFundPosition(
        position,
        resolvePricingSource(usableIntraday, official, today),
        official,
        navPoints,
        today,
      );
    }),
  );


  const weights = computeWeights(valued.map((item) => item.market_value));
  return valued.map((item, index) => ({ ...item, weight_pct: weights[index] ?? null }));
}

/** 净值结算结果：供定时任务写日志与排查。 */
export interface FundSettlementResult {
  /** 本次检查的持仓数量。 */
  checked: number;
  /** 本次重锚为官方口径的基金代码。 */
  resettled: string[];
  /** 官方净值仍未公布、保持估算口径的基金代码。 */
  pending: string[];
}

/** 强制刷新某只基金的官方净值；失败只记日志并返回空序列（单只失败不影响其它基金）。 */
async function loadSettlementNav(code: string, range: FundNavRange): Promise<FundNavPoint[]> {
  return getFundNav(code, range, "unit", true).catch((error: unknown): FundNavPoint[] => {
    console.error(`净值结算取数失败：${code}`, error);
    return [];
  });
}

/** 从指定日期起取净值区间；日期非法或就是今天时退回最近一个月。 */
function resolveSettlementRange(from: string | null, today: string): FundNavRange {
  return from && from < today ? resolvePlanNavRange(from, today) : "1m";
}

/**
 * 净值结算（定时任务用，R5 / R6 落库分支）：强制刷新持有基金的官方净值，并把
 * - 手动持仓：按官方净值把手动录入值推进到「已公布的最新收盘口径」，含当日录入的估算锚点重锚为官方口径；
 * - 定投计划：把仍锚定在估算值上的校准基线按官方净值重锚；
 * 后写回。单只失败只跳过该只，不影响其它基金；官方净值仍未公布时保持估算并计入 pending。
 * @param repository 落库入口，缺省用全局仓储；测试可注入替身。
 */
export async function settleFundPositions(
  positions: FundPosition[],
  repository: Pick<FundPositionRepository, "update"> = fundPositionRepository,
): Promise<FundSettlementResult> {
  const today = beijingDateKey(new Date());
  const resettled: string[] = [];
  const pending: string[] = [];

  for (const position of positions) {
    try {
      if (!position.plan) {
        // 手动持仓：把手动录入值推进到最新收盘口径（跨日结算，见 R6）。
        const navPoints = await loadSettlementNav(
          position.code,
          resolveSettlementRange(resolveManualAnchorSeedDate(position), today),
        );
        const anchor = resolveManualAnchorOf(position, navPoints);
        if (anchor === null) {
          continue;
        }
        const roll = rollManualSnapshot(
          { amount: position.amount, profit: position.profit, anchor },
          navPoints,
          resolveSettleTarget(navPoints, today),
        );
        if (roll.source === "estimate") {
          // 官方净值还没公布：保持估算口径并标记待结算，不用估算冒充官方。
          pending.push(position.code);
          continue;
        }
        if (!roll.rolled) {
          continue;
        }
        await repository.update(position.id, {
          amount: roll.amount,
          profit: roll.profit,
          manual_anchor: { nav_date: roll.nav_date, nav: roll.nav, source: roll.source },
        });
        resettled.push(position.code);
        continue;
      }

      const calibration = position.calibration;
      if (!calibration || calibration.anchor !== "estimate") {
        continue;
      }
      // 锚定日可能早于今天：按跨度选区间，避免取不到锚定日的官方净值。
      const navPoints = await loadSettlementNav(
        position.code,
        resolveSettlementRange(calibration.nav_date, today),
      );
      const settlement = settleCalibration(calibration, navPoints, today);
      if (!settlement) {
        continue;
      }
      if (settlement.pending) {
        pending.push(position.code);
        continue;
      }
      await repository.update(position.id, { calibration: settlement.calibration });
      resettled.push(position.code);
    } catch (error) {
      console.error(`净值结算失败：${position.code}`, error);
    }
  }

  return { checked: positions.length, resettled, pending };
}
/** 组装接口返回的持仓快照。 */
export function buildFundPositionSnapshot(
  valuations: FundPositionValuation[],
  generatedAt: string = new Date().toISOString(),
): FundPositionSnapshot {
  const totals = sumValuations(
    valuations.map((item) => ({
      market_value: item.market_value,
      cost_amount: item.cost_amount,
      total_profit: item.total_profit,
      day_profit: item.day_profit,
    })),
  );

  const summary: FundPositionSummary = {
    ...totals,
    holdings_count: valuations.length,
    generated_at: generatedAt,
  };

  return { summary, holdings: valuations, source_note: DEFAULT_SOURCE_NOTE };
}

/** 持仓更新入参（仓储层）。 */
export interface FundPositionPatch {
  amount?: number;
  profit?: number;
  profit_caliber?: FundProfitCaliber;
  /** 传 null 表示关闭定投计划。 */
  plan?: FundDcaPlan | null;
  /** 传 null 表示清除校准基线。 */
  calibration?: FundPositionCalibration | null;
  /** 手动持仓净值锚点；传 null 表示清除（读取时按录入时间推断）。 */
  manual_anchor?: FundPositionManualAnchor | null;
  note?: string | null;
}

/** 基金持仓仓储接口。 */

export interface FundPositionRepository {
  list(): Promise<FundPosition[]>;
  getById(id: string): Promise<FundPosition | null>;
  getByCode(code: string): Promise<FundPosition | null>;
  add(position: FundPosition): Promise<void>;
  update(id: string, patch: FundPositionPatch): Promise<void>;


  remove(id: string): Promise<void>;
}

/** 将数据库行转换为共享模型（numeric 列以字符串返回，需要显式转数字）。 */
function mapRow(row: typeof schema.fundPositions.$inferSelect): FundPosition {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    amount: Number(row.amount),
    profit: Number(row.profit),
    profit_caliber: normalizeFundProfitCaliber(row.profitCaliber),
    plan: normalizeStoredPlan(
      isPlanFrequency(row.dcaFrequency) && row.dcaAmount !== null && row.dcaStartDate
        ? {
            frequency: row.dcaFrequency,
            weekday: row.dcaWeekday ?? null,
            amount: Number(row.dcaAmount),
            start_date: row.dcaStartDate,
          }
        : null,
    ),
    calibration: normalizeStoredCalibration(
      row.calibNavDate && row.calibShares !== null && row.calibCost !== null
        ? {
            nav_date: row.calibNavDate,
            nav: row.calibNav === null ? null : Number(row.calibNav),
            shares: Number(row.calibShares),
            cost: Number(row.calibCost),
            anchor: row.calibAnchor === "estimate" ? "estimate" : "official",
          }
        : null,
    ),
    manual_anchor: normalizeStoredManualAnchor(
      row.manualAnchorDate
        ? {
            nav_date: row.manualAnchorDate,
            nav: row.manualAnchorNav === null ? null : Number(row.manualAnchorNav),
            source: row.manualAnchorSource,
          }
        : null,
    ),
    note: row.note,

    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

/** 深拷贝，避免外部修改污染内存数据。 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 判断 JSON 文件中的条目是否结构可用。 */
function isFundPosition(value: unknown): value is FundPosition {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<FundPosition>;
  return (
    typeof item.id === "string" &&
    typeof item.code === "string" &&
    typeof item.name === "string"
  );
}

/** 从本地 JSON 文件读取持仓；文件不存在或损坏时返回空列表。 */
async function loadPositionFile(): Promise<FundPosition[]> {
  try {
    const content = await readFile(POSITION_FILE, "utf8");
    const parsed = JSON.parse(content) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isFundPosition).map((item) => ({
      ...item,
      profit_caliber: normalizeFundProfitCaliber(item.profit_caliber),
      plan: normalizeStoredPlan(item.plan),
      calibration: normalizeStoredCalibration(item.calibration),
      manual_anchor: normalizeStoredManualAnchor(item.manual_anchor),
    }));

  } catch {
    return [];
  }
}

/** 将持仓列表写入本地 JSON 文件。 */
async function savePositionFile(items: FundPosition[]): Promise<void> {
  await mkdir(path.dirname(POSITION_FILE), { recursive: true });
  await writeFile(POSITION_FILE, JSON.stringify(items, null, 2), "utf8");
}

/** 文件持久化持仓仓储。 */
function createFileFundPositionRepository(): FundPositionRepository {
  const items = new Map<string, FundPosition>();
  let loaded = false;

  const ensureLoaded = async () => {
    if (loaded) {
      return;
    }
    for (const item of await loadPositionFile()) {
      items.set(item.id, clone(item));
    }
    loaded = true;
  };

  const persist = async () => {
    const rows = Array.from(items.values())
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((item) => clone(item));
    await savePositionFile(rows);
  };

  return {
    async list() {
      await ensureLoaded();
      return Array.from(items.values())
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((item) => clone(item));
    },
    async getById(id) {
      await ensureLoaded();
      const item = items.get(id);
      return item ? clone(item) : null;
    },
    async getByCode(code) {
      await ensureLoaded();
      const item = Array.from(items.values()).find((row) => row.code === code);
      return item ? clone(item) : null;
    },
    async add(position) {
      await ensureLoaded();
      items.set(position.id, clone(position));
      await persist();
    },
    async update(id, patch) {
      await ensureLoaded();
      const item = items.get(id);
      if (!item) {
        return;
      }
      items.set(id, { ...item, ...patch, updated_at: new Date().toISOString() });
      await persist();
    },
    async remove(id) {
      await ensureLoaded();
      items.delete(id);
      await persist();
    },
  };
}

/** PostgreSQL 持仓仓储。 */
function createDrizzleFundPositionRepository(): FundPositionRepository {
  const db = getDb();

  return {
    async list() {
      const rows = await db
        .select()
        .from(schema.fundPositions)
        .orderBy(asc(schema.fundPositions.createdAt));
      return rows.map(mapRow);
    },
    async getById(id) {
      const rows = await db
        .select()
        .from(schema.fundPositions)
        .where(eq(schema.fundPositions.id, id))
        .limit(1);
      const row = rows[0];
      return row ? mapRow(row) : null;
    },
    async getByCode(code) {
      const rows = await db
        .select()
        .from(schema.fundPositions)
        .where(eq(schema.fundPositions.code, code))
        .limit(1);
      const row = rows[0];
      return row ? mapRow(row) : null;
    },
    async add(position) {
      await db.insert(schema.fundPositions).values({
        id: position.id,
        code: position.code,
        name: position.name,
        amount: position.amount.toFixed(2),
        profit: position.profit.toFixed(2),
        profitCaliber: position.profit_caliber,
        dcaFrequency: position.plan?.frequency ?? null,
        dcaWeekday: position.plan?.weekday ?? null,
        dcaAmount: position.plan ? position.plan.amount.toFixed(2) : null,
        dcaStartDate: position.plan?.start_date ?? null,
        calibNavDate: position.calibration?.nav_date ?? null,
        calibShares: position.calibration ? position.calibration.shares.toFixed(4) : null,
        calibCost: position.calibration ? position.calibration.cost.toFixed(2) : null,
        calibNav:
          position.calibration && position.calibration.nav !== null
            ? position.calibration.nav.toFixed(4)
            : null,
        calibAnchor: position.calibration ? position.calibration.anchor : null,
        manualAnchorDate: position.manual_anchor?.nav_date ?? null,
        manualAnchorNav:
          position.manual_anchor && position.manual_anchor.nav !== null
            ? position.manual_anchor.nav.toFixed(4)
            : null,
        manualAnchorSource: position.manual_anchor?.source ?? null,
        note: position.note,

        createdAt: new Date(position.created_at),
        updatedAt: new Date(position.updated_at),
      });
    },
    async update(id, patch) {
      const values: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.amount !== undefined) {
        values.amount = patch.amount.toFixed(2);
      }
      if (patch.profit !== undefined) {
        values.profit = patch.profit.toFixed(2);
      }
      if (patch.profit_caliber !== undefined) {
        values.profitCaliber = patch.profit_caliber;
      }
      if (patch.plan !== undefined) {
        values.dcaFrequency = patch.plan?.frequency ?? null;
        values.dcaWeekday = patch.plan?.weekday ?? null;
        values.dcaAmount = patch.plan ? patch.plan.amount.toFixed(2) : null;
        values.dcaStartDate = patch.plan?.start_date ?? null;
      }
      if (patch.calibration !== undefined) {
        values.calibNavDate = patch.calibration?.nav_date ?? null;
        values.calibNav =
          patch.calibration && patch.calibration.nav !== null
            ? patch.calibration.nav.toFixed(4)
            : null;
        values.calibShares = patch.calibration ? patch.calibration.shares.toFixed(4) : null;
        values.calibCost = patch.calibration ? patch.calibration.cost.toFixed(2) : null;
        values.calibAnchor = patch.calibration ? patch.calibration.anchor : null;
      }
      if (patch.manual_anchor !== undefined) {
        values.manualAnchorDate = patch.manual_anchor?.nav_date ?? null;
        values.manualAnchorNav =
          patch.manual_anchor && patch.manual_anchor.nav !== null
            ? patch.manual_anchor.nav.toFixed(4)
            : null;
        values.manualAnchorSource = patch.manual_anchor?.source ?? null;
      }
      if (patch.note !== undefined) {

        values.note = patch.note;
      }
      await db.update(schema.fundPositions).set(values).where(eq(schema.fundPositions.id, id));
    },
    async remove(id) {
      await db.delete(schema.fundPositions).where(eq(schema.fundPositions.id, id));
    },
  };
}

/** 带故障回退的持仓仓储：数据库不可用时自动切换本地文件实现。 */
function createResilientFundPositionRepository(): FundPositionRepository {
  const fallback = createFileFundPositionRepository();
  let drizzleRepository: FundPositionRepository | null = null;
  let useFallback = false;

  const run = async <T>(method: keyof FundPositionRepository, args: unknown[]): Promise<T> => {
    if (useFallback) {
      return (fallback[method] as (...methodArgs: unknown[]) => Promise<T>)(...args);
    }
    try {
      drizzleRepository ??= createDrizzleFundPositionRepository();
      return await (drizzleRepository[method] as (...methodArgs: unknown[]) => Promise<T>)(...args);
    } catch (error) {
      useFallback = true;
      console.warn("[fund-position] PostgreSQL 访问失败，本次运行已切换为本地文件存储：", error);
      return (fallback[method] as (...methodArgs: unknown[]) => Promise<T>)(...args);
    }
  };

  return {
    list: () => run("list", []),
    getById: (id) => run("getById", [id]),
    getByCode: (code) => run("getByCode", [code]),
    add: (position) => run("add", [position]),
    update: (id, patch) => run("update", [id, patch]),
    remove: (id) => run("remove", [id]),
  };
}

/** 默认持仓仓储单例，供 API 路由统一使用。 */
export const fundPositionRepository: FundPositionRepository = createResilientFundPositionRepository();