// 基金 AI 报告与会话内存仓库：隔离个股 report/conversation/message，便于 F5 再迁移到 Drizzle。
import type {
  FundAnalysisReport,
  FundConversation,
  FundMessage,
} from "@/lib/shared/types";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const reports = new Map<string, FundAnalysisReport>();
const conversations = new Map<string, FundConversation>();
const messages = new Map<string, FundMessage>();

export const fundAiStore = {
  reports: {
    async listByCode(code: string): Promise<FundAnalysisReport[]> {
      return Array.from(reports.values())
        .filter((item) => item.code === code)
        .sort((left, right) => right.created_at.localeCompare(left.created_at))
        .map((item) => clone(item));
    },
    async insert(report: FundAnalysisReport): Promise<void> {
      reports.set(report.id, clone(report));
    },
    async deleteById(id: string): Promise<void> {
      reports.delete(id);
    },
  },
  conversations: {
    async getById(id: string): Promise<FundConversation | null> {
      const item = conversations.get(id);
      return item ? clone(item) : null;
    },
    async listByCode(code: string): Promise<FundConversation[]> {
      return Array.from(conversations.values())
        .filter((item) => item.code === code)
        .sort((left, right) => right.created_at.localeCompare(left.created_at))
        .map((item) => clone(item));
    },
    async create(conversation: FundConversation): Promise<void> {
      conversations.set(conversation.id, clone(conversation));
    },
    async delete(id: string): Promise<void> {
      conversations.delete(id);
    },
  },
  messages: {
    async listByConversation(conversationId: string): Promise<FundMessage[]> {
      return Array.from(messages.values())
        .filter((item) => item.conversation_id === conversationId)
        .sort((left, right) => left.created_at.localeCompare(right.created_at))
        .map((item) => clone(item));
    },
    async insert(message: FundMessage): Promise<void> {
      messages.set(message.id, clone(message));
    },
    async deleteByConversation(conversationId: string): Promise<void> {
      for (const [id, message] of messages) {
        if (message.conversation_id === conversationId) {
          messages.delete(id);
        }
      }
    },
  },
};
