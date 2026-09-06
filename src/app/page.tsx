"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { AnalysisPanel } from "@/components/panels/AnalysisPanel";
import { ChartPanel } from "@/components/panels/ChartPanel";
import { ChatPanel, type ChatViewMessage } from "@/components/panels/ChatPanel";
import { DataSourcePanel } from "@/components/panels/DataSourcePanel";
import { DisclaimerFooter } from "@/components/panels/DisclaimerFooter";
import {
  ALL_MODULE_VISIBILITY,
  DEFAULT_MODULE_VISIBILITY,
  FunctionOptionsSidebar,
  type ModuleKey,
} from "@/components/panels/FunctionOptionsSidebar";
import { IndicatorsPanel } from "@/components/panels/IndicatorsPanel";
import { NewsPanel } from "@/components/panels/NewsPanel";
import {
  ObservabilityPanel,
  type ObservabilityData,
} from "@/components/panels/ObservabilityPanel";
import { QuotePanel } from "@/components/panels/QuotePanel";
import { ReplayPanel } from "@/components/panels/ReplayPanel";
import { TimelinePanel } from "@/components/panels/TimelinePanel";

import type {
  AdjustType,
  AnalysisReport,
  AnalysisStreamEvent,
  ChatStreamEvent,
  Conversation,
  JobRun,
  Kline,
  KlinePeriod,
  MarketQuote,
  Message,
  NewsItem,
  Stock,
  TechnicalIndicators,
} from "@/lib/shared/types";

interface ConversationTimeline {
  conversation: Conversation;
  messages: Message[];
}

const REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_STOCK_CODE = "600519";

async function apiFetch<T>(url: string, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload = (await response.json().catch(() => null)) as {
      success?: boolean;
      data?: T;
      error?: { message?: string };
    } | null;
    if (!payload?.success || payload.data === undefined) {
      throw new Error(payload?.error?.message ?? "请求失败。");
    }
    return payload.data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("请求超时，请稍后重试。");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export default function Home() {
  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarPeek, setSidebarPeek] = useState(false);
  const [enabledModules, setEnabledModules] = useState<Record<ModuleKey, boolean>>(
    DEFAULT_MODULE_VISIBILITY,
  );
  const [code, setCode] = useState<string | null>(null);
  const [stock, setStock] = useState<Stock | null>(null);
  const [quote, setQuote] = useState<MarketQuote | null>(null);
  const [klines, setKlines] = useState<Kline[]>([]);
  const [indicators, setIndicators] = useState<TechnicalIndicators | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [newsRangeDays, setNewsRangeDays] = useState(30);
  const [reports, setReports] = useState<AnalysisReport[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<ChatViewMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [observability, setObservability] = useState<ObservabilityData | null>(null);
  const [period, setPeriod] = useState<KlinePeriod>("day");
  const [adjust, setAdjust] = useState<AdjustType>("qfq");
  const [loading, setLoading] = useState(false);
  const [chartLoading, setChartLoading] = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState<string | null>(null);
  const activeCodeRef = useRef<string | null>(null);

  const toggleModule = (key: ModuleKey) => {
    setEnabledModules((previous) => ({ ...previous, [key]: !previous[key] }));
  };

  const selectAllModules = () => {
    setEnabledModules(ALL_MODULE_VISIBILITY);
  };

  const clearAllModules = () => {
    setEnabledModules(DEFAULT_MODULE_VISIBILITY);
  };

  const loadObservability = useCallback(async () => {
    try {
      const data = await apiFetch<ObservabilityData>("/api/admin/observability");
      setObservability(data);
    } catch {
      setObservability(null);
    }
  }, []);

  const loadConversations = useCallback(async (nextCode: string) => {
    try {
      const data = await apiFetch<Conversation[]>(
        `/api/conversations?code=${encodeURIComponent(nextCode)}`,
      );
      if (activeCodeRef.current === nextCode) {
        setConversations(data);
      }
    } catch {
      if (activeCodeRef.current === nextCode) {
        setConversations([]);
      }
    }
  }, []);

  /** 仅加载历史报告，资讯改为按需搜索，避免查询股票时一并触发。 */
  const loadReports = useCallback(async (nextCode: string): Promise<void> => {
    setReportsLoading(true);
    try {
      const data = await apiFetch<AnalysisReport[]>(
        `/api/stocks/${encodeURIComponent(nextCode)}/reports`,
      );
      if (activeCodeRef.current === nextCode) {
        setReports(data);
      }
    } catch {
      if (activeCodeRef.current === nextCode) {
        setReports([]);
      }
    } finally {
      if (activeCodeRef.current === nextCode) {
        setReportsLoading(false);
      }
    }
  }, []);

  /** 按当前时间范围搜索资讯，与股票查询解耦。 */
  const loadNewsByRange = useCallback(async (nextCode: string, days: number): Promise<void> => {
    setNewsLoading(true);
    setError(null);
    try {
      const data = await apiFetch<NewsItem[]>(
        `/api/stocks/${encodeURIComponent(nextCode)}/news?days=${days}&refresh=1`,
      );
      if (activeCodeRef.current === nextCode) {
        setNews(data);
      }
    } catch (nextError) {
      if (activeCodeRef.current === nextCode) {
        setNews([]);
        setError(nextError instanceof Error ? nextError.message : "资讯搜索失败。");
      }
    } finally {
      if (activeCodeRef.current === nextCode) {
        setNewsLoading(false);
      }
    }
  }, []);

  const handleNewsSearch = useCallback(async () => {
    if (!code || newsLoading) {
      return;
    }
    await loadNewsByRange(code, newsRangeDays);
  }, [code, newsLoading, newsRangeDays, loadNewsByRange]);

  const loadChart = useCallback(
    async (nextCode: string, nextPeriod: KlinePeriod, nextAdjust: AdjustType) => {
      setChartLoading(true);
      try {
        const [klineData, indicatorData] = await Promise.all([
          apiFetch<Kline[]>(
            `/api/stocks/${nextCode}/kline?period=${nextPeriod}&adjust=${nextAdjust}&limit=120`,
          ),
          apiFetch<TechnicalIndicators>(
            `/api/stocks/${nextCode}/indicators?period=${nextPeriod}`,
          ),
        ]);
        setKlines(klineData);
        setIndicators(indicatorData);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "盘面数据加载失败。");
      } finally {
        setChartLoading(false);
      }
    },
    [],
  );

  const refreshStock = useCallback(
    async (nextInput: string) => {
      const nextCode = nextInput.trim();
      activeCodeRef.current = nextCode;
      setLoading(true);
      setError(null);
      setNews([]);
      setReports([]);
      try {
        const [stockData, quoteData] = await Promise.all([
          apiFetch<Stock>(`/api/stocks/${encodeURIComponent(nextCode)}/profile`),
          apiFetch<MarketQuote>(`/api/stocks/${encodeURIComponent(nextCode)}/quote`),
        ]);
        setCode(nextCode);
        setStock(stockData);
        setQuote(quoteData);
        setMessages([]);
        setConversationId(undefined);
        setConversations([]);
        setLoading(false);
        void loadConversations(nextCode);
        void loadObservability();
        void loadReports(nextCode);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "股票查询失败。");
      } finally {
        setLoading(false);
      }
    },
    [loadConversations, loadReports, loadObservability],
  );

  /** 自选股切换：直接复用主查询链路，确保盘面、资讯、对话全链路一致。 */
  const handleWatchlistSelect = useCallback(
    (nextCode: string) => {
      setInput(nextCode);
      void refreshStock(nextCode);
    },
    [refreshStock],
  );

  /** 删除当前自选股时清空已选盘面，避免继续展示已移除股票。 */
  const handleWatchlistClear = useCallback(() => {
    setCode(null);
    setStock(null);
    setQuote(null);
    setKlines([]);
    setIndicators(null);
    setNews([]);
    setReports([]);
    setConversations([]);
    setMessages([]);
    setConversationId(undefined);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void refreshStock(DEFAULT_STOCK_CODE), 0);
    return () => clearTimeout(timer);
  }, [refreshStock]);

  useEffect(() => {
    const updateCurrentTime = () => {
      setCurrentTime(new Date().toLocaleString("zh-CN", { hour12: false }));
    };
    updateCurrentTime();
    const timer = setInterval(updateCurrentTime, 1_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!code) {
      return;
    }
    const timer = setTimeout(() => void loadChart(code, period, adjust), 0);
    return () => clearTimeout(timer);
  }, [code, period, adjust, loadChart]);

  const handleSearch = () => {
    const nextInput = input.trim() || DEFAULT_STOCK_CODE;
    if (loading) {
      return;
    }
    setInput(nextInput);
    void refreshStock(nextInput);
  };

  const handleAnalysis = async () => {
    if (!code || analysisLoading) {
      return;
    }
    setAnalysisLoading(true);
    setError(null);
    const draftId = `analysis-stream-${Date.now()}`;
    const draftReport: AnalysisReport = {
      id: draftId,
      code,
      created_at: new Date().toISOString(),
      data_snapshot: null,
      news_refs: [],
      content: "",
      risk_note: "",
    };

    try {
      setReports((previous) => [draftReport, ...previous.filter((item) => item.id !== draftId)]);

      const response = await fetch(`/api/stocks/${encodeURIComponent(code)}/analysis/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "请生成当前盘面与资讯分析。", news }),
      });
      if (!response.ok || !response.body) {
        throw new Error("分析接口响应异常。");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handleEvent = (raw: string) => {
        const dataLine = raw.split("\n").find((line) => line.startsWith("data: "));
        if (!dataLine) {
          return;
        }
        const event = JSON.parse(dataLine.slice(6)) as AnalysisStreamEvent;

        if (event.type === "delta" && event.content) {
          setReports((previous) =>
            previous.map((item) =>
              item.id === draftId
                ? { ...item, content: item.content + event.content }
                : item,
            ),
          );
        } else if (event.type === "done" && event.data?.report) {
          setReports((previous) =>
            previous.map((item) => (item.id === draftId ? event.data?.report ?? item : item)),
          );
        } else if (event.type === "error") {
          throw new Error(event.data?.message ?? "分析生成失败。");
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          handleEvent(block);
        }
      }
      if (buffer.trim()) {
        handleEvent(buffer);
      }

      await loadObservability();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "分析生成失败。");
      setReports((previous) => previous.filter((item) => item.id !== draftId));
    } finally {
      setAnalysisLoading(false);
    }
  };

  const handleDeleteReport = async (reportId: string) => {
    if (!code) {
      return;
    }

    try {
      await apiFetch<{ id: string }>(
        `/api/stocks/${encodeURIComponent(code)}/reports/${encodeURIComponent(reportId)}`,
        { method: "DELETE" },
      );
      setReports((previous) => previous.filter((report) => report.id !== reportId));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "分析报告删除失败。");
    }
  };

  const handleRefresh = async () => {
    if (!code) {
      return;
    }
    try {
      await apiFetch<JobRun>("/api/admin/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      await refreshStock(code);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "刷新失败。");
    }
  };

  const handleCleanup = async () => {
    try {
      await apiFetch<JobRun>("/api/admin/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dry_run: false }),
      });
      await loadObservability();
      if (code) {
        setNews(
          await apiFetch<NewsItem[]>(
            `/api/stocks/${encodeURIComponent(code)}/news?days=${newsRangeDays}&refresh=1`,
          ),
        );
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "清理失败。");
    }
  };

  const handleChatSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!code || !chatInput.trim() || chatLoading) {
      return;
    }

    const userText = chatInput.trim();
    setChatInput("");
    setChatLoading(true);
    const localUserId = `local-user-${Date.now()}`;
    const assistantId = `local-assistant-${Date.now()}`;
    setMessages((previous) => [
      ...previous,
      { id: localUserId, role: "user", content: userText },
      { id: assistantId, role: "assistant", content: "" },
    ]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, conversationId, message: userText }),
      });
      if (!response.ok || !response.body) {
        throw new Error("对话接口响应异常。");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handleEvent = (raw: string) => {
        const dataLine = raw.split("\n").find((line) => line.startsWith("data: "));
        if (!dataLine) {
          return;
        }
        const event = JSON.parse(dataLine.slice(6)) as ChatStreamEvent;

        if (event.type === "meta" && event.data?.conversationId) {
          setConversationId(event.data.conversationId);
        } else if (event.type === "delta" && event.content) {
          setMessages((previous) =>
            previous.map((message) =>
              message.id === assistantId
                ? { ...message, content: message.content + event.content }
                : message,
            ),
          );
        } else if (event.type === "tool" && event.data?.toolCalls) {
          setMessages((previous) =>
            previous.map((message) =>
              message.id === assistantId
                ? { ...message, tools: event.data?.toolCalls }
                : message,
            ),
          );
        } else if (event.type === "done" && event.data) {
          setMessages((previous) =>
            previous.map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    sources: event.data?.sources,
                    riskNote: event.data?.riskNote,
                  }
                : message,
            ),
          );
        } else if (event.type === "error") {
          throw new Error(event.data?.message ?? "对话生成失败。");
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          handleEvent(block);
        }
      }
      if (buffer.trim()) {
        handleEvent(buffer);
      }

      await Promise.all([loadObservability(), loadConversations(code)]);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "对话生成失败。");
      setMessages((previous) => previous.filter((message) => message.id !== assistantId));
    } finally {
      setChatLoading(false);
    }
  };

  const loadConversationTimeline = async (id: string) => {
    try {
      const timeline = await apiFetch<ConversationTimeline>(`/api/conversations/${id}`);
      setConversationId(id);
      setMessages(
        timeline.messages.map((message) => ({
          id: message.id,
          role: message.role === "user" ? "user" : "assistant",
          content: message.content,
        })),
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "会话加载失败。");
    }
  };

  return (
    <main className="min-h-screen bg-muted/40 text-foreground">
      <div className="mx-auto flex min-h-screen max-w-[1440px]">
        <div
          className="relative shrink-0"
          onMouseEnter={() => setSidebarPeek(true)}
          onMouseLeave={() => setSidebarPeek(false)}
        >
          <div
            className={"sticky top-0 h-screen overflow-hidden border-r border-border bg-white transition-[width] duration-300 ease-out " + (sidebarOpen || sidebarPeek ? "w-80" : "w-10")}
          >
            {sidebarOpen || sidebarPeek ? (
              <FunctionOptionsSidebar
                input={input}
                loading={loading}
                code={code}
                activeCode={code}
                enabledModules={enabledModules}
                onInputChange={(value) => setInput(value)}
                onSearch={handleSearch}
                onRefresh={() => void handleRefresh()}
                onCleanup={() => void handleCleanup()}
                onToggleModule={toggleModule}
                onWatchlistSelect={handleWatchlistSelect}
                onWatchlistClearActive={handleWatchlistClear}
                onSelectAll={selectAllModules}
                onClearAll={clearAllModules}
                pinned={sidebarOpen}
                onToggle={() => setSidebarOpen((previous) => !previous)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                aria-label="展开功能侧栏"
                className="flex h-full w-full flex-col items-center pt-3 text-muted-foreground transition-colors hover:bg-accent"
              >
                <span className="text-xs font-medium tracking-[0.35em] [writing-mode:vertical-rl]">
                  功能选项
                </span>
              </button>
            )}
          </div>
        </div>

        <section className="min-w-0 flex-1 px-4 py-8">
          <div className="mx-auto flex max-w-6xl flex-col gap-6">
            <header className="rounded-xl border bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div>
                    <h1 className="text-2xl font-semibold tracking-tight">个股盘面分析与 AI 学习台</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                      在左侧功能选项页勾选模块，按需查看行情、资讯、AI 报告与多轮追问。
                    </p>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  当前时间：{currentTime ?? "正在同步..."}
                </div>
              </div>
            </header>

            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            {Object.values(enabledModules).some(Boolean) ? (
              <div className="flex flex-col gap-6">
                {stock && quote && enabledModules.quote ? (
                  <QuotePanel stock={stock} quote={quote} />
                ) : null}
                {stock && quote && enabledModules.chart ? (
                  <ChartPanel
                    stock={stock}
                    quote={quote}
                    klines={klines}
                    period={period}
                    adjust={adjust}
                    loading={chartLoading}
                    onPeriodChange={(value) => setPeriod(value)}
                    onAdjustChange={(value) => setAdjust(value)}
                  />
                ) : null}
                {enabledModules.indicators ? (
                  <IndicatorsPanel indicators={indicators} klines={klines} />
                ) : null}
                {stock && quote && enabledModules.news ? (
                  <NewsPanel
                    news={news}
                    loading={newsLoading}
                    analysisLoading={analysisLoading}
                    newsRangeDays={newsRangeDays}
                    onRangeChange={setNewsRangeDays}
                    onSearch={() => void handleNewsSearch()}
                    onGenerateAnalysis={() => void handleAnalysis()}
                  />
                ) : null}
                {stock && quote && enabledModules.analysis ? (
                  <AnalysisPanel
                    reports={reports}
                    loading={reportsLoading}
                    onDelete={handleDeleteReport}
                  />
                ) : null}
                {code && enabledModules.chat ? (
                  <ChatPanel
                    code={code}
                    conversationId={conversationId}
                    messages={messages}
                    input={chatInput}
                    loading={chatLoading}
                    onInputChange={(value) => setChatInput(value)}
                    onSubmit={handleChatSubmit}
                  />
                ) : null}
                {code && enabledModules.timeline ? (
                  <TimelinePanel
                    conversations={conversations}
                    conversationId={conversationId}
                    onSelectConversation={(id) => void loadConversationTimeline(id)}
                  />
                ) : null}
                {enabledModules.observability ? (
                  <ObservabilityPanel
                    observability={observability}
                    onRefresh={() => void loadObservability()}
                  />
                ) : null}
                {enabledModules.replay ? (
                  <ReplayPanel key={code ?? "none"} code={code} />
                ) : null}
                {enabledModules.datasource ? <DataSourcePanel /> : null}
                {enabledModules.disclaimer ? <DisclaimerFooter quote={quote} /> : null}
              </div>
            ) : (
              <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed bg-white p-8 text-center shadow-sm">
                <div>
                  <h2 className="text-lg font-semibold">请选择功能模块</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    在左侧“功能选项”中勾选需要展示的信息区；留空股票代码时默认展示 600519。
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
