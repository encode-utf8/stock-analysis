// 基金资讯持久化仓库：优先 PostgreSQL，数据库不可用时回退内存。
import { desc, eq, lt, and, not } from "drizzle-orm";

import { getDb, hasRealDatabaseUrl, schema } from "@/lib/db";
import type { FundNewsItem, NewsStatus } from "@/lib/shared/types";

interface FundNewsRepository {
  listByCode(code: string): Promise<FundNewsItem[]>;
  insert(item: FundNewsItem): Promise<void>;
  updateStatus(id: string, status: NewsStatus): Promise<void>;
  listExpired(now: string): Promise<FundNewsItem[]>;
}

interface FundNewsStore {
  news: FundNewsRepository;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function toDate(value: string): Date {
  return new Date(value);
}

function mapFundNews(row: typeof schema.fundNewsItems.$inferSelect): FundNewsItem {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    summary: row.summary,
    url: row.url,
    source: row.source,
    published_at: row.publishedAt.toISOString(),
    fetched_at: row.fetchedAt.toISOString(),
    sentiment: row.sentiment as FundNewsItem["sentiment"],
    confidence: row.confidence,
    impact_days: row.impactDays,
    expire_at: row.expireAt.toISOString(),
    tags: row.tags ?? [],
    status: row.status as NewsStatus,
    pinned: row.pinned,
    news_type: row.newsType as FundNewsItem["news_type"],
  };
}

function createMemoryFundNewsStore(): FundNewsStore {
  const items = new Map<string, FundNewsItem>();
  return {
    news: {
      async listByCode(code) {
        return Array.from(items.values())
          .filter((item) => item.code === code)
          .sort((left, right) => right.published_at.localeCompare(left.published_at))
          .map((item) => clone(item));
      },
      async insert(item) {
        items.set(item.id, clone(item));
      },
      async updateStatus(id, status) {
        const item = items.get(id);
        if (item) {
          items.set(id, { ...item, status });
        }
      },
      async listExpired(now) {
        return Array.from(items.values())
          .filter((item) => !item.pinned && item.expire_at < now)
          .map((item) => clone(item));
      },
    },
  };
}

function createDrizzleFundNewsStore(): FundNewsStore {
  const db = getDb();
  return {
    news: {
      async listByCode(code) {
        const rows = await db
          .select()
          .from(schema.fundNewsItems)
          .where(eq(schema.fundNewsItems.code, code))
          .orderBy(desc(schema.fundNewsItems.publishedAt));
        return rows.map(mapFundNews);
      },
      async insert(item) {
        await db
          .insert(schema.fundNewsItems)
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
            newsType: item.news_type,
          })
          .onConflictDoUpdate({
            target: schema.fundNewsItems.id,
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
              newsType: item.news_type,
            },
          });
      },
      async updateStatus(id, status) {
        await db.update(schema.fundNewsItems).set({ status }).where(eq(schema.fundNewsItems.id, id));
      },
      async listExpired(now) {
        const rows = await db
          .select()
          .from(schema.fundNewsItems)
          .where(
            and(
              not(schema.fundNewsItems.pinned),
              lt(schema.fundNewsItems.expireAt, toDate(now)),
            ),
          );
        return rows.map(mapFundNews);
      },
    },
  };
}

function createRepositoryWithFallback<T extends object>(
  memoryRepository: T,
  getPersistedRepository: () => T,
  fallbackState: { enabled: boolean },
): T {
  const handler: ProxyHandler<T> = {
    get(_target, property, receiver) {
      const memoryValue = Reflect.get(memoryRepository, property, receiver);
      if (typeof memoryValue !== "function") {
        return memoryValue;
      }
      return async (...args: unknown[]) => {
        if (fallbackState.enabled) {
          return Reflect.apply(memoryValue, memoryRepository, args);
        }
        try {
          const persistedRepository = getPersistedRepository();
          const persistedValue = Reflect.get(persistedRepository, property, receiver);
          return await Reflect.apply(
            persistedValue as (...persistedArgs: unknown[]) => Promise<unknown>,
            persistedRepository,
            args,
          );
        } catch (error) {
          fallbackState.enabled = true;
          console.warn("[fund-news-store] PostgreSQL 访问失败，本次运行已切换为内存存储：", error);
          return Reflect.apply(memoryValue, memoryRepository, args);
        }
      };
    },
  };
  return new Proxy(memoryRepository, handler) as T;
}

function createResilientFundNewsStore(): FundNewsStore {
  const memory = createMemoryFundNewsStore();
  const fallbackState = { enabled: false };
  let drizzleStore: FundNewsStore | null = null;
  const getPersisted = () => {
    drizzleStore ??= createDrizzleFundNewsStore();
    return drizzleStore;
  };
  return {
    news: createRepositoryWithFallback(memory.news, () => getPersisted().news, fallbackState),
  };
}

export const fundNewsStore: FundNewsStore = hasRealDatabaseUrl()
  ? createResilientFundNewsStore()
  : createMemoryFundNewsStore();
