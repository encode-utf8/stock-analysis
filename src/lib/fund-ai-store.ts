// 基金 AI 报告与会话仓库：优先 PostgreSQL，数据库不可用时回退内存，保证页面仍可运行。
import { asc, desc, eq } from "drizzle-orm";

import { getDb, hasRealDatabaseUrl, schema } from "@/lib/db";
import type {
  FundAnalysisReport,
  FundConversation,
  FundMessage,
} from "@/lib/shared/types";

interface FundReportRepository {
  listByCode(code: string): Promise<FundAnalysisReport[]>;
  insert(report: FundAnalysisReport): Promise<void>;
  deleteById(id: string): Promise<void>;
}

interface FundConversationRepository {
  getById(id: string): Promise<FundConversation | null>;
  listByCode(code: string): Promise<FundConversation[]>;
  create(conversation: FundConversation): Promise<void>;
  delete(id: string): Promise<void>;
}

interface FundMessageRepository {
  listByConversation(conversationId: string): Promise<FundMessage[]>;
  insert(message: FundMessage): Promise<void>;
  deleteByConversation(conversationId: string): Promise<void>;
}

interface FundAiStore {
  reports: FundReportRepository;
  conversations: FundConversationRepository;
  messages: FundMessageRepository;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function toDate(value: string): Date {
  return new Date(value);
}

function mapFundReport(row: typeof schema.fundAnalysisReports.$inferSelect): FundAnalysisReport {
  return {
    id: row.id,
    code: row.code,
    created_at: row.createdAt.toISOString(),
    data_snapshot: row.dataSnapshot ?? null,
    source_refs: row.sourceRefs ?? [],
    content: row.content,
    risk_note: row.riskNote,
  };
}

function mapFundConversation(row: typeof schema.fundConversations.$inferSelect): FundConversation {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    created_at: row.createdAt.toISOString(),
  };
}

function mapFundMessage(row: typeof schema.fundMessages.$inferSelect): FundMessage {
  return {
    id: row.id,
    conversation_id: row.conversationId,
    role: row.role as FundMessage["role"],
    content: row.content,
    tool_calls: row.toolCalls ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

function createMemoryFundAiStore(): FundAiStore {
  const reports = new Map<string, FundAnalysisReport>();
  const conversations = new Map<string, FundConversation>();
  const messages = new Map<string, FundMessage>();

  return {
    reports: {
      async listByCode(code) {
        return Array.from(reports.values())
          .filter((item) => item.code === code)
          .sort((left, right) => right.created_at.localeCompare(left.created_at))
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
          .sort((left, right) => right.created_at.localeCompare(left.created_at))
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
          .sort((left, right) => left.created_at.localeCompare(right.created_at))
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
  };
}

function createDrizzleFundAiStore(): FundAiStore {
  const db = getDb();

  return {
    reports: {
      async listByCode(code) {
        const rows = await db
          .select()
          .from(schema.fundAnalysisReports)
          .where(eq(schema.fundAnalysisReports.code, code))
          .orderBy(desc(schema.fundAnalysisReports.createdAt));
        return rows.map(mapFundReport);
      },
      async insert(report) {
        await db
          .insert(schema.fundAnalysisReports)
          .values({
            id: report.id,
            code: report.code,
            createdAt: toDate(report.created_at),
            dataSnapshot: report.data_snapshot,
            sourceRefs: report.source_refs,
            content: report.content,
            riskNote: report.risk_note,
          })
          .onConflictDoUpdate({
            target: schema.fundAnalysisReports.id,
            set: {
              dataSnapshot: report.data_snapshot,
              sourceRefs: report.source_refs,
              content: report.content,
              riskNote: report.risk_note,
            },
          });
      },
      async deleteById(id) {
        await db.delete(schema.fundAnalysisReports).where(eq(schema.fundAnalysisReports.id, id));
      },
    },
    conversations: {
      async getById(id) {
        const rows = await db
          .select()
          .from(schema.fundConversations)
          .where(eq(schema.fundConversations.id, id))
          .limit(1);
        const row = rows[0];
        return row ? mapFundConversation(row) : null;
      },
      async listByCode(code) {
        const rows = await db
          .select()
          .from(schema.fundConversations)
          .where(eq(schema.fundConversations.code, code))
          .orderBy(asc(schema.fundConversations.createdAt));
        return rows.map(mapFundConversation);
      },
      async create(conversation) {
        await db
          .insert(schema.fundConversations)
          .values({
            id: conversation.id,
            code: conversation.code,
            title: conversation.title,
            createdAt: toDate(conversation.created_at),
          })
          .onConflictDoNothing();
      },
      async delete(id) {
        await db.delete(schema.fundConversations).where(eq(schema.fundConversations.id, id));
      },
    },
    messages: {
      async listByConversation(conversationId) {
        const rows = await db
          .select()
          .from(schema.fundMessages)
          .where(eq(schema.fundMessages.conversationId, conversationId))
          .orderBy(asc(schema.fundMessages.createdAt));
        return rows.map(mapFundMessage);
      },
      async insert(message) {
        await db
          .insert(schema.fundMessages)
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
        await db.delete(schema.fundMessages).where(eq(schema.fundMessages.conversationId, conversationId));
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
          console.warn("[fund-ai-store] PostgreSQL 访问失败，本次运行已切换为内存存储：", error);
          return Reflect.apply(memoryValue, memoryRepository, args);
        }
      };
    },
  };

  return new Proxy(memoryRepository, handler) as T;
}

function createResilientFundAiStore(): FundAiStore {
  const memory = createMemoryFundAiStore();
  const fallbackState = { enabled: false };
  let drizzleStore: FundAiStore | null = null;
  const getPersisted = () => {
    drizzleStore ??= createDrizzleFundAiStore();
    return drizzleStore;
  };

  return {
    reports: createRepositoryWithFallback(memory.reports, () => getPersisted().reports, fallbackState),
    conversations: createRepositoryWithFallback(memory.conversations, () => getPersisted().conversations, fallbackState),
    messages: createRepositoryWithFallback(memory.messages, () => getPersisted().messages, fallbackState),
  };
}

/** 默认基金 AI 数据仓库。 */
export const fundAiStore: FundAiStore = hasRealDatabaseUrl()
  ? createResilientFundAiStore()
  : createMemoryFundAiStore();
