// mock 数据自检：冻结接口契约期间，保证占位数据字段完整、彼此引用一致。
import { describe, expect, it } from "vitest";

import {
  buildMockStock,
  mockConversation,
  mockIndicators,
  mockJobRuns,
  mockKlines,
  mockMessages,
  mockNews,
  mockQuote,
  mockReports,
  mockStock,
} from "@/lib/mock";

describe("mock 数据", () => {
  it("行情、K 线与指标都属于同一只股票", () => {
    expect(mockQuote.code).toBe(mockStock.code);
    expect(mockIndicators.code).toBe(mockStock.code);
    expect(mockKlines.every((item) => item.code === mockStock.code)).toBe(true);
    expect(mockKlines.length).toBeGreaterThan(0);
  });

  it("资讯、报告与任务记录引用一致且字段完整", () => {
    expect(mockNews.every((item) => item.code === mockStock.code)).toBe(true);
    expect(mockNews.every((item) => item.expire_at > item.published_at)).toBe(true);
    expect(mockReports[0].code).toBe(mockStock.code);
    expect(mockReports[0].news_refs).toContain(mockNews[0].id);
    expect(mockJobRuns[0].job_name).toBe("refresh");
    expect(mockJobRuns[0].finished_at).not.toBeNull();
  });

  it("会话与消息互相引用", () => {
    expect(mockMessages.every((item) => item.conversation_id === mockConversation.id)).toBe(true);
    expect(mockMessages.map((item) => item.role)).toEqual(["user", "assistant"]);
  });

  it("buildMockStock 只替换代码与名称", () => {
    const built = buildMockStock("000001");
    expect(built.code).toBe("000001");
    expect(built.name).toBe("股票 000001");
    expect(built.exchange).toBe(mockStock.exchange);
  });
});
