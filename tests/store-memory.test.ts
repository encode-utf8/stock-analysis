// 内存版 store 契约测试：覆盖各仓库的读写、排序、切片、状态更新与深拷贝隔离。
import { describe, expect, it } from "vitest";

import { createMemoryStore } from "@/lib/store";
import type {
  AnalysisReport,
  Conversation,
  JobRun,
  Kline,
  MarketQuote,
  Message,
  NewsItem,
  Stock,
} from "@/lib/shared/types";

/** 构造股票元数据。 */
function stock(code: string, name = `股票 ${code}`): Stock {
  return { code, name, exchange: "SH", industry: "测试行业", meta: null };
}

/** 构造行情快照。 */
function quote(code: string, fetchedAt: string, source = "akshare"): MarketQuote {
  return {
    code,
    ts: fetchedAt,
    price: 10,
    change_pct: 1,
    open: 9.5,
    high: 10.2,
    low: 9.4,
    prev_close: 9.9,
    volume: 1000,
    amount: 10_000,
    turnover_rate: null,
    pe: null,
    pb: null,
    market_cap: null,
    float_cap: null,
    source,
    fetched_at: fetchedAt,
  };
}

/** 构造日 K 线。 */
function kline(ts: string, overrides: Partial<Kline> = {}): Kline {
  return {
    code: "600519",
    period: "day",
    ts,
    open: 10,
    high: 11,
    low: 9,
    close: 10.5,
    volume: 100,
    amount: 1000,
    adj_type: "qfq",
    source: "akshare",
    fetched_at: `${ts}T08:00:00.000Z`,
    ...overrides,
  };
}

/** 构造资讯条目。 */
function news(id: string, overrides: Partial<NewsItem> = {}): NewsItem {
  return {
    id,
    code: "600519",
    title: `资讯 ${id}`,
    summary: "摘要",
    url: `https://example.com/${id}`,
    source: "示例财经",
    published_at: "2026-09-01T02:00:00.000Z",
    fetched_at: "2026-09-01T03:00:00.000Z",
    sentiment: "neutral",
    confidence: 0.8,
    impact_days: 7,
    expire_at: "2026-09-30T00:00:00.000Z",
    tags: [],
    status: "active",
    pinned: false,
    ...overrides,
  };
}

/** 构造分析报告。 */
function report(id: string, createdAt: string): AnalysisReport {
  return {
    id,
    code: "600519",
    created_at: createdAt,
    data_snapshot: { price: 10 },
    news_refs: [],
    content: "内容",
    risk_note: "风险提示",
  };
}

/** 构造会话。 */
function conversation(id: string, createdAt: string): Conversation {
  return { id, code: "600519", title: `会话 ${id}`, created_at: createdAt };
}

/** 构造消息。 */
function message(id: string, createdAt: string, conversationId = "conv-1"): Message {
  return {
    id,
    conversation_id: conversationId,
    role: "user",
    content: "你好",
    tool_calls: null,
    created_at: createdAt,
  };
}

/** 构造任务运行记录。 */
function jobRun(id: string, startedAt: string): JobRun {
  return {
    id,
    job_name: "cleanup",
    status: "success",
    started_at: startedAt,
    finished_at: startedAt,
    detail: null,
  };
}

describe("股票仓库", () => {
  it("按代码读写并返回深拷贝", async () => {
    const store = createMemoryStore();
    expect(await store.stocks.getByCode("600519")).toBeNull();

    await store.stocks.upsert(stock("600519", "贵州茅台"));
    const saved = await store.stocks.getByCode("600519");
    expect(saved?.name).toBe("贵州茅台");

    // 修改返回值不应污染内部存储。
    if (saved) {
      saved.name = "被改坏的名称";
    }
    expect((await store.stocks.getByCode("600519"))?.name).toBe("贵州茅台");
    expect(await store.stocks.list()).toHaveLength(1);
  });
});

describe("行情仓库", () => {
  it("只保留最新抓取时间的快照", async () => {
    const store = createMemoryStore();
    await store.marketQuotes.insert(quote("600519", "2026-09-13T02:00:00.000Z"));
    await store.marketQuotes.insert(quote("600519", "2026-09-13T01:00:00.000Z", "旧数据"));
    expect((await store.marketQuotes.getLatest("600519"))?.source).toBe("akshare");

    await store.marketQuotes.insert(quote("600519", "2026-09-13T03:00:00.000Z", "新数据"));
    expect((await store.marketQuotes.getLatest("600519"))?.source).toBe("新数据");
    expect(await store.marketQuotes.getLatest("000001")).toBeNull();
  });
});

describe("K 线仓库", () => {
  it("按代码/周期/复权过滤、按时间升序并取最近 N 条", async () => {
    const store = createMemoryStore();
    await store.klines.insertMany([
      kline("2026-09-11"),
      kline("2026-09-09"),
      kline("2026-09-10"),
      kline("2026-09-10", { period: "minute" }),
      kline("2026-09-10", { adj_type: "hfq" }),
      kline("2026-09-10", { code: "000001" }),
    ]);

    const daily = await store.klines.list("600519", "day", "qfq");
    expect(daily.map((item) => item.ts)).toEqual(["2026-09-09", "2026-09-10", "2026-09-11"]);
    expect((await store.klines.list("600519", "day", "qfq", 2)).map((item) => item.ts)).toEqual([
      "2026-09-10",
      "2026-09-11",
    ]);
    // 不传复权类型时返回该周期的全部复权数据。
    expect(await store.klines.list("600519", "day")).toHaveLength(4);
    expect(await store.klines.list("600519", "minute")).toHaveLength(1);
    expect(await store.klines.list("000001", "day", "qfq")).toHaveLength(1);
  });
});

describe("资讯仓库", () => {
  it("按代码倒序返回、支持状态更新与到期筛选", async () => {
    const store = createMemoryStore();
    await store.newsItems.insert(news("news-1", { published_at: "2026-09-01T02:00:00.000Z" }));
    await store.newsItems.insert(news("news-2", { published_at: "2026-09-05T02:00:00.000Z" }));
    await store.newsItems.insert(news("news-3", { code: "000001" }));

    const list = await store.newsItems.listByCode("600519");
    expect(list.map((item) => item.id)).toEqual(["news-2", "news-1"]);

    await store.newsItems.updateStatus("news-1", "expired");
    expect((await store.newsItems.listByCode("600519")).find((item) => item.id === "news-1")?.status)
      .toBe("expired");

    const expired = await store.newsItems.listExpired("2026-10-15T00:00:00.000Z");
    expect(expired.map((item) => item.id).sort()).toEqual(["news-1", "news-2", "news-3"]);
    // 置顶资讯不参与到期清理。
    await store.newsItems.insert(news("news-4", { pinned: true, expire_at: "2026-08-01T00:00:00.000Z" }));
    expect((await store.newsItems.listExpired("2026-10-15T00:00:00.000Z")).map((item) => item.id))
      .not.toContain("news-4");
  });
});

describe("报告仓库", () => {
  it("按代码倒序返回并支持删除", async () => {
    const store = createMemoryStore();
    await store.analysisReports.insert(report("report-1", "2026-09-01T00:00:00.000Z"));
    await store.analysisReports.insert(report("report-2", "2026-09-05T00:00:00.000Z"));

    expect((await store.analysisReports.listByCode("600519")).map((item) => item.id)).toEqual([
      "report-2",
      "report-1",
    ]);
    await store.analysisReports.deleteById("report-2");
    expect((await store.analysisReports.listByCode("600519")).map((item) => item.id)).toEqual([
      "report-1",
    ]);
  });
});

describe("会话与消息仓库", () => {
  it("会话支持增删查", async () => {
    const store = createMemoryStore();
    await store.conversations.create(conversation("conv-1", "2026-09-01T00:00:00.000Z"));
    await store.conversations.create(conversation("conv-2", "2026-09-05T00:00:00.000Z"));

    expect((await store.conversations.getById("conv-1"))?.title).toBe("会话 conv-1");
    expect(await store.conversations.getById("missing")).toBeNull();
    expect((await store.conversations.listByCode("600519")).map((item) => item.id)).toEqual([
      "conv-2",
      "conv-1",
    ]);

    await store.conversations.delete("conv-1");
    expect(await store.conversations.getById("conv-1")).toBeNull();
  });

  it("消息按会话升序返回并可整会话删除", async () => {
    const store = createMemoryStore();
    await store.messages.insert(message("msg-2", "2026-09-01T00:00:02.000Z"));
    await store.messages.insert(message("msg-1", "2026-09-01T00:00:01.000Z"));
    await store.messages.insert(message("msg-3", "2026-09-01T00:00:03.000Z", "conv-2"));

    expect((await store.messages.listByConversation("conv-1")).map((item) => item.id)).toEqual([
      "msg-1",
      "msg-2",
    ]);
    await store.messages.deleteByConversation("conv-1");
    expect(await store.messages.listByConversation("conv-1")).toEqual([]);
    expect((await store.messages.listByConversation("conv-2")).map((item) => item.id)).toEqual([
      "msg-3",
    ]);
  });
});

describe("任务运行仓库", () => {
  it("按开始时间倒序返回并遵守条数上限", async () => {
    const store = createMemoryStore();
    await store.jobRuns.insert(jobRun("run-1", "2026-09-13T01:00:00.000Z"));
    await store.jobRuns.insert(jobRun("run-2", "2026-09-13T03:00:00.000Z"));
    await store.jobRuns.insert(jobRun("run-3", "2026-09-13T02:00:00.000Z"));

    expect((await store.jobRuns.listRecent()).map((item) => item.id)).toEqual([
      "run-2",
      "run-3",
      "run-1",
    ]);
    expect((await store.jobRuns.listRecent(2)).map((item) => item.id)).toEqual(["run-2", "run-3"]);
  });
});
