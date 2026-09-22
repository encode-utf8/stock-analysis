"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { AlertPanel } from "@/components/panels/AlertPanel";
import { AnalysisPanel } from "@/components/panels/AnalysisPanel";
import { ChartPanel } from "@/components/panels/ChartPanel";
import { ChatPanel, type ChatViewMessage } from "@/components/panels/ChatPanel";
import {
  applyTraceSnapshot,
  clearTrace,
  finishTrace,
  IDLE_TRACE_STATE,
  useAgentTracePolicy,
  useTraceAutoClear,
  type AgentTraceViewState,
} from "@/lib/agent-trace-client";
import {
  apiErrorFromPayload,
  clearDatasourceFailure,
  datasourceErrorFromStreamData,
  guardDatasourceError,
  useDatasourceGuard,
} from "@/lib/datasource-guard-client";
import {
  isUnusableConversationTitle,
  sanitizeChatText,
} from "@/lib/format";
import { DailyReportPanel } from "@/components/panels/DailyReportPanel";
import { DataSourcePanel } from "@/components/panels/DataSourcePanel";
import { DisclaimerFooter } from "@/components/panels/DisclaimerFooter";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_MODULE_VISIBILITY,
  FunctionOptionsSidebar,
  MODULE_OPTIONS,
  MODULE_SCOPES,
  type ModuleKey,
} from "@/components/panels/FunctionOptionsSidebar";
import { IndicatorsPanel } from "@/components/panels/IndicatorsPanel";
import { ModuleMenuBar } from "@/components/panels/ModuleMenuBar";
import {
  hasEnabledInScope,
  moduleOptionsForScope,
  moduleVisibilityForScope,
  primaryModuleForScope,
  type ModuleScope,
} from "@/components/panels/module-scope";
import { NewsPanel } from "@/components/panels/NewsPanel";
import {
  ObservabilityPanel,
  type ObservabilityData,
} from "@/components/panels/ObservabilityPanel";
import { QuotePanel } from "@/components/panels/QuotePanel";
import { RealtimeQuoteBar } from "@/components/panels/RealtimeQuoteBar";
import { ReplayPanel } from "@/components/panels/ReplayPanel";
import { StockBacktestPanel } from "@/components/panels/stock/StockBacktestPanel";
import { StockPortfolioPanel } from "@/components/panels/stock/StockPortfolioPanel";
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
      // 数据源故障会被转换为可识别的专用错误，由守卫统一进入冷却。
      throw apiErrorFromPayload(payload);
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

export default function StockWorkbench() {
  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarPeek, setSidebarPeek] = useState(false);
  const [enabledModules, setEnabledModules] = useState<Record<ModuleKey, boolean>>(
    DEFAULT_MODULE_VISIBILITY,
  );
  const [moduleOrder, setModuleOrder] = useState<ModuleKey[]>(
    MODULE_OPTIONS.map((option) => option.key),
  );
  // 模块分组：默认展示「当前标的」，账户级工具收在「持仓与全局工具」分组里。
  const [activeScope, setActiveScope] = useState<ModuleScope>("target");
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
  const [traceState, setTraceState] = useState<AgentTraceViewState>(IDLE_TRACE_STATE);
  // 数据源故障守卫：统一提示并禁用触发按钮 10 秒。
  const datasourceGuard = useDatasourceGuard();
  const [analysisTraceState, setAnalysisTraceState] =
    useState<AgentTraceViewState>(IDLE_TRACE_STATE);
  const [tracePolicy] = useAgentTracePolicy();

  // 轨迹结束后按留存策略清理：瞬时策略延时移除，保留策略折叠保留。
  const clearChatTrace = useCallback(() => setTraceState(clearTrace), []);
  const clearAnalysisTrace = useCallback(() => setAnalysisTraceState(clearTrace), []);
  useTraceAutoClear(traceState, tracePolicy, clearChatTrace);
  useTraceAutoClear(analysisTraceState, tracePolicy, clearAnalysisTrace);
  const [chatInput, setChatInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState<string | null>(null);
  const [replayRefreshToken, setReplayRefreshToken] = useState(0);
  const [lastDeletedReportId, setLastDeletedReportId] = useState<string | null>(null);
  const activeCodeRef = useRef<string | null>(null);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const analysisDraftIdRef = useRef<string | null>(null);
  const analysisRealReportIdRef = useRef<string | null>(null);

  const toggleModule = (key: ModuleKey) => {
    setEnabledModules((previous) => ({ ...previous, [key]: !previous[key] }));
  };

  // 全选 / 清空只作用于当前分组，另一分组的勾选状态原样保留。
  const selectAllModules = () => {
    setEnabledModules((previous) => ({
      ...previous,
      ...moduleVisibilityForScope(MODULE_OPTIONS, activeScope, true),
    }));
  };

  const clearAllModules = () => {
    setEnabledModules((previous) => ({
      ...previous,
      ...moduleVisibilityForScope(MODULE_OPTIONS, activeScope, false),
    }));
  };

  /**
   * 看某只票就等于看「当前标的」分组：切换标的时回到该分组，
   * 并在该分组从未勾选时启用默认模块（行情概览），避免切过去一片空白。
   */
  const focusTargetScope = useCallback(() => {
    setActiveScope("target");
    setEnabledModules((previous) =>
      hasEnabledInScope(MODULE_OPTIONS, "target", previous)
        ? previous
        : {
            ...previous,
            [primaryModuleForScope(MODULE_OPTIONS, "target")?.key ?? "quote"]: true,
          },
    );
  }, []);

  const reorderModule = (fromKey: ModuleKey, toKey: ModuleKey) => {
    setModuleOrder((previous) => {
      const fromIndex = previous.indexOf(fromKey);
      const toIndex = previous.indexOf(toKey);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
        return previous;
      }
      const next = [...previous];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
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
        setConversations(
          data.filter((conversation) => !isUnusableConversationTitle(conversation.title)),
        );
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
      // 请求成功说明数据源已恢复，清除故障提示与冷却。
      clearDatasourceFailure();
    } catch (nextError) {
      if (activeCodeRef.current === nextCode) {
        setNews([]);
        // 数据源故障由守卫统一提示并进入 10 秒冷却。
        if (!guardDatasourceError(nextError)) {
          setError(nextError instanceof Error ? nextError.message : "资讯搜索失败。");
        }
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
        clearDatasourceFailure();
      } catch (nextError) {
        // 数据源故障由守卫统一提示并进入 10 秒冷却。
        if (!guardDatasourceError(nextError)) {
          setError(nextError instanceof Error ? nextError.message : "盘面数据加载失败。");
        }
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
        clearDatasourceFailure();
        setMessages([]);
        setConversationId(undefined);
        setConversations([]);
        setLoading(false);
        void loadConversations(nextCode);
        void loadObservability();
        void loadReports(nextCode);
      } catch (nextError) {
        // 数据源故障由守卫统一提示并进入 10 秒冷却。
        if (!guardDatasourceError(nextError)) {
          setError(nextError instanceof Error ? nextError.message : "股票查询失败。");
        }
      } finally {
        setLoading(false);
      }
    },
    [loadConversations, loadReports, loadObservability],
  );

  /** 自选股切换：直接复用主查询链路，确保盘面、资讯、对话全链路一致，并回到标的视图。 */
  const handleWatchlistSelect = useCallback(
    (nextCode: string) => {
      setInput(nextCode);
      focusTargetScope();
      void refreshStock(nextCode);
    },
    [focusTargetScope, refreshStock],
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
    // 查询新代码即为「看这只票」：切回当前标的分组，结果立即可见。
    focusTargetScope();
    void refreshStock(nextInput);
  };

  const handleAnalysis = async () => {
    if (!code || analysisLoading || analysisAbortRef.current) {
      return;
    }
    const controller = new AbortController();
    const draftId = `analysis-stream-${Date.now()}`;
    analysisAbortRef.current = controller;
    analysisDraftIdRef.current = draftId;
    analysisRealReportIdRef.current = null;
    setAnalysisLoading(true);
    setAnalysisTraceState(IDLE_TRACE_STATE);
    let completed = false;
    setError(null);
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
        signal: controller.signal,
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

        if (event.type === "meta" && event.data?.reportId) {
          analysisRealReportIdRef.current = event.data.reportId;
        } else if (event.type === "delta" && event.content) {
          setReports((previous) =>
            previous.map((item) =>
              item.id === draftId
                ? { ...item, content: item.content + event.content }
                : item,
            ),
          );
        } else if (event.type === "trace" && event.data?.trace) {
          const snapshot = event.data.trace;
          setAnalysisTraceState((previous) => applyTraceSnapshot(previous, snapshot));
        } else if (event.type === "done" && event.data?.report) {
          completed = true;
          setReports((previous) =>
            previous.map((item) => (item.id === draftId ? event.data?.report ?? item : item)),
          );
          setAnalysisTraceState((previous) => finishTrace(previous, "done"));
        } else if (event.type === "error") {
          setAnalysisTraceState((previous) => finishTrace(previous, "error"));
          // 数据源故障按冷却处理，其它错误按普通提示处理。
          throw (
            datasourceErrorFromStreamData(event.data) ??
            new Error(event.data?.message ?? "分析生成失败。")
          );
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
      if (!completed) {
        throw new Error("分析生成中断，未收到完整报告。");
      }

      clearDatasourceFailure();
      await loadObservability();
    } catch (nextError) {
      if (nextError instanceof Error && nextError.name === "AbortError") {
        return;
      }
      setAnalysisTraceState((previous) => finishTrace(previous, "error"));
      if (!guardDatasourceError(nextError)) {
        setError(nextError instanceof Error ? nextError.message : "分析生成失败。");
      }
      setReports((previous) => previous.filter((item) => item.id !== draftId));
    } finally {
      if (analysisAbortRef.current === controller) {
        analysisAbortRef.current = null;
        analysisDraftIdRef.current = null;
        analysisRealReportIdRef.current = null;
      }
      setAnalysisLoading(false);
    }
  };

  const stopAnalysis = async () => {
    if (!code) {
      return;
    }
    const reportId = analysisRealReportIdRef.current;
    if (reportId) {
      try {
        const response = await fetch(
          `/api/stocks/${encodeURIComponent(code)}/analysis/stop`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reportId }),
          },
        );
        if (response.ok) {
          setAnalysisLoading(false);
          return;
        }
      } catch {
        // 停止接口不可用时退回前端中断，仍会停止生成。
      }
    }
    analysisAbortRef.current?.abort();
    setAnalysisTraceState(IDLE_TRACE_STATE);
    setAnalysisLoading(false);
  };

  const handleDeleteReport = async (reportId: string) => {
    if (!code) {
      return;
    }

    if (analysisDraftIdRef.current === reportId) {
      analysisAbortRef.current?.abort();
      setAnalysisTraceState(IDLE_TRACE_STATE);
      setReports((previous) => previous.filter((report) => report.id !== reportId));
      setAnalysisLoading(false);
      return;
    }

    try {
      await apiFetch<{ id: string }>(
        `/api/stocks/${encodeURIComponent(code)}/reports/${encodeURIComponent(reportId)}`,
        { method: "DELETE" },
      );
      setReports((previous) => previous.filter((report) => report.id !== reportId));
      setReplayRefreshToken((value) => value + 1);
      setLastDeletedReportId(reportId);
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
      clearDatasourceFailure();
      await refreshStock(code);
    } catch (nextError) {
      // 数据源故障由守卫统一提示并进入 10 秒冷却。
      if (!guardDatasourceError(nextError)) {
        setError(nextError instanceof Error ? nextError.message : "刷新失败。");
      }
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
    const controller = new AbortController();
    chatAbortRef.current = controller;
    setChatInput("");
    setChatLoading(true);
    setTraceState(IDLE_TRACE_STATE);
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
        signal: controller.signal,
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
        } else if (event.type === "trace" && event.data?.trace) {
          const snapshot = event.data.trace;
          setTraceState((previous) => applyTraceSnapshot(previous, snapshot));
        } else if (event.type === "done" && event.data) {
          setMessages((previous) =>
            previous.map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    sources: event.data?.sources,
                    riskNote: event.data?.riskNote,
                    aiInvoked: event.data?.aiInvoked,
                  }
                : message,
            ),
          );
          setTraceState((previous) => finishTrace(previous, "done"));
        } else if (event.type === "error") {
          setTraceState((previous) => finishTrace(previous, "error"));
          // 数据源故障按冷却处理，其它错误按普通提示处理。
          throw (
            datasourceErrorFromStreamData(event.data) ??
            new Error(event.data?.message ?? "对话生成失败。")
          );
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

      clearDatasourceFailure();
      await Promise.all([loadObservability(), loadConversations(code)]);
    } catch (nextError) {
      if (nextError instanceof Error && nextError.name === "AbortError") {
        return;
      }
      setTraceState((previous) => finishTrace(previous, "error"));
      if (!guardDatasourceError(nextError)) {
        setError(nextError instanceof Error ? nextError.message : "对话生成失败。");
      }
      setMessages((previous) => previous.filter((message) => message.id !== assistantId));
    } finally {
      if (chatAbortRef.current === controller) {
        chatAbortRef.current = null;
      }
      setChatLoading(false);
    }
  };

  const stopChat = () => {
    chatAbortRef.current?.abort();
    setTraceState(IDLE_TRACE_STATE);
    setChatLoading(false);
  };

  const loadConversationTimeline = async (id: string) => {
    try {
      const timeline = await apiFetch<ConversationTimeline>(`/api/conversations/${id}`);
      setConversationId(id);
      setMessages(
        timeline.messages.map((message) => ({
          id: message.id,
          role: message.role === "user" ? "user" : "assistant",
          content: sanitizeChatText(message.content),
        })),
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "会话加载失败。");
    }
  };

  // 分组视图：只渲染当前分组已勾选的模块，两类内容不再混排。
  const scopedOptions = moduleOptionsForScope(MODULE_OPTIONS, activeScope);
  const visibleModuleKeys = moduleOrder.filter(
    (key) => enabledModules[key] && scopedOptions.some((option) => option.key === key),
  );
  const scopeStats: Record<ModuleScope, { enabled: number; total: number }> = {
    target: { enabled: 0, total: 0 },
    global: { enabled: 0, total: 0 },
  };
  for (const option of MODULE_OPTIONS) {
    scopeStats[option.scope].total += 1;
    if (enabledModules[option.key]) {
      scopeStats[option.scope].enabled += 1;
    }
  }
  const primaryModule = primaryModuleForScope(MODULE_OPTIONS, activeScope);
  /** 分组说明：标的组直接给出当前股票，工具组说明与标的无关。 */
  const scopeNote =
    activeScope === "target"
      ? stock
        ? `当前标的：${stock.name}（${code}）· 本组模块随标的切换`
        : "本组模块随当前标的切换"
      : "本组与当前股票无关：账户级工具与自带代码输入的独立工具";

  const renderStockModule = (key: ModuleKey) => {
    if (key === "quote") {
      return enabledModules.quote && stock && quote ? <QuotePanel stock={stock} quote={quote} /> : null;
    }
    if (key === "chart") {
      return enabledModules.chart && stock && quote ? (
        <ChartPanel
          stock={stock}
          quote={quote}
          klines={klines}
          period={period}
          adjust={adjust}
          loading={chartLoading}
          blocked={datasourceGuard.blocked}
          onPeriodChange={(value) => setPeriod(value)}
          onAdjustChange={(value) => setAdjust(value)}
        />
      ) : null;
    }
    if (key === "indicators") {
      return enabledModules.indicators ? <IndicatorsPanel indicators={indicators} klines={klines} /> : null;
    }
    if (key === "news") {
      return enabledModules.news && stock && quote ? (
        <NewsPanel
          news={news}
          loading={newsLoading}
          analysisLoading={analysisLoading}
          blocked={datasourceGuard.blocked}
          newsRangeDays={newsRangeDays}
          onRangeChange={setNewsRangeDays}
          onSearch={() => void handleNewsSearch()}
          onGenerateAnalysis={() => void handleAnalysis()}
          onStopAnalysis={stopAnalysis}
        />
      ) : null;
    }
    if (key === "analysis") {
      return enabledModules.analysis && stock && quote ? (
        <AnalysisPanel
          reports={reports}
          loading={reportsLoading}
          onDelete={handleDeleteReport}
          trace={analysisTraceState}
          tracePolicy={tracePolicy}
        />
      ) : null;
    }
    if (key === "chat") {
      return enabledModules.chat && code ? (
        <ChatPanel
          code={code}
          conversationId={conversationId}
          messages={messages}
          input={chatInput}
          loading={chatLoading}
          blocked={datasourceGuard.blocked}
          onInputChange={(value) => setChatInput(value)}
          onSubmit={handleChatSubmit}
          onStop={stopChat}
          trace={traceState}
          tracePolicy={tracePolicy}
        />
      ) : null;
    }
    if (key === "timeline") {
      return enabledModules.timeline && code ? (
        <TimelinePanel
          conversations={conversations}
          conversationId={conversationId}
          onSelectConversation={(id) => void loadConversationTimeline(id)}
        />
      ) : null;
    }
    if (key === "observability") {
      return enabledModules.observability ? (
        <ObservabilityPanel
          observability={observability}
          onRefresh={() => void loadObservability()}
        />
      ) : null;
    }
    if (key === "replay") {
      return enabledModules.replay ? (
        <ReplayPanel
          key={code ?? "none"}
          code={code}
          refreshToken={replayRefreshToken}
          deletedReportId={lastDeletedReportId}
        />
      ) : null;
    }
    if (key === "portfolio") {
      // 持仓列表与自选共用切换入口：点击持仓标的即复用主查询链路刷新全盘面。
      return enabledModules.portfolio ? (
        <StockPortfolioPanel activeCode={code} onSelectTarget={handleWatchlistSelect} />
      ) : null;
    }
    if (key === "backtest") {
      return enabledModules.backtest ? <StockBacktestPanel /> : null;
    }
    if (key === "datasource") {
      return enabledModules.datasource ? <DataSourcePanel /> : null;
    }
    if (key === "alerts") {
      return enabledModules.alerts ? <AlertPanel target="stock" /> : null;
    }
    if (key === "daily-report") {
      return enabledModules["daily-report"] ? <DailyReportPanel kind="stock" /> : null;
    }
    return null;
  };

  return (
    <div>
      <div className="mx-auto flex min-h-screen max-w-[1440px]">
        <div
          className="relative shrink-0"
          onMouseEnter={() => setSidebarPeek(true)}
          onMouseLeave={() => setSidebarPeek(false)}
        >
          <div
            className={
              "sticky top-[var(--app-header-h)] h-[calc(100vh_-_var(--app-header-h))] overflow-hidden border-r border-border bg-card/70 backdrop-blur-xl transition-[width] duration-300 ease-out " +
              (sidebarOpen || sidebarPeek ? "w-80" : "w-10")
            }
          >
            {sidebarOpen || sidebarPeek ? (
              <FunctionOptionsSidebar
                input={input}
                loading={loading}
                blocked={datasourceGuard.blocked}
                code={code}
                activeCode={code}
                onInputChange={(value) => setInput(value)}
                onSearch={handleSearch}
                onRefresh={() => void handleRefresh()}
                onCleanup={() => void handleCleanup()}
                onWatchlistSelect={handleWatchlistSelect}
                onWatchlistClearActive={handleWatchlistClear}
                pinned={sidebarOpen}
                onToggle={() => setSidebarOpen((previous) => !previous)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                aria-label="展开自选侧栏"
                className="flex h-full w-full flex-col items-center pt-3 text-muted-foreground transition-colors hover:bg-accent"
              >
                <span className="text-xs font-medium tracking-[0.35em] [writing-mode:vertical-rl]">
                  自选
                </span>
              </button>
            )}
          </div>
        </div>

        <section className="min-w-0 flex-1 px-4 py-6">
          <div className="mx-auto flex max-w-6xl flex-col gap-4">
            {/* 标题改为紧凑单行，把纵向空间让给模块内容。 */}
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h1 className="tech-title text-xl font-semibold tracking-tight">个股盘面分析与 AI 学习台</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  顶部模块菜单分两组：「当前标的」随股票切换，「持仓与全局工具」与标的无关（持仓、回测、预警、日报等）。
                </p>
              </div>
              <div className="text-xs text-muted-foreground">
                当前时间：{currentTime ?? "正在同步..."}
              </div>
            </div>

            <ModuleMenuBar
              scopes={MODULE_SCOPES}
              activeScope={activeScope}
              onScopeChange={setActiveScope}
              scopeStats={scopeStats}
              scopeNote={scopeNote}
              options={scopedOptions}
              enabledModules={enabledModules}
              moduleOrder={moduleOrder}
              onToggleModule={toggleModule}
              onReorderModule={reorderModule}
              onSelectAll={selectAllModules}
              onClearAll={clearAllModules}
            />

            <RealtimeQuoteBar target="stock" />

            {error ? (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            ) : null}


            {visibleModuleKeys.length > 0 ? (
              <div className="flex flex-col gap-6">
                {visibleModuleKeys.map((key) => (
                  <Fragment key={key}>{renderStockModule(key)}</Fragment>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[420px] items-center justify-center tech-panel tech-panel-dashed p-8 text-center">
                <div>
                  <h2 className="text-lg font-semibold">
                    {activeScope === "target"
                      ? "「当前标的」分组还没有勾选模块"
                      : "「持仓与全局工具」分组还没有勾选模块"}
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {activeScope === "target"
                      ? "本组模块随当前股票切换，勾选后即展示在当前代码下；留空代码时默认展示 600519。"
                      : "本组与当前股票无关（账户级数据与自带代码输入的独立工具），可独立勾选、与标的互不影响。"}
                  </p>
                  {primaryModule ? (
                    <Button
                      type="button"
                      className="mt-4"
                      onClick={() =>
                        setEnabledModules((previous) => ({ ...previous, [primaryModule.key]: true }))
                      }
                    >
                      启用「{primaryModule.label}」
                    </Button>
                  ) : null}
                </div>
              </div>
            )}
            <DisclaimerFooter quote={quote} />
          </div>
        </section>
      </div>
    </div>
  );
}
