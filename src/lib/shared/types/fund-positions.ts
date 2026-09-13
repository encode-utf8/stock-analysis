// 基金持有面板共享契约：手动录入「当前持有金额 + 当前累计收益」，当日收益由盘中涨跌幅推导。
// 口径说明见 docs/fund-positions-plan.md §3：
//   推算本金   cost_amount = 持有金额 − 累计收益
//   当日收益   day_profit  = 持有金额 − 持有金额 / (1 + 当日涨跌幅 / 100)
//   上一交易日累计收益 = 累计收益 − 当日收益（恒等式，无需额外状态）
//   持仓占比   weight_pct  = 持有金额 / Σ持有金额 × 100

/** 一条基金持仓记录（用户手动录入）。 */
export interface FundPosition {
  id: string;
  code: string;
  name: string;
  /** 当前持有金额（市值），单位元，必须大于 0。 */
  amount: number;
  /** 当前累计收益，单位元，可为负。 */
  profit: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** 新增持仓入参：只录入代码、当前持有金额与当前累计收益。 */
export interface FundPositionInput {
  code: string;
  amount: number | string;
  profit?: number | string | null;
  note?: string | null;
}

/** 更新入参：只允许调整持有金额、累计收益与备注，不允许改代码。 */
export interface FundPositionUpdateInput {
  amount?: number | string;
  profit?: number | string | null;
  note?: string | null;
}

/** 净值口径：场外估算 / 场内实时 / 官方净值回退 / 不可用。 */
export type FundPositionNavMode = "estimate" | "realtime" | "nav" | "unavailable";

/** 单只基金的持仓估值结果。 */
export interface FundPositionValuation {
  position: FundPosition;
  /** 当前持有金额（市值），等于录入值。 */
  market_value: number;
  /** 推算本金 = 当前持有金额 − 当前累计收益。 */
  cost_amount: number;
  /** 当前累计收益（录入值）。 */
  total_profit: number;
  /** 累计收益率 = 累计收益 / 推算本金；本金非正时为 null。 */
  total_profit_pct: number | null;
  /** 当日实时收益；取不到涨跌幅时为 null。 */
  day_profit: number | null;
  /** 上一交易日累计收益 = 累计收益 − 当日实时收益；当日收益不可用时为 null。 */
  prev_total_profit: number | null;
  /** 当日实时涨跌幅（百分比）；取不到时为 null。 */
  change_pct: number | null;
  /** 上一个交易日收盘净值（官方最新公布单位净值）；取不到时为 null。 */
  prev_nav: number | null;
  /** 实时估计净值（场外估算净值；场内为实时价）；取不到时为 null。 */
  estimated_nav: number | null;
  /** 持仓在总持有金额中的占比（百分比）。 */
  weight_pct: number;
  nav_mode: FundPositionNavMode;
  /** 当日口径是否可用（可取到盘中涨跌幅）；不影响持有金额与累计收益的展示。 */
  quote_available: boolean;
  source: string | null;
  fetched_at: string | null;
}

/** 组合汇总。 */
export interface FundPositionSummary {
  /** 总持有金额（市值）。 */
  total_market_value: number;
  /** 推算总本金 = 总持有金额 − 总累计收益。 */
  total_cost: number;
  total_profit: number;
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