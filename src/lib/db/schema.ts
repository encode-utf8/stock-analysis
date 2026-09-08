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
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

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
