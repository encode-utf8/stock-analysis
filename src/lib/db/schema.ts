// Drizzle ORM 数据表定义：对应 docs/design.md 第 6 节数据模型。
// 本阶段只定义 schema 与迁移配置，不执行线上迁移。
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { AlertCondition, AlertConditionHit, AlertMetric, FundHoldingItem } from "@/lib/shared/types";

/** 股票元数据。 */
export const stocks = pgTable("stocks", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  exchange: text("exchange").notNull(),
  industry: text("industry"),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
});

/** 当前行情快照。 */
export const marketQuotes = pgTable(
  "market_quotes",
  {
    code: text("code").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    price: doublePrecision("price").notNull(),
    changePct: doublePrecision("change_pct").notNull(),
    open: doublePrecision("open").notNull(),
    high: doublePrecision("high").notNull(),
    low: doublePrecision("low").notNull(),
    prevClose: doublePrecision("prev_close").notNull(),
    volume: doublePrecision("volume").notNull(),
    amount: doublePrecision("amount").notNull(),
    turnoverRate: doublePrecision("turnover_rate"),
    pe: doublePrecision("pe"),
    pb: doublePrecision("pb"),
    marketCap: doublePrecision("market_cap"),
    floatCap: doublePrecision("float_cap"),
    source: text("source").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.code, table.ts] }),
    index("market_quotes_code_fetched_idx").on(table.code, table.fetchedAt),
  ],
);

/** K 线数据。 */
export const klines = pgTable(
  "klines",
  {
    code: text("code").notNull(),
    period: text("period").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    open: doublePrecision("open").notNull(),
    high: doublePrecision("high").notNull(),
    low: doublePrecision("low").notNull(),
    close: doublePrecision("close").notNull(),
    volume: doublePrecision("volume").notNull(),
    amount: doublePrecision("amount").notNull(),
    adjType: text("adj_type").notNull(),
    source: text("source"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.code, table.period, table.ts, table.adjType] }),
    index("klines_code_period_ts_idx").on(table.code, table.period, table.ts),
  ],
);

/** 资讯条目。 */
export const newsItems = pgTable(
  "news_items",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    url: text("url").notNull(),
    source: text("source").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    sentiment: text("sentiment").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    impactDays: integer("impact_days").notNull(),
    expireAt: timestamp("expire_at", { withTimezone: true }).notNull(),
    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    status: text("status").notNull(),
    pinned: boolean("pinned").notNull().default(false),
  },
  (table) => [
    index("news_items_code_expire_idx").on(table.code, table.expireAt),
    index("news_items_status_expire_idx").on(table.status, table.expireAt),
  ],
);

/** AI 分析报告。 */
export const analysisReports = pgTable(
  "analysis_reports",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    dataSnapshot: jsonb("data_snapshot").$type<Record<string, unknown>>(),
    newsRefs: jsonb("news_refs").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    content: text("content").notNull(),
    riskNote: text("risk_note").notNull(),
  },
  (table) => [
    index("analysis_reports_code_created_idx").on(table.code, table.createdAt),
  ],
);

/** 会话。 */
export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("conversations_code_created_idx").on(table.code, table.createdAt),
  ],
);

/** 会话消息。 */
export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    toolCalls: jsonb("tool_calls").$type<Record<string, unknown>[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("messages_conversation_created_idx").on(table.conversationId, table.createdAt),
  ],
);

/** 定时任务运行记录。 */
export const jobRuns = pgTable(
  "job_runs",
  {
    id: text("id").primaryKey(),
    jobName: text("job_name").notNull(),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
  },
  (table) => [
    index("job_runs_name_started_idx").on(table.jobName, table.startedAt),
  ],
);

/** 可观测性指标持久化：计数与最近事件时间合并存储，重启后水合。 */
export const observabilityMetrics = pgTable("observability_metrics", {
  key: text("key").primaryKey(),
  metricValue: bigint("metric_value", { mode: "number" }).notNull().default(0),
  timestampValue: timestamp("timestamp_value", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

/** 自选股列表：code 作为主键，后续 watchlist 功能分支直接使用。 */
export const watchlist = pgTable("watchlist", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  exchange: text("exchange").notNull(),
  group: text("group").notNull().default("默认"),
  sortOrder: integer("sort_order").notNull().default(0),
  note: text("note"),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull(),
});

/** 基金 AI 分析报告。 */
export const fundAnalysisReports = pgTable(
  "fund_analysis_reports",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    dataSnapshot: jsonb("data_snapshot").$type<Record<string, unknown>>(),
    sourceRefs: jsonb("source_refs")
      .$type<Array<{ label: string; value: string }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    content: text("content").notNull(),
    riskNote: text("risk_note").notNull(),
  },
  (table) => [
    index("fund_analysis_reports_code_created_idx").on(table.code, table.createdAt),
  ],
);

/** 基金会话。 */
export const fundConversations = pgTable(
  "fund_conversations",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("fund_conversations_code_created_idx").on(table.code, table.createdAt),
  ],
);

/** 基金会话消息。 */
export const fundMessages = pgTable(
  "fund_messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    toolCalls: jsonb("tool_calls").$type<Record<string, unknown>[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("fund_messages_conversation_created_idx").on(table.conversationId, table.createdAt),
  ],
);

/** 基金档案持久化。 */
export const fundProfiles = pgTable("fund_profiles", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  tradingMode: text("trading_mode").notNull(),
  manager: text("manager"),
  company: text("company"),
  benchmark: text("benchmark"),
  establishDate: text("establish_date"),
  scale: doublePrecision("scale"),
  riskLevel: text("risk_level"),
  source: text("source").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
});

/** 基金历史净值持久化。 */
export const fundNavs = pgTable(
  "fund_navs",
  {
    code: text("code").notNull(),
    navDate: timestamp("nav_date", { withTimezone: true }).notNull(),
    unitNav: doublePrecision("unit_nav").notNull(),
    cumulativeNav: doublePrecision("cumulative_nav").notNull(),
    dailyChangePct: doublePrecision("daily_change_pct"),
    source: text("source").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.code, table.navDate] }),
    index("fund_navs_code_date_idx").on(table.code, table.navDate),
  ],
);

/** 基金最新季度持仓持久化。 */
export const fundHoldings = pgTable(
  "fund_holdings",
  {
    code: text("code").notNull(),
    reportDate: text("report_date").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    topHoldings: jsonb("top_holdings").$type<FundHoldingItem[]>().notNull().default(sql`'[]'::jsonb`),
    assetAllocation: jsonb("asset_allocation")
      .$type<Record<string, number>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    industryAllocation: jsonb("industry_allocation")
      .$type<Record<string, number>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    top10WeightPct: doublePrecision("top10_weight_pct"),
    top1WeightPct: doublePrecision("top1_weight_pct"),
    source: text("source").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.code, table.reportDate] }),
    index("fund_holdings_code_date_idx").on(table.code, table.reportDate),
  ],
);

/** 基金风险指标持久化。 */
export const fundRiskMetrics = pgTable(
  "fund_risk_metrics",
  {
    code: text("code").notNull(),
    range: text("range").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    maxDrawdownPct: doublePrecision("max_drawdown_pct").notNull(),
    maxDrawdownStart: text("max_drawdown_start").notNull(),
    maxDrawdownEnd: text("max_drawdown_end").notNull(),
    currentDrawdownPct: doublePrecision("current_drawdown_pct").notNull(),
    maxDrawdownRecoveryStart: text("max_drawdown_recovery_start").notNull(),
    maxDrawdownRecoveryEnd: text("max_drawdown_recovery_end"),
    maxDrawdownRecoveryComplete: boolean("max_drawdown_recovery_complete").notNull().default(false),
    longestRecoveryDays: integer("longest_recovery_days"),
    averageRecoveryDays: integer("average_recovery_days"),
    currentRecoveryProgressPct: doublePrecision("current_recovery_progress_pct"),
    annualizedReturnPct: doublePrecision("annualized_return_pct"),
    annualizedVolatilityPct: doublePrecision("annualized_volatility_pct"),
    sharpe: doublePrecision("sharpe"),
    sortino: doublePrecision("sortino"),
    calmar: doublePrecision("calmar"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.code, table.range] }),
  ],
);

/** 基金资讯条目。 */
export const fundNewsItems = pgTable(
  "fund_news_items",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    url: text("url").notNull(),
    source: text("source").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    sentiment: text("sentiment").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    impactDays: integer("impact_days").notNull(),
    expireAt: timestamp("expire_at", { withTimezone: true }).notNull(),
    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    status: text("status").notNull(),
    pinned: boolean("pinned").notNull().default(false),
    newsType: text("news_type").notNull(),
  },
  (table) => [
    index("fund_news_items_code_expire_idx").on(table.code, table.expireAt),
    index("fund_news_items_status_expire_idx").on(table.status, table.expireAt),
  ],
);

/** 自选基金：与个股 watchlist 隔离，仅保存基金档案元数据。 */
export const fundWatchlist = pgTable("fund_watchlist", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  tradingMode: text("trading_mode").notNull(),
  group: text("group").notNull(),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull(),
  sortOrder: integer("sort_order").notNull(),
  note: text("note"),
});

/** 预警规则：一个自选标的对应一条规则，条件以 jsonb 数组保存。 */
export const alertRules = pgTable("alert_rules", {
  id: text("id").primaryKey(),
  target: text("target").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  logic: text("logic").notNull().default("and"),
  conditions: jsonb("conditions")
    .$type<AlertCondition[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  enabled: boolean("enabled").notNull().default(true),
  cooldownHours: integer("cooldown_hours").notNull().default(12),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
});

/** 预警事件：固化触发时的观测值、数据来源与邮件推送结果。 */
export const alertEvents = pgTable(
  "alert_events",
  {
    id: text("id").primaryKey(),
    ruleId: text("rule_id").notNull(),
    target: text("target").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    logic: text("logic").notNull(),
    metrics: jsonb("metrics")
      .$type<AlertMetric[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    hits: jsonb("hits")
      .$type<AlertConditionHit[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    dataSource: text("data_source").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    level: text("level").notNull().default("warn"),
    message: text("message").notNull(),
    emailStatus: text("email_status").notNull().default("skipped"),
    emailReason: text("email_reason"),
    status: text("status").notNull().default("unread"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("alert_events_created_at_idx").on(table.createdAt),
    index("alert_events_status_idx").on(table.status),
  ],
);

/** 个股持仓组合：金额为投入成本额，收益为用户记录的当前浮动盈亏。 */
// 与基金侧 fund_watchlist 一致，数据库不可用时回退 .data/stock-portfolio.json。
export const stockHoldings = pgTable(
  "stock_holdings",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    profit: numeric("profit", { precision: 18, scale: 2 }).notNull().default("0"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("stock_holdings_code_idx").on(table.code)],
);
/** 基金持有组合：手动录入当前持有金额与累计收益，或启用定投计划后由计划派生。 */

// 与自选池/个股持仓一致，数据库不可用时回退 .data/fund-positions.json。
export const fundPositions = pgTable(
  "fund_positions",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** 当前持有金额（市值），单位元，必须大于 0。 */
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    /** 当前累计收益，单位元，可为负；含义由 profit_caliber 决定。 */
    profit: numeric("profit", { precision: 18, scale: 2 }).notNull().default("0"),
    /** 累计收益口径：include_today（含当日收益，缺省）/ exclude_today（截至上一交易日）。 */
    profitCaliber: text("profit_caliber").notNull().default("include_today"),
    /** 定投频率：daily / weekly / biweekly / monthly；null 表示未启用定投计划。 */
    dcaFrequency: text("dca_frequency"),
    /** 每周定投的星期几（1-5）；非 weekly 计划为 null。 */
    dcaWeekday: integer("dca_weekday"),
    /** 每期定投金额（元）。 */
    dcaAmount: numeric("dca_amount", { precision: 18, scale: 2 }),
    /** 定投计划启用日（首期目标日），YYYY-MM-DD。 */
    dcaStartDate: text("dca_start_date"),
    /** 手动校准采用的净值日，YYYY-MM-DD；null 表示未校准。 */
    calibNavDate: text("calib_nav_date"),
    /** 手动校准得到的持仓份额（校准持有金额 / 校准日净值）。 */
    calibShares: numeric("calib_shares", { precision: 18, scale: 4 }),
    /** 手动校准得到的累计投入（本金）= 校准持有金额 − 校准累计收益。 */
    calibCost: numeric("calib_cost", { precision: 18, scale: 2 }),
    /** 校准锚定净值（估算锚定时为盘中估算 / 实时价，官方锚定时为官方单位净值）。 */
    calibNav: numeric("calib_nav", { precision: 18, scale: 4 }),
    /** 校准锚点来源：official（官方净值）/ estimate（估算锚定，待结算官方净值）。 */
    calibAnchor: text("calib_anchor"),
    /** 手动持仓锚点对应的净值日，YYYY-MM-DD；null 表示按录入时间推断。 */
    manualAnchorDate: text("manual_anchor_date"),
    /** 手动持仓锚定净值：官方锚定为官方单位净值，估算锚定为盘中估算 / 实时价。 */
    manualAnchorNav: numeric("manual_anchor_nav", { precision: 18, scale: 4 }),
    /** 手动持仓锚点来源：official（官方净值）/ estimate（估算锚定，待官方净值公布后重锚）。 */
    manualAnchorSource: text("manual_anchor_source"),
    note: text("note"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("fund_positions_code_idx").on(table.code)],
);