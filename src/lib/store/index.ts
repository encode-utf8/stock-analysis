// 数据访问接口与内存版 stub。
// 后续 feature/persistence-cleanup 实现 Drizzle 版本时必须保持这里冻结的签名不变。

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
import { hasRealDatabaseUrl } from "@/lib/db";
import { createDrizzleStore } from "./drizzle-store";
export {
  watchlistStore,
  type WatchlistRepository,
} from "./watchlist";

/** 股票仓库接口。 */
export interface StockRepository {
  getByCode(code: string): Promise<Stock | null>;
  upsert(stock: Stock): Promise<void>;
  list(): Promise<Stock[]>;
}

/** 行情仓库接口。 */
export interface MarketQuoteRepository {
  getLatest(code: string): Promise<MarketQuote | null>;
  insert(quote: MarketQuote): Promise<void>;
}

/** K 线仓库接口。 */
export interface KlineRepository {
  list(
    code: string,
    period: KlinePeriod,
    adjust?: AdjustType,
    limit?: number,
  ): Promise<Kline[]>;
  insertMany(klines: Kline[]): Promise<void>;
}

/** 资讯仓库接口。 */
export interface NewsItemRepository {
  listByCode(code: string): Promise<NewsItem[]>;
  insert(item: NewsItem): Promise<void>;
  updateStatus(id: string, status: NewsStatus): Promise<void>;
  listExpired(now: string): Promise<NewsItem[]>;
}

/** 报告仓库接口。 */
export interface AnalysisReportRepository {
  listByCode(code: string): Promise<AnalysisReport[]>;
  insert(report: AnalysisReport): Promise<void>;
  deleteById(id: string): Promise<void>;
}

/** 会话仓库接口。 */
export interface ConversationRepository {
  getById(id: string): Promise<Conversation | null>;
  listByCode(code: string): Promise<Conversation[]>;
  create(conversation: Conversation): Promise<void>;
  delete(id: string): Promise<void>;
}

/** 消息仓库接口。 */
export interface MessageRepository {
  listByConversation(conversationId: string): Promise<Message[]>;
  insert(message: Message): Promise<void>;
  deleteByConversation(conversationId: string): Promise<void>;
}

/** 任务运行记录仓库接口。 */
export interface JobRunRepository {
  insert(run: JobRun): Promise<void>;
  listRecent(limit?: number): Promise<JobRun[]>;
}

/** 数据访问层总接口。 */
export interface Store {
  stocks: StockRepository;
  marketQuotes: MarketQuoteRepository;
  klines: KlineRepository;
  newsItems: NewsItemRepository;
  analysisReports: AnalysisReportRepository;
  conversations: ConversationRepository;
  messages: MessageRepository;
  jobRuns: JobRunRepository;
}

/** 深拷贝辅助函数，避免外部修改污染内存数据。 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 创建独立的内存版 store。 */
export function createMemoryStore(): Store {
  const stocks = new Map<string, Stock>();
  const quotes = new Map<string, MarketQuote>();
  const klines: Kline[] = [];
  const newsItems = new Map<string, NewsItem>();
  const reports = new Map<string, AnalysisReport>();
  const conversations = new Map<string, Conversation>();
  const messages = new Map<string, Message>();
  const jobRuns = new Map<string, JobRun>();

  return {
    stocks: {
      async getByCode(code) {
        const item = stocks.get(code);
        return item ? clone(item) : null;
      },
      async upsert(stock) {
        stocks.set(stock.code, clone(stock));
      },
      async list() {
        return Array.from(stocks.values()).map((item) => clone(item));
      },
    },
    marketQuotes: {
      async getLatest(code) {
        const quote = quotes.get(code);
        return quote ? clone(quote) : null;
      },
      async insert(quote) {
        const previous = quotes.get(quote.code);
        if (!previous || quote.fetched_at >= previous.fetched_at) {
          quotes.set(quote.code, clone(quote));
        }
      },
    },
    klines: {
      async list(code, period, adjust, limit) {
        const filtered = klines
          .filter(
            (item) =>
              item.code === code &&
              item.period === period &&
              (!adjust || item.adj_type === adjust),
          )
          .sort((a, b) => a.ts.localeCompare(b.ts));
        const sliced = limit ? filtered.slice(-limit) : filtered;
        return clone(sliced);
      },
      async insertMany(items) {
        for (const item of items) {
          klines.push(clone(item));
        }
      },
    },
    newsItems: {
      async listByCode(code) {
        return Array.from(newsItems.values())
          .filter((item) => item.code === code)
          .sort((a, b) => b.published_at.localeCompare(a.published_at))
          .map((item) => clone(item));
      },
      async insert(item) {
        newsItems.set(item.id, clone(item));
      },
      async updateStatus(id, status) {
        const item = newsItems.get(id);
        if (item) {
          newsItems.set(id, { ...item, status });
        }
      },
      async listExpired(now) {
        return Array.from(newsItems.values())
          .filter((item) => !item.pinned && item.expire_at < now)
          .map((item) => clone(item));
      },
    },
    analysisReports: {
      async listByCode(code) {
        return Array.from(reports.values())
          .filter((item) => item.code === code)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map((item) => clone(item));
      },
      async insert(report) {
        reports.set(report.id, clone(report));
      },
      async deleteById(id) {
        reports.delete(id);
      },
    },
    conversations: {
      async getById(id) {
        const item = conversations.get(id);
        return item ? clone(item) : null;
      },
      async listByCode(code) {
        return Array.from(conversations.values())
          .filter((item) => item.code === code)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map((item) => clone(item));
      },
      async create(conversation) {
        conversations.set(conversation.id, clone(conversation));
      },
      async delete(id) {
        conversations.delete(id);
      },
    },
    messages: {
      async listByConversation(conversationId) {
        return Array.from(messages.values())
          .filter((item) => item.conversation_id === conversationId)
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .map((item) => clone(item));
      },
      async insert(message) {
        messages.set(message.id, clone(message));
      },
      async deleteByConversation(conversationId) {
        for (const [id, message] of messages) {
          if (message.conversation_id === conversationId) {
            messages.delete(id);
          }
        }
      },
    },
    jobRuns: {
      async insert(run) {
        jobRuns.set(run.id, clone(run));
      },
      async listRecent(limit = 20) {
        return Array.from(jobRuns.values())
          .sort((a, b) => b.started_at.localeCompare(a.started_at))
          .slice(0, limit)
          .map((item) => clone(item));
      },
    },
  };
}

/** 默认内存 store 单例。 */
export const memoryStore: Store = createMemoryStore();

let resilientStore: Store | null = null;

/** 单次持久化仓库操作的最长等待时间，超时后自动切换到内存实现。 */
const PERSISTED_OPERATION_TIMEOUT_MS = 2_000;

/** 给数据库操作加超时，避免远端数据库无响应时长时间阻塞页面。 */
async function withOperationTimeout<T>(
  operation: Promise<T>,
  operationName: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `数据库操作超时（${PERSISTED_OPERATION_TIMEOUT_MS / 1000} 秒）：${operationName}`,
            ),
          );
        }, PERSISTED_OPERATION_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/** 单个仓库代理：数据库访问失败一次后，本次运行自动切换到内存实现。 */
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
          return await withOperationTimeout(
            Promise.resolve(
              Reflect.apply(
                persistedValue as (...args: unknown[]) => unknown,
                persistedRepository,
                args,
              ) as Promise<unknown>,
            ),
            String(property),
          );
        } catch (error) {
          fallbackState.enabled = true;
          console.warn("[store] PostgreSQL 访问失败，本次运行已切换为内存存储：", error);
          return Reflect.apply(memoryValue, memoryRepository, args);
        }
      };
    },
  };

  return new Proxy(memoryRepository, handler) as T;
}

/** 创建带故障回退的 Drizzle store，数据库不可用时保证页面仍可运行。 */
function createResilientStore(): Store {
  const memory = createMemoryStore();
  const fallbackState = { enabled: false };
  let drizzleStore: Store | null = null;
  const getPersisted = () => {
    drizzleStore ??= createDrizzleStore();
    return drizzleStore;
  };

  return {
    stocks: createRepositoryWithFallback(memory.stocks, () => getPersisted().stocks, fallbackState),
    marketQuotes: createRepositoryWithFallback(memory.marketQuotes, () => getPersisted().marketQuotes, fallbackState),
    klines: createRepositoryWithFallback(memory.klines, () => getPersisted().klines, fallbackState),
    newsItems: createRepositoryWithFallback(memory.newsItems, () => getPersisted().newsItems, fallbackState),
    analysisReports: createRepositoryWithFallback(memory.analysisReports, () => getPersisted().analysisReports, fallbackState),
    conversations: createRepositoryWithFallback(memory.conversations, () => getPersisted().conversations, fallbackState),
    messages: createRepositoryWithFallback(memory.messages, () => getPersisted().messages, fallbackState),
    jobRuns: createRepositoryWithFallback(memory.jobRuns, () => getPersisted().jobRuns, fallbackState),
  };
}

/** 按环境变量选择真实数据库或内存回退实现。 */
export function getStore(): Store {
  if (hasRealDatabaseUrl()) {
    resilientStore ??= createResilientStore();
    return resilientStore;
  }
  return memoryStore;
}

/** 默认 store 单例，供业务编排与 API 路由统一使用。 */
export const store: Store = getStore();
