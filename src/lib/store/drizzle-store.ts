// Drizzle 数据访问层：实现 lib/store 冻结的 Store 接口。
// 使用 PostgreSQL 持久化，替代进程内内存 stub；接口签名与内存版保持一致。

import { and, asc, desc, eq, lt, not, type SQL } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import type {
  AdjustType,
  AnalysisReport,
  Conversation,
  JobRun,
  Kline,
  KlinePeriod,
  MarketQuote,
  Message,
  NewsItem,
  NewsStatus,
  Stock,
} from "@/lib/shared/types";
import type { Store } from "@/lib/store";

/** 将模型中的 ISO 字符串统一转换为数据库 Date。 */
function toDate(value: string): Date {
  return new Date(value);
}

/** 将数据库行情行转换为共享模型。 */
function mapQuote(row: typeof schema.marketQuotes.$inferSelect): MarketQuote {
  return {
    code: row.code,
    ts: row.ts.toISOString(),
    price: row.price,
    change_pct: row.changePct,
    open: row.open,
    high: row.high,
    low: row.low,
    prev_close: row.prevClose,
    volume: row.volume,
    amount: row.amount,
    turnover_rate: row.turnoverRate,
    pe: row.pe,
    pb: row.pb,
    market_cap: row.marketCap,
    float_cap: row.floatCap,
    source: row.source,
    fetched_at: row.fetchedAt.toISOString(),
  };
}

/** 将数据库 K 线行转换为共享模型。 */
function mapKline(row: typeof schema.klines.$inferSelect): Kline {
  return {
    code: row.code,
    period: row.period as KlinePeriod,
    ts: row.ts.toISOString(),
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    amount: row.amount,
    adj_type: row.adjType as AdjustType,
    source: row.source ?? undefined,
    fetched_at: row.fetchedAt?.toISOString(),
  };
}

/** 将数据库资讯行转换为共享模型。 */
function mapNews(row: typeof schema.newsItems.$inferSelect): NewsItem {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    summary: row.summary,
    url: row.url,
    source: row.source,
    published_at: row.publishedAt.toISOString(),
    fetched_at: row.fetchedAt.toISOString(),
    sentiment: row.sentiment as NewsItem["sentiment"],
    confidence: row.confidence,
    impact_days: row.impactDays,
    expire_at: row.expireAt.toISOString(),
    tags: row.tags ?? [],
    status: row.status as NewsStatus,
    pinned: row.pinned,
  };
}

/** 将数据库报告行转换为共享模型。 */
function mapReport(row: typeof schema.analysisReports.$inferSelect): AnalysisReport {
  return {
    id: row.id,
    code: row.code,
    created_at: row.createdAt.toISOString(),
    data_snapshot: row.dataSnapshot ?? null,
    news_refs: row.newsRefs ?? [],
    content: row.content,
    risk_note: row.riskNote,
  };
}

/** 将数据库会话行转换为共享模型。 */
function mapConversation(row: typeof schema.conversations.$inferSelect): Conversation {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    created_at: row.createdAt.toISOString(),
  };
}

/** 将数据库消息行转换为共享模型。 */
function mapMessage(row: typeof schema.messages.$inferSelect): Message {
  return {
    id: row.id,
    conversation_id: row.conversationId,
    role: row.role as Message["role"],
    content: row.content,
    tool_calls: row.toolCalls ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

/** 将数据库任务行转换为共享模型。 */
function mapJobRun(row: typeof schema.jobRuns.$inferSelect): JobRun {
  return {
    id: row.id,
    job_name: row.jobName,
    status: row.status as JobRun["status"],
    started_at: row.startedAt.toISOString(),
    finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
    detail: row.detail ?? null,
  };
}

/** 创建 Drizzle PostgreSQL 数据访问层。 */
export function createDrizzleStore(): Store {
  const db = getDb();

  return {
    stocks: {
      async getByCode(code) {
        const rows = await db
          .select()
          .from(schema.stocks)
          .where(eq(schema.stocks.code, code))
          .limit(1);
        const row = rows[0];
        if (!row) {
          return null;
        }
        return {
          code: row.code,
          name: row.name,
          exchange: row.exchange as Stock["exchange"],
          industry: row.industry,
          meta: row.meta ?? null,
        };
      },
      async upsert(stock) {
        await db
          .insert(schema.stocks)
          .values({
            code: stock.code,
            name: stock.name,
            exchange: stock.exchange,
            industry: stock.industry,
            meta: stock.meta,
          })
          .onConflictDoUpdate({
            target: schema.stocks.code,
            set: {
              name: stock.name,
              exchange: stock.exchange,
              industry: stock.industry,
              meta: stock.meta,
            },
          });
      },
      async list() {
        const rows = await db.select().from(schema.stocks).orderBy(asc(schema.stocks.code));
        return rows.map((row) => ({
          code: row.code,
          name: row.name,
          exchange: row.exchange as Stock["exchange"],
          industry: row.industry,
          meta: row.meta ?? null,
        }));
      },
    },
    marketQuotes: {
      async getLatest(code) {
        const rows = await db
          .select()
          .from(schema.marketQuotes)
          .where(eq(schema.marketQuotes.code, code))
          .orderBy(desc(schema.marketQuotes.fetchedAt))
          .limit(1);
        const row = rows[0];
        return row ? mapQuote(row) : null;
      },
      async insert(quote) {
        await db
          .insert(schema.marketQuotes)
          .values({
            code: quote.code,
            ts: toDate(quote.ts),
            price: quote.price,
            changePct: quote.change_pct,
            open: quote.open,
            high: quote.high,
            low: quote.low,
            prevClose: quote.prev_close,
            volume: quote.volume,
            amount: quote.amount,
            turnoverRate: quote.turnover_rate,
            pe: quote.pe,
            pb: quote.pb,
            marketCap: quote.market_cap,
            floatCap: quote.float_cap,
            source: quote.source,
            fetchedAt: toDate(quote.fetched_at),
          })
          .onConflictDoNothing();
      },
    },
    klines: {
      async list(code, period, adjust, limit) {
        const conditions: SQL[] = [
          eq(schema.klines.code, code),
          eq(schema.klines.period, period),
        ];
        if (adjust) {
          conditions.push(eq(schema.klines.adjType, adjust));
        }

        const rows = await db
          .select()
          .from(schema.klines)
          .where(and(...conditions))
          .orderBy(asc(schema.klines.ts));
        const mapped = rows.map(mapKline);
        return limit ? mapped.slice(-limit) : mapped;
      },
      async insertMany(klines) {
        if (klines.length === 0) {
          return;
        }
        await db
          .insert(schema.klines)
          .values(
            klines.map((kline) => ({
              code: kline.code,
              period: kline.period,
              ts: toDate(kline.ts),
              open: kline.open,
              high: kline.high,
              low: kline.low,
              close: kline.close,
              volume: kline.volume,
              amount: kline.amount,
              adjType: kline.adj_type,
              source: kline.source,
              fetchedAt: kline.fetched_at ? toDate(kline.fetched_at) : null,
            })),
          )
          .onConflictDoNothing();
      },
    },
    newsItems: {
      async listByCode(code) {
        const rows = await db
          .select()
          .from(schema.newsItems)
          .where(eq(schema.newsItems.code, code))
          .orderBy(desc(schema.newsItems.publishedAt));
        return rows.map(mapNews);
      },
      async insert(item) {
        await db
          .insert(schema.newsItems)
          .values({
            id: item.id,
            code: item.code,
            title: item.title,
            summary: item.summary,
            url: item.url,
            source: item.source,
            publishedAt: toDate(item.published_at),
            fetchedAt: toDate(item.fetched_at),
            sentiment: item.sentiment,
            confidence: item.confidence,
            impactDays: item.impact_days,
            expireAt: toDate(item.expire_at),
            tags: item.tags,
            status: item.status,
            pinned: item.pinned,
          })
          .onConflictDoUpdate({
            target: schema.newsItems.id,
            set: {
              title: item.title,
              summary: item.summary,
              url: item.url,
              source: item.source,
              publishedAt: toDate(item.published_at),
              fetchedAt: toDate(item.fetched_at),
              sentiment: item.sentiment,
              confidence: item.confidence,
              impactDays: item.impact_days,
              expireAt: toDate(item.expire_at),
              tags: item.tags,
              status: item.status,
              pinned: item.pinned,
            },
          });
      },
      async updateStatus(id, status) {
        await db
          .update(schema.newsItems)
          .set({ status })
          .where(eq(schema.newsItems.id, id));
      },
      async listExpired(now) {
        const rows = await db
          .select()
          .from(schema.newsItems)
          .where(
            and(
              not(schema.newsItems.pinned),
              lt(schema.newsItems.expireAt, toDate(now)),
            ),
          );
        return rows.map(mapNews);
      },
    },
    analysisReports: {
      async listByCode(code) {
        const rows = await db
          .select()
          .from(schema.analysisReports)
          .where(eq(schema.analysisReports.code, code))
          .orderBy(desc(schema.analysisReports.createdAt));
        return rows.map(mapReport);
      },
      async insert(report) {
        await db
          .insert(schema.analysisReports)
          .values({
            id: report.id,
            code: report.code,
            createdAt: toDate(report.created_at),
            dataSnapshot: report.data_snapshot,
            newsRefs: report.news_refs,
            content: report.content,
            riskNote: report.risk_note,
          })
          .onConflictDoUpdate({
            target: schema.analysisReports.id,
            set: {
              dataSnapshot: report.data_snapshot,
              newsRefs: report.news_refs,
              content: report.content,
              riskNote: report.risk_note,
            },
          });
      },
      async deleteById(id) {
        await db.delete(schema.analysisReports).where(eq(schema.analysisReports.id, id));
      },
    },
    conversations: {
      async getById(id) {
        const rows = await db
          .select()
          .from(schema.conversations)
          .where(eq(schema.conversations.id, id))
          .limit(1);
        const row = rows[0];
        return row ? mapConversation(row) : null;
      },
      async listByCode(code) {
        const rows = await db
          .select()
          .from(schema.conversations)
          .where(eq(schema.conversations.code, code))
          .orderBy(asc(schema.conversations.createdAt));
        return rows.map(mapConversation);
      },
      async create(conversation) {
        await db
          .insert(schema.conversations)
          .values({
            id: conversation.id,
            code: conversation.code,
            title: conversation.title,
            createdAt: toDate(conversation.created_at),
          })
          .onConflictDoNothing();
      },
      async delete(id) {
        await db.delete(schema.conversations).where(eq(schema.conversations.id, id));
      },
    },
    messages: {
      async listByConversation(conversationId) {
        const rows = await db
          .select()
          .from(schema.messages)
          .where(eq(schema.messages.conversationId, conversationId))
          .orderBy(asc(schema.messages.createdAt));
        return rows.map(mapMessage);
      },
      async insert(message) {
        await db
          .insert(schema.messages)
          .values({
            id: message.id,
            conversationId: message.conversation_id,
            role: message.role,
            content: message.content,
            toolCalls: message.tool_calls,
            createdAt: toDate(message.created_at),
          })
          .onConflictDoNothing();
      },
      async deleteByConversation(conversationId) {
        await db
          .delete(schema.messages)
          .where(eq(schema.messages.conversationId, conversationId));
      },
    },
    jobRuns: {
      async insert(run) {
        await db
          .insert(schema.jobRuns)
          .values({
            id: run.id,
            jobName: run.job_name,
            status: run.status,
            startedAt: toDate(run.started_at),
            finishedAt: run.finished_at ? toDate(run.finished_at) : null,
            detail: run.detail,
          })
          .onConflictDoUpdate({
            target: schema.jobRuns.id,
            set: {
              status: run.status,
              finishedAt: run.finished_at ? toDate(run.finished_at) : null,
              detail: run.detail,
            },
          });
      },
      async listRecent(limit = 20) {
        const rows = await db
          .select()
          .from(schema.jobRuns)
          .orderBy(desc(schema.jobRuns.startedAt))
          .limit(limit);
        return rows.map(mapJobRun);
      },
    },
  };
}
