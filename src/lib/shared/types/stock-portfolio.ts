// 个股持仓组合共享契约：仅新增，不修改既有字段语义。
// 组合口径与基金侧（fund-portfolio）保持一致，便于两个工作台对照学习。

// 录入口径按用户确认的极简模式：只记录投入金额与当前持仓收益，
// 市值与收益率由二者推导，避免让用户维护份额与成本价两组数据。
/** 一条个股持仓记录。 */
export interface StockHolding {
  id: string;
  code: string;
  name: string;
  /** 投入金额（成本额），单位元，必须大于 0。 */
  amount: number;
  /** 当前持仓收益（浮动盈亏），单位元，可为负。 */
  profit: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** 新增持仓入参，数值允许用字符串提交，由服务端统一解析。 */
export interface StockHoldingInput {
  code: string;
  amount: number | string;
  profit?: number | string | null;
  note?: string | null;
}

/** 更新持仓入参：只允许调整金额、收益与备注，不允许改代码。 */
export interface StockHoldingUpdateInput {
  amount?: number | string;
  profit?: number | string | null;
  note?: string | null;
}

/** 持仓估值：把持仓与最新行情合成展示口径。 */
export interface StockHoldingValuation {
  holding: StockHolding;
  /** 市值 = 投入金额 + 持仓收益。 */
  market_value: number;
  /** 收益率 = 持仓收益 / 投入金额，单位为百分比。 */
  profit_pct: number | null;
  /** 当日盈亏：按最新价与当日涨跌幅从市值反推，取不到行情时为 null。 */
  day_profit: number | null;
  price: number | null;
  change_pct: number | null;
  source: string | null;
  fetched_at: string | null;
  quote_available: boolean;
}

/** 组合权重条目。 */
export interface StockPortfolioWeight {
  code: string;
  name: string;
  market_value: number;
  weight_pct: number;
}

/** 组合行业分布条目。 */
export interface StockPortfolioIndustry {
  industry: string;
  market_value: number;
  weight_pct: number;
}

/** 组合汇总，口径与基金侧 summary 对齐。 */
export interface StockPortfolioSummary {
  total_amount: number;
  total_profit: number;
  total_profit_pct: number | null;
  total_market_value: number;
  day_profit: number | null;
  holdings_count: number;
  weights: StockPortfolioWeight[];
  industry_allocation: StockPortfolioIndustry[];
  generated_at: string;
}

/** 组合接口返回结构。 */
export interface StockPortfolioSnapshot {
  summary: StockPortfolioSummary;
  holdings: StockHoldingValuation[];
  /** 行情来源与新鲜度说明，供界面直接展示。 */
  source_note: string;
}
