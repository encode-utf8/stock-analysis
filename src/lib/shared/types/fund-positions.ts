// 基金持有面板共享契约：手动录入「当前持有金额 + 当前累计收益 + 累计收益口径」，当日收益由盘中涨跌幅推导。
// 口径说明见 docs/fund-position-caliber-plan.md：持有金额与累计收益是「同一口径的一对」。
//   推算本金   cost_amount = 录入持有金额 − 录入累计收益（两种口径等价，且不依赖行情）
//   含当日     当前市值 = 录入值；上一交易日市值 = 录入值 / (1 + 当日涨跌幅 / 100)
//   不含当日   上一交易日市值 = 录入值；当前市值 = 录入值 × (1 + 当日涨跌幅 / 100)
//   当日收益   day_profit = 当前市值 − 上一交易日市值
//   累计收益   total_profit = 市值 − 推算本金
//   持仓占比   weight_pct  = 当前市值 / Σ当前市值 × 100
// 恒等式（两种口径均成立）：prev_total_profit + day_profit = total_profit

/**
 * 累计收益口径：用户录入的累计收益（以及配对的持有金额）是否已包含当日实时收益。
 * - include_today：录入值已含当日收益（与历史数据语义一致，缺省值）
 * - exclude_today：录入值为截至上一交易日收盘的口径
 */
export type FundProfitCaliber = "include_today" | "exclude_today";

/** 一条基金持仓记录（用户手动录入）。 */
export interface FundPosition {
  id: string;
  code: string;
  name: string;
  /** 当前持有金额（市值），单位元，必须大于 0；含义由 profit_caliber 决定。 */
  amount: number;
  /** 当前累计收益，单位元，可为负；含义由 profit_caliber 决定。 */
  profit: number;
  /** 累计收益口径：录入值是否已含当日收益。 */
  profit_caliber: FundProfitCaliber;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** 新增持仓入参：只录入代码、当前持有金额、当前累计收益与累计收益口径。 */
export interface FundPositionInput {
  code: string;
  amount: number | string;
  profit?: number | string | null;
  /** 缺省按 include_today（含当日收益）处理。 */
  profit_caliber?: FundProfitCaliber | string | null;
  note?: string | null;
}

/** 更新入参：只允许调整持有金额、累计收益、累计收益口径与备注，不允许改代码。 */
export interface FundPositionUpdateInput {
  amount?: number | string;
  profit?: number | string | null;
  profit_caliber?: FundProfitCaliber | string | null;
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
  /** 本次展示采用的累计收益口径（即录入口径）。 */
  profit_caliber: FundProfitCaliber;
  /** 累计收益率 = 累计收益 / 推算本金；本金非正或累计收益不可用时为 null。 */
  total_profit_pct: number | null;
  /** 当日实时收益；取不到涨跌幅时为 null。 */
  day_profit: number | null;
  /** 上一交易日累计收益；含当日口径且取不到涨跌幅时为 null。 */
  prev_total_profit: number | null;
  /** 当日实时涨跌幅（百分比）；取不到时为 null。 */
  change_pct: number | null;
  /** 上一个交易日收盘净值（官方最新公布单位净值）；取不到时为 null。 */
  prev_nav: number | null;
  /** 实时估计净值（场外估算净值；场内为实时价）；取不到时为 null。 */
  estimated_nav: number | null;
  /** 持仓在总当前市值中的占比（百分比）；任一只当前市值不可用时整列为 null。 */
  weight_pct: number | null;
  nav_mode: FundPositionNavMode;
  /** 当日口径是否可用（可取到盘中涨跌幅）；不影响录入口径的展示。 */
  quote_available: boolean;
  source: string | null;
  fetched_at: string | null;
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
