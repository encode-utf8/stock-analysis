// 基金持有面板共享契约：手动录入「当前持有金额 + 当前累计收益 + 累计收益口径」，当日收益由盘中涨跌幅推导。
// 口径说明见 docs/fund-position-caliber-plan.md：持有金额与累计收益是「同一口径的一对」。
//   推算本金   cost_amount = 录入持有金额 − 录入累计收益（两种口径等价，且不依赖行情）
//   含当日     当前市值 = 录入值；上一交易日市值 = 录入值 / (1 + 当日涨跌幅 / 100)
//   不含当日   上一交易日市值 = 录入值；当前市值 = 录入值 × (1 + 当日涨跌幅 / 100)
//   当日收益   day_profit = 当前市值 − 上一交易日市值
//   累计收益   total_profit = 市值 − 推算本金
//   持仓占比   weight_pct  = 当前市值 / Σ当前市值 × 100
// 恒等式（两种口径均成立）：prev_total_profit + day_profit = total_profit
//
// 定投计划（plan 非空时）：持有金额与累计收益不再手动录入，而由「计划 + 历史净值」派生：
//   期数/累计投入/份额 由 computePlanLedger 重算（纯函数，重启后结果与一直在线一致）
//   上一交易日市值 = 份额 × 上一交易日官方净值；当前市值 = 份额 × 实时估值净值
//   累计收益 = 当前市值 − 累计投入
// 计划只统计启用日之后的期次，不回溯历史、不建模底仓；校准可把实际值折算成份额基线后继续累加。


/**
 * 累计收益口径：用户录入的累计收益（以及配对的持有金额）是否已包含当日实时收益。
 * - include_today：录入值已含当日收益（与历史数据语义一致，缺省值）
 * - exclude_today：录入值为截至上一交易日收盘的口径
 */
export type FundProfitCaliber = "include_today" | "exclude_today";

/** 定投频率：每日 / 每周（指定星期几）/ 每两周 / 每月。 */
export type FundPlanFrequency = "daily" | "weekly" | "biweekly" | "monthly";

/** 每周定投的星期几（仅周一至周五，与场外基金申购时段一致）。 */
export type FundPlanWeekday = 1 | 2 | 3 | 4 | 5;

/** 定投计划：启用后持有金额与累计收益由计划派生。 */
export interface FundDcaPlan {
  frequency: FundPlanFrequency;
  /** 每周定投的星期几；非 weekly 计划为 null。 */
  weekday: FundPlanWeekday | null;
  /** 每期投入金额（元），必须大于 0。 */
  amount: number;
  /** 计划启用日（首期目标日），YYYY-MM-DD。 */
  start_date: string;
}

/** 定投计划入参（新增/更新共用）。 */
export interface FundDcaPlanInput {
  frequency: FundPlanFrequency | string;
  weekday?: number | string | null;
  amount: number | string;
  /** 缺省为今天（即「现在开始定投」）。 */
  start_date?: string | null;
}

/** 校准基线的锚点来源：official = 锚定日的官方净值；estimate = 估算 / 实时价锚定，待官方净值公布后重锚。 */
export type FundPositionCalibrationAnchor = "official" | "estimate";

/** 手动校准基线：把某净值日的实际值折算成份额与本金，之后继续按期累加。 */
export interface FundPositionCalibration {
  /** 校准采用的净值日。 */
  nav_date: string;
  /** 锚定净值（估算锚定时为盘中估算 / 实时价，官方锚定时为官方单位净值）；历史数据缺失时为 null。 */
  nav: number | null;
  /** 校准份额 = 校准持有金额 / 锚定净值。 */
  shares: number;
  /** 校准本金 = 校准持有金额 − 校准累计收益。 */
  cost: number;
  /** 锚点来源；历史数据缺省视为 official（不重锚）。 */
  anchor: FundPositionCalibrationAnchor;
}

/**
 * 手动持仓的净值锚点：把「这一组持有金额与累计收益」钉在具体净值日上，
 * 结算时才能按官方净值把它推进到最新结算日（不含当日 = 锚在上一交易日；含当日 = 锚在记录当天）。
 */
export interface FundPositionManualAnchor {
  /** 记录值对应的净值日。 */
  nav_date: string;
  /** 锚定净值：官方锚定为官方单位净值，估算锚定为盘中估算 / 实时价；未知时为 null（只能向前滚，无法重锚）。 */
  nav: number | null;
  /** official = 锚定日官方净值；estimate = 估算 / 实时价锚定，待官方净值公布后重锚。 */
  source: FundPositionCalibrationAnchor;
}

/** 手动校准入参：持有金额与累计收益是配对的一对（含当日口径）。 */
export interface FundPositionCalibrationInput {
  amount: number | string;
  profit?: number | string | null;
}

/** 一条基金持仓记录（用户手动录入或由定投计划派生）。 */

export interface FundPosition {
  id: string;
  code: string;
  name: string;
  /** 当前持有金额（市值），单位元，必须大于 0；含义由 profit_caliber 决定。 */
  amount: number;
  /** 当前累计收益，单位元，可为负；含义由 profit_caliber 决定。 */
  profit: number;
  /** 累计收益口径：录入值是否已含当日收益。定投计划持仓由计划派生，该字段不参与计算。 */
  profit_caliber: FundProfitCaliber;
  /** 定投计划；null 表示未启用（此时 amount/profit 为手动录入值）。 */
  plan: FundDcaPlan | null;
  /** 手动校准基线；null 表示未校准。 */
  calibration: FundPositionCalibration | null;
  /** 手动持仓的净值锚点：记录值对应的净值日与锚定来源；null 表示按录入时间推断（历史数据）。 */
  manual_anchor?: FundPositionManualAnchor | null;
  note: string | null;

  created_at: string;
  updated_at: string;
}

/** 新增持仓入参：只录入代码、当前持有金额、当前累计收益与累计收益口径。 */
export interface FundPositionInput {
  code: string;
  /** 未启用定投计划时必填；启用计划时忽略（由计划派生）。 */
  amount?: number | string;
  profit?: number | string | null;
  /** 缺省按 include_today（含当日收益）处理。 */
  profit_caliber?: FundProfitCaliber | string | null;
  /** 定投计划：传对象表示启用或更新（同一代码只会保留这一个计划），缺省表示不启用。 */
  plan?: FundDcaPlanInput | null;
  note?: string | null;
}


/** 更新入参：只允许调整持有金额、累计收益、累计收益口径与备注，不允许改代码。 */
export interface FundPositionUpdateInput {
  amount?: number | string;
  profit?: number | string | null;
  profit_caliber?: FundProfitCaliber | string | null;
  /** 只接受 null（取消定投，此时必须同时给出 amount 与 profit 以固化为手动持仓）；启用或调整计划请走新增接口按代码合并。 */
  plan?: FundDcaPlanInput | null;
  /** 传对象表示按实际值校准，传 null 表示清除校准、回到纯计划派生。 */
  calibration?: FundPositionCalibrationInput | null;
  note?: string | null;
}


/** 净值口径：场外估算 / 场内实时 / 官方净值回退 / 不可用。 */
export type FundPositionNavMode = "estimate" | "realtime" | "nav" | "unavailable";

/** 单只基金的持仓估值结果。 */
export interface FundPositionValuation {
  position: FundPosition;
  /** 按口径折算后的当前市值（含当日盈亏）；不含当日口径且行情不可用时为 null。 */
  market_value: number | null;
  /** 上一交易日市值；含当日口径且行情不可用时为 null。 */
  prev_market_value: number | null;
  /** 推算本金 = 录入持有金额 − 录入累计收益；只依赖录入值，恒可计算。 */
  cost_amount: number;
  /** 当前累计收益（含当日收益）；不含当日口径且当日行情不可用时为 null。 */
  total_profit: number | null;
  /** 本次展示采用的累计收益口径（即录入口径，供修改表单回显）；定投计划持仓恒为 include_today。 */
  profit_caliber: FundProfitCaliber;
  /**
   * 本次展示实际使用的口径：手动录入值锚在「今天之前」的收盘口径上时为 exclude_today
   * （当前市值 = 记录值 ×（1 + 当日涨跌幅）），锚在今天的当前值上时为 include_today；
   * 取不到当日涨跌幅时回落到录入口径。定投计划持仓恒为 include_today。
   */
  display_caliber: FundProfitCaliber;
  /** 定投计划派生信息；未启用计划时为 null。 */
  dca: FundPositionDcaValue | null;

  /** 累计收益率 = 累计收益 / 推算本金；本金非正或累计收益不可用时为 null。 */
  total_profit_pct: number | null;
  /** 当日实时收益；取不到涨跌幅时为 null。 */
  day_profit: number | null;
  /** 上一交易日累计收益；含当日口径且取不到涨跌幅时为 null。 */
  prev_total_profit: number | null;
  /** 当日实时涨跌幅（百分比）；取不到时为 null。 */
  change_pct: number | null;
  /** 上一个交易日收盘净值：严格早于今天的最近一个净值日（当日净值若已公布，它属于「今天」而非昨收）；取不到时为 null。 */
  prev_nav: number | null;
  /** 实时估计净值（场外估算净值；场内为实时价）；取不到时为 null。 */
  estimated_nav: number | null;
  /** 持仓在总当前市值中的占比（百分比）；任一只当前市值不可用时整列为 null。 */
  weight_pct: number | null;
  /** 本次展示采用的官方净值日：当天官方净值已公布则为今天，否则为最近公布的净值日；取不到为 null。 */
  nav_date: string | null;
  /** 校准基线仍锚定在估算值上、官方净值尚未取到：界面标注「待结算」。 */
  settlement_pending: boolean;
  nav_mode: FundPositionNavMode;
  /** 当日口径是否可用（可取到盘中涨跌幅）；不影响录入口径的展示。 */
  quote_available: boolean;
  source: string | null;
  fetched_at: string | null;
}

/** 定投计划的派生信息（期数、累计投入与份额）。 */
export interface FundPositionDcaValue {
  frequency: FundPlanFrequency;
  /** 每周定投的星期几；非每周计划为 null。 */
  weekday: FundPlanWeekday | null;
  /** 每期投入金额。 */
  amount: number;
  /** 计划启用日。 */
  start_date: string;
  /** 已计入的期数（不含校准基线已涵盖的期次）。 */
  periods: number;
  /** 累计投入（本金）= 校准基线本金 + 期数 × 每期金额。 */
  invested: number;
  /** 持仓份额。 */
  shares: number;
  /** 最近一期实际扣款日；尚无期次时为 null。 */
  last_period_date: string | null;
  /** 是否手动校准过。 */
  calibrated: boolean;
}

/** 组合汇总。 */

export interface FundPositionSummary {
  /** 总当前市值；任一只当前市值不可用时为 null（不做部分求和）。 */
  total_market_value: number | null;
  /** 推算总本金 = Σ(录入持有金额 − 录入累计收益)；只依赖录入值，恒可计算。 */
  total_cost: number;
  /** 总累计收益（含当日）；任一只不可用时为 null（不做部分求和）。 */
  total_profit: number | null;
  /** 总累计收益率 = 总累计收益 / 推算总本金。 */
  total_profit_pct: number | null;
  /** 当日收益合计；任一只不可用时按可计算部分求和，全不可用为 null。 */
  total_day_profit: number | null;
  holdings_count: number;
  generated_at: string;
}

/** 接口返回结构。 */
export interface FundPositionSnapshot {
  summary: FundPositionSummary;
  holdings: FundPositionValuation[];
  /** 估值来源与准点说明，供界面直接展示。 */
  source_note: string;
}
