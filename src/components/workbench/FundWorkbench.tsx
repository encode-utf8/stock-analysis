"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { AlertPanel } from "@/components/panels/AlertPanel";
import { ChatPanel, type ChatViewMessage } from "@/components/panels/ChatPanel";
import {
  isUnusableConversationTitle,
  sanitizeChatText,
} from "@/lib/format";
import { DailyReportPanel } from "@/components/panels/DailyReportPanel";
import { FundAnalysisPanel } from "@/components/panels/fund/FundAnalysisPanel";
import { FundComparisonPanel } from "@/components/panels/fund/FundComparisonPanel";
import { FundDcaPanel } from "@/components/panels/fund/FundDcaPanel";
import { FundHoldingsPanel } from "@/components/panels/fund/FundHoldingsPanel";
import { FundNewsPanel } from "@/components/panels/fund/FundNewsPanel";
import { FundIntradayPanel } from "@/components/panels/fund/FundIntradayPanel";
import { FundNavChartPanel } from "@/components/panels/fund/FundNavChartPanel";
import { FundProfilePanel } from "@/components/panels/fund/FundProfilePanel";
import { FundPortfolioPanel } from "@/components/panels/fund/FundPortfolioPanel";
import { FundPositionsPanel } from "@/components/panels/fund/FundPositionsPanel";
import { FundReplayPanel } from "@/components/panels/fund/FundReplayPanel";
import { RealtimeQuoteBar } from "@/components/panels/RealtimeQuoteBar";
import { FundRiskPanel } from "@/components/panels/fund/FundRiskPanel";
import { FundStylePanel } from "@/components/panels/fund/FundStylePanel";
import {
  FundOptionsSidebar,
  type FundModuleKey,
  DEFAULT_FUND_MODULE_VISIBILITY,
  FUND_MODULE_OPTIONS,
  FUND_MODULE_SCOPES,
} from "@/components/panels/fund/FundOptionsSidebar";
import { ModuleMenuBar } from "@/components/panels/ModuleMenuBar";
import {
  hasEnabledInScope,
  moduleOptionsForScope,
  moduleVisibilityForScope,
  primaryModuleForScope,
  type ModuleScope,
} from "@/components/panels/module-scope";
import { Button } from "@/components/ui/button";
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
import type { FundNavRange, FundNavType } from "@/lib/fund-data";
import type { FundMetricsRange } from "@/lib/fund-metrics";
import { DEFAULT_FUND_CODE, normalizeFundCode } from "@/lib/fund-market";
import type {
  ChatStreamEvent,
  FundAnalysisReport,
  FundAnalysisStreamEvent,
  FundConversation,
  FundHoldings,
  FundIntraday,
  FundNavPoint,
  FundProfile,
  FundRiskMetrics,
} from "@/lib/shared/types";

const REQUEST_TIMEOUT_MS = 20_000;

const MAX_DEFAULT_LOAD_RETRIES = 3;

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
      throw new Error("基金数据请求超时，请稍后重试。");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

interface ModulePlaceholderProps {
  /** 模块名称，作为占位卡片标题。 */
  title: string;
  /** 说明当前为什么没有内容，以及用户可以做什么。 */
  message: string;
  /** 可选补救操作文案（例如「重新查询」）。 */
  actionLabel?: string;
  onAction?: () => void;
  busy?: boolean;
}

/**
 * 模块已勾选但数据未就绪时的占位卡片。
 * 之前这些模块直接返回 null，勾选后右侧没有任何反馈，用户无法判断是没生效还是加载失败。
 */
function ModulePlaceholder({
  title,
  message,
  actionLabel,
  onAction,
  busy = false,
}: ModulePlaceholderProps) {
  return (
    <section className="tech-panel tech-panel-dashed p-6 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      {actionLabel && onAction ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-3"
          disabled={busy}
          onClick={onAction}
        >
          {busy ? "加载中..." : actionLabel}
        </Button>
      ) : null}
    </section>
  );
}

/** 基金工作台容器：管理基金代码、档案与净值展示状态。 */
export default function FundWorkbench() {
  const [input, setInput] = useState(DEFAULT_FUND_CODE);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarPeek, setSidebarPeek] = useState(false);
  const [enabledModules, setEnabledModules] = useState<Record<FundModuleKey, boolean>>(
    DEFAULT_FUND_MODULE_VISIBILITY,
  );
  const [moduleOrder, setModuleOrder] = useState<FundModuleKey[]>(
    FUND_MODULE_OPTIONS.map((option) => option.key),
  );
  // 模块分组：默认展示「当前标的」，账户级工具收在「持仓与全局工具」分组里。
  const [activeScope, setActiveScope] = useState<ModuleScope>("target");
  const [code, setCode] = useState<string | null>(null);
  const [profile, setProfile] = useState<FundProfile | null>(null);
  const [nav, setNav] = useState<FundNavPoint[]>([]);
  const [intraday, setIntraday] = useState<FundIntraday | null>(null);
  const [holdings, setHoldings] = useState<FundHoldings | null>(null);
  const [allMetrics, setAllMetrics] = useState<FundRiskMetrics | null>(null);
  const [oneYearMetrics, setOneYearMetrics] = useState<FundRiskMetrics | null>(null);
  const [chartMetrics, setChartMetrics] = useState<FundRiskMetrics | null>(null);
  const [range, setRange] = useState<FundNavRange>("1y");
  const [navType, setNavType] = useState<FundNavType>("unit");
  const [loading, setLoading] = useState(false);
  const [navLoading, setNavLoading] = useState(false);
  const [intradayLoading, setIntradayLoading] = useState(false);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [fundReports, setFundReports] = useState<FundAnalysisReport[]>([]);
  const [fundAnalysisLoading, setFundAnalysisLoading] = useState(false);
  const [fundConversationId, setFundConversationId] = useState<string | undefined>();
  const [fundMessages, setFundMessages] = useState<ChatViewMessage[]>([]);
  const [fundChatInput, setFundChatInput] = useState("");
  const [fundChatLoading, setFundChatLoading] = useState(false);
  const [fundAnalysisTraceState, setFundAnalysisTraceState] =
    useState<AgentTraceViewState>(IDLE_TRACE_STATE);
  const [fundChatTraceState, setFundChatTraceState] =
    useState<AgentTraceViewState>(IDLE_TRACE_STATE);
  const [tracePolicy] = useAgentTracePolicy();
  const [queryVersion, setQueryVersion] = useState(0);
  const [replayRefreshToken, setReplayRefreshToken] = useState(0);
  const [lastDeletedReportId, setLastDeletedReportId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 数据源故障守卫：统一提示并禁用触发按钮 10 秒。
  const datasourceGuard = useDatasourceGuard();
  const activeProfileCodeRef = useRef<string | null>(null);
  const activeNavKeyRef = useRef<string | null>(null);
  const activeIntradayCodeRef = useRef<string | null>(null);
  const activeHoldingsCodeRef = useRef<string | null>(null);
  const activeRiskMetricsCodeRef = useRef<string | null>(null);
  const activeChartMetricsKeyRef = useRef<string | null>(null);
  const fundAnalysisAbortRef = useRef<AbortController | null>(null);
  const fundChatAbortRef = useRef<AbortController | null>(null);
  const lastCompletedFundReportRef = useRef<FundAnalysisReport | null>(null);

  // 轨迹结束后按留存策略清理：瞬时策略延时移除，保留策略折叠保留。
  const clearFundAnalysisTrace = useCallback(() => setFundAnalysisTraceState(clearTrace), []);
  const clearFundChatTrace = useCallback(() => setFundChatTraceState(clearTrace), []);
  useTraceAutoClear(fundAnalysisTraceState, tracePolicy, clearFundAnalysisTrace);
  useTraceAutoClear(fundChatTraceState, tracePolicy, clearFundChatTrace);

  const toggleModule = (key: FundModuleKey) => {
    setEnabledModules((previous) => ({ ...previous, [key]: !previous[key] }));
  };

  // 全选 / 清空只作用于当前分组，另一分组的勾选状态原样保留。
  const selectAllModules = () => {
    setEnabledModules((previous) => ({
      ...previous,
      ...moduleVisibilityForScope(FUND_MODULE_OPTIONS, activeScope, true),
    }));
  };

  const clearAllModules = () => {
    setEnabledModules((previous) => ({
      ...previous,
      ...moduleVisibilityForScope(FUND_MODULE_OPTIONS, activeScope, false),
    }));
  };

  /**
   * 看某只基金就等于看「当前标的」分组：切换标的时回到该分组，
   * 并在该分组从未勾选时启用默认模块（基金档案），避免切过去一片空白。
   */
  const focusTargetScope = useCallback(() => {
    setActiveScope("target");
    setEnabledModules((previous) =>
      hasEnabledInScope(FUND_MODULE_OPTIONS, "target", previous)
        ? previous
        : {
            ...previous,
            [primaryModuleForScope(FUND_MODULE_OPTIONS, "target")?.key ?? "profile"]: true,
          },
    );
  }, []);

  const reorderModule = (fromKey: FundModuleKey, toKey: FundModuleKey) => {
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

  const loadNav = useCallback(async (nextCode: string, nextRange: FundNavRange, nextType: FundNavType) => {
    const navKey = `${nextCode}:${nextRange}:${nextType}`;
    activeNavKeyRef.current = navKey;
    setNavLoading(true);
    try {
      const data = await apiFetch<FundNavPoint[]>(
        `/api/funds/${encodeURIComponent(nextCode)}/nav?range=${nextRange}&type=${nextType}`,
      );
      if (activeNavKeyRef.current === navKey) {
        setNav(data);
      }
    } catch (nextError) {
      if (activeNavKeyRef.current === navKey) {
        setNav([]);
        // 数据源故障由守卫统一提示并进入 10 秒冷却。
        if (!guardDatasourceError(nextError)) {
          setError(nextError instanceof Error ? nextError.message : "净值加载失败。");
        }
      }
    } finally {
      if (activeNavKeyRef.current === navKey) {
        setNavLoading(false);
      }
    }
  }, []);

  const loadIntraday = useCallback(async (nextCode: string) => {
    activeIntradayCodeRef.current = nextCode;
    setIntradayLoading(true);
    try {
      const data = await apiFetch<FundIntraday>(
        `/api/funds/${encodeURIComponent(nextCode)}/intraday`,
      );
      if (activeIntradayCodeRef.current === nextCode) {
        setIntraday(data);
      }
    } catch (nextError) {
      if (activeIntradayCodeRef.current === nextCode) {
        setIntraday(null);
      }
      // 数据源故障由守卫统一提示并进入 10 秒冷却。
      guardDatasourceError(nextError);
    } finally {
      if (activeIntradayCodeRef.current === nextCode) {
        setIntradayLoading(false);
      }
    }
  }, []);

  const loadHoldings = useCallback(async (nextCode: string) => {
    activeHoldingsCodeRef.current = nextCode;
    setHoldingsLoading(true);
    try {
      const data = await apiFetch<FundHoldings>(
        `/api/funds/${encodeURIComponent(nextCode)}/holdings`,
      );
      if (activeHoldingsCodeRef.current === nextCode) {
        setHoldings(data);
      }
    } catch (nextError) {
      if (activeHoldingsCodeRef.current === nextCode) {
        setHoldings(null);
      }
      // 数据源故障由守卫统一提示并进入 10 秒冷却。
      guardDatasourceError(nextError);
    } finally {
      if (activeHoldingsCodeRef.current === nextCode) {
        setHoldingsLoading(false);
      }
    }
  }, []);

  const loadRiskMetrics = useCallback(async (nextCode: string) => {
    activeRiskMetricsCodeRef.current = nextCode;
    setMetricsLoading(true);
    try {
      const [allData, oneYearData] = await Promise.all([
        apiFetch<FundRiskMetrics>(
          `/api/funds/${encodeURIComponent(nextCode)}/metrics?range=all`,
        ),
        apiFetch<FundRiskMetrics>(
          `/api/funds/${encodeURIComponent(nextCode)}/metrics?range=1y`,
        ),
      ]);
      if (activeRiskMetricsCodeRef.current === nextCode) {
        setAllMetrics(allData);
        setOneYearMetrics(oneYearData);
      }
    } catch {
      if (activeRiskMetricsCodeRef.current === nextCode) {
        setAllMetrics(null);
        setOneYearMetrics(null);
      }
    } finally {
      if (activeRiskMetricsCodeRef.current === nextCode) {
        setMetricsLoading(false);
      }
    }
  }, []);

  const loadChartMetrics = useCallback(
    async (nextCode: string, nextRange: FundMetricsRange) => {
      const metricsKey = `${nextCode}:${nextRange}`;
      activeChartMetricsKeyRef.current = metricsKey;
      try {
        const data = await apiFetch<FundRiskMetrics>(
          `/api/funds/${encodeURIComponent(nextCode)}/metrics?range=${nextRange}`,
        );
        if (activeChartMetricsKeyRef.current === metricsKey) {
          setChartMetrics(data);
        }
      } catch {
        if (activeChartMetricsKeyRef.current === metricsKey) {
          setChartMetrics(null);
        }
      }
    },
    [],
  );

  const loadFundReports = useCallback(async (nextCode: string): Promise<FundAnalysisReport[]> => {
    try {
      const reports = await apiFetch<FundAnalysisReport[]>(
        `/api/funds/${encodeURIComponent(nextCode)}/analysis`,
      );
      setFundReports(reports);
      return reports;
    } catch {
      setFundReports([]);
      return [];
    }
  }, []);

  const loadFundConversation = useCallback(async (nextCode: string) => {
    try {
      const conversations = await apiFetch<FundConversation[]>(
        `/api/fund-conversations?code=${encodeURIComponent(nextCode)}`,
      );
      const presentableConversations = conversations.filter(
        (conversation) => !isUnusableConversationTitle(conversation.title),
      );
      const latest = presentableConversations[0];
      if (!latest) {
        setFundConversationId(undefined);
        setFundMessages([]);
        return;
      }

      const timeline = await apiFetch<{
        conversation: FundConversation;
        messages: Array<{
          id: string;
          role: "user" | "assistant" | "system";
          content: string;
        }>;
      }>(`/api/fund-conversations/${encodeURIComponent(latest.id)}`);
      setFundConversationId(timeline.conversation.id);
      setFundMessages(
        timeline.messages
          .filter((message) => message.role === "user" || message.role === "assistant")
          .map((message) => ({
            id: message.id,
            role: message.role as "user" | "assistant",
            content: sanitizeChatText(message.content),
          })),
      );
    } catch {
      setFundConversationId(undefined);
      setFundMessages([]);
    }
  }, []);

  const loadFund = useCallback(
    async (nextInput: string) => {
      const nextCode = normalizeFundCode(nextInput);
      if (!nextCode) {
        setError("请输入 6 位基金代码。");
        return false;
      }

      activeProfileCodeRef.current = nextCode;
      setLoading(true);
      setError(null);
      setNav([]);
      setIntraday(null);
      setHoldings(null);
      setAllMetrics(null);
      setOneYearMetrics(null);
      setChartMetrics(null);
      setFundReports([]);
      setFundConversationId(undefined);
      setFundMessages([]);
      activeRiskMetricsCodeRef.current = nextCode;
      activeChartMetricsKeyRef.current = null;
      try {
        const profileData = await apiFetch<FundProfile>(
          `/api/funds/${encodeURIComponent(nextCode)}/profile`,
        );
        if (activeProfileCodeRef.current !== nextCode) {
          // 期间用户已切换到其他基金，本次结果作废。
          return false;
        }
        setCode(nextCode);
        setProfile(profileData);
        // 请求成功说明数据源已恢复，清除故障提示与冷却。
        clearDatasourceFailure();
        setLoading(false);
        setRange("1y");
        setNavType("unit");
        setQueryVersion((version) => version + 1);
        return true;
      } catch (nextError) {
        if (activeProfileCodeRef.current !== nextCode) {
          return false;
        }
        // 数据源故障由守卫统一提示并进入 10 秒冷却。
        if (!guardDatasourceError(nextError)) {
          setError(nextError instanceof Error ? nextError.message : "基金查询失败。");
        }
        setLoading(false);
        return false;
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      // 冷启动时侧车（AkShare 首访）可能尚未就绪，失败后退避重试，避免右侧模块长时间空白。
      const delays = [0, 3_000, 8_000].slice(0, MAX_DEFAULT_LOAD_RETRIES);
      for (const delay of delays) {
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        if (cancelled) {
          return;
        }
        if (await loadFund(DEFAULT_FUND_CODE)) {
          return;
        }
        // 用户已主动查询了其他基金时不再重试默认基金，避免覆盖用户操作。
        if (activeProfileCodeRef.current !== DEFAULT_FUND_CODE) {
          return;
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [loadFund]);

  useEffect(() => {
    if (!code) {
      return;
    }
    const timer = setTimeout(() => void loadNav(code, range, navType), 0);
    return () => clearTimeout(timer);
  }, [code, range, navType, queryVersion, loadNav]);

  useEffect(() => {
    if (!code) {
      return;
    }
    const timer = setTimeout(() => {
      void loadIntraday(code);
      void loadHoldings(code);
    }, 0);
    return () => clearTimeout(timer);
  }, [code, queryVersion, loadIntraday, loadHoldings]);

  useEffect(() => {
    if (!code) {
      return;
    }
    const timer = setTimeout(() => void loadRiskMetrics(code), 0);
    return () => clearTimeout(timer);
  }, [code, queryVersion, loadRiskMetrics]);

  useEffect(() => {
    if (!code) {
      return;
    }
    const timer = setTimeout(() => {
      void loadFundReports(code);
      void loadFundConversation(code);
    }, 0);
    return () => clearTimeout(timer);
  }, [code, queryVersion, loadFundReports, loadFundConversation]);

  useEffect(() => {
    if (!code || range === "all" || range === "1y") {
      return;
    }
    const timer = setTimeout(() => void loadChartMetrics(code, range), 0);
    return () => clearTimeout(timer);
  }, [code, queryVersion, range, loadChartMetrics]);

  const handleFundAnalysis = async () => {
    if (!code || fundAnalysisLoading || fundAnalysisAbortRef.current) {
      return;
    }

    const controller = new AbortController();
    const draftId = `fund-analysis-stream-${Date.now()}`;
    fundAnalysisAbortRef.current = controller;
    setFundAnalysisLoading(true);
    setFundAnalysisTraceState(IDLE_TRACE_STATE);
    setError(null);
    let completed = false;
    const draftReport: FundAnalysisReport = {
      id: draftId,
      code,
      created_at: new Date().toISOString(),
      data_snapshot: null,
      source_refs: [],
      content: "",
      risk_note: "",
    };

    try {
      setFundReports((previous) => [
        draftReport,
        ...previous.filter((item) => item.id !== draftId),
      ]);

      const response = await fetch(
        `/api/funds/${encodeURIComponent(code)}/analysis/stream`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: "请生成当前基金档案、持仓与风险分析。" }),
          signal: controller.signal,
        },
      );
      if (!response.ok || !response.body) {
        throw new Error("基金分析接口响应异常。");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handleEvent = (raw: string) => {
        const dataLine = raw.split("\n").find((line) => line.startsWith("data: "));
        if (!dataLine) {
          return;
        }
        const event = JSON.parse(dataLine.slice(6)) as FundAnalysisStreamEvent;
        if (event.type === "trace" && event.data?.trace) {
          const snapshot = event.data.trace;
          setFundAnalysisTraceState((previous) => applyTraceSnapshot(previous, snapshot));
        } else if (event.type === "delta" && event.content) {
          setFundReports((previous) =>
            previous.map((item) =>
              item.id === draftId
                ? { ...item, content: item.content + event.content }
                : item,
            ),
          );
        } else if (event.type === "done" && event.data?.report) {
          completed = true;
          lastCompletedFundReportRef.current = event.data.report;
          setFundReports((previous) =>
            previous.map((item) => (item.id === draftId ? event.data?.report ?? item : item)),
          );
          setFundAnalysisTraceState((previous) => finishTrace(previous, "done"));
        } else if (event.type === "error") {
          setFundAnalysisTraceState((previous) => finishTrace(previous, "error"));
          // 数据源故障按冷却处理，其它错误按普通提示处理。
          throw (
            datasourceErrorFromStreamData(event.data) ??
            new Error(event.data?.message ?? "基金分析生成失败。")
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
        throw new Error("基金分析生成中断，未收到完整报告。");
      }
      const refreshedReports = await loadFundReports(code);
      const completedReport = lastCompletedFundReportRef.current;
      if (
        completedReport &&
        !refreshedReports.some((report) => report.id === completedReport.id)
      ) {
        setFundReports((previous) => [
          completedReport,
          ...previous.filter((report) => report.id !== completedReport.id),
        ]);
      }
      lastCompletedFundReportRef.current = null;
      clearDatasourceFailure();
    } catch (nextError) {
      if (nextError instanceof Error && nextError.name === "AbortError") {
        return;
      }
      setFundAnalysisTraceState((previous) => finishTrace(previous, "error"));
      // 数据源故障由守卫统一提示并进入 10 秒冷却。
      if (!guardDatasourceError(nextError)) {
        setError(nextError instanceof Error ? nextError.message : "基金分析生成失败。");
      }
      setFundReports((previous) => previous.filter((item) => item.id !== draftId));
    } finally {
      if (fundAnalysisAbortRef.current === controller) {
        fundAnalysisAbortRef.current = null;
      }
      setFundAnalysisLoading(false);
    }
  };

  const handleFundChatSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!code || !fundChatInput.trim() || fundChatLoading) {
      return;
    }

    const userText = fundChatInput.trim();
    const controller = new AbortController();
    fundChatAbortRef.current = controller;
    setFundChatInput("");
    setFundChatLoading(true);
    setFundChatTraceState(IDLE_TRACE_STATE);
    const userId = `local-fund-user-${Date.now()}`;
    const assistantId = `local-fund-assistant-${Date.now()}`;
    setFundMessages((previous) => [
      ...previous,
      { id: userId, role: "user", content: userText },
      { id: assistantId, role: "assistant", content: "" },
    ]);

    try {
      const response = await fetch("/api/fund-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          conversationId: fundConversationId,
          message: userText,
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error("基金对话接口响应异常。");
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
        if (event.type === "trace" && event.data?.trace) {
          const snapshot = event.data.trace;
          setFundChatTraceState((previous) => applyTraceSnapshot(previous, snapshot));
        } else if (event.type === "meta" && event.data?.conversationId) {
          setFundConversationId(event.data.conversationId);
        } else if (event.type === "delta" && event.content) {
          setFundMessages((previous) =>
            previous.map((message) =>
              message.id === assistantId
                ? { ...message, content: message.content + event.content }
                : message,
            ),
          );
        } else if (event.type === "done" && event.data) {
          setFundMessages((previous) =>
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
          setFundChatTraceState((previous) => finishTrace(previous, "done"));
        } else if (event.type === "error") {
          setFundChatTraceState((previous) => finishTrace(previous, "error"));
          // 数据源故障按冷却处理，其它错误按普通提示处理。
          throw (
            datasourceErrorFromStreamData(event.data) ??
            new Error(event.data?.message ?? "基金对话生成失败。")
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
    } catch (nextError) {
      if (nextError instanceof Error && nextError.name === "AbortError") {
        return;
      }
      setFundChatTraceState((previous) => finishTrace(previous, "error"));
      // 数据源故障由守卫统一提示并进入 10 秒冷却。
      if (!guardDatasourceError(nextError)) {
        setError(nextError instanceof Error ? nextError.message : "基金对话生成失败。");
      }
      setFundMessages((previous) => previous.filter((message) => message.id !== assistantId));
    } finally {
      if (fundChatAbortRef.current === controller) {
        fundChatAbortRef.current = null;
      }
      setFundChatLoading(false);
    }
  };

  const stopFundChat = () => {
    fundChatAbortRef.current?.abort();
    setFundChatTraceState(IDLE_TRACE_STATE);
    setFundChatLoading(false);
  };

  const handleSearch = () => {
    const nextInput = input.trim() || DEFAULT_FUND_CODE;
    setInput(nextInput);
    // 查询新代码即为「看这只基金」：切回当前标的分组，结果立即可见。
    focusTargetScope();
    void loadFund(nextInput);
  };

  /** 自选基金切换：直接复用主查询链路，确保档案、净值、风险、AI 与对话全链路一致，并回到标的视图。 */
  const handleWatchlistSelect = (nextCode: string) => {
    setInput(nextCode);
    focusTargetScope();
    void loadFund(nextCode);
  };

  /** 删除当前自选基金时清空已选基金，避免继续展示已移除基金。 */
  const handleWatchlistClearActive = () => {
    setInput(DEFAULT_FUND_CODE);
    setCode(null);
    setProfile(null);
    setNav([]);
    setIntraday(null);
    setHoldings(null);
    setAllMetrics(null);
    setOneYearMetrics(null);
    setChartMetrics(null);
    setFundReports([]);
    setFundConversationId(undefined);
    setFundMessages([]);
  };

  /** 依赖当前基金的模块在数据未就绪时给出可操作提示，避免勾选后右侧一片空白。 */
  const renderPendingModule = (title: string) => (
    <ModulePlaceholder
      title={title}
      message={
        loading
          ? `正在加载基金 ${input.trim() || DEFAULT_FUND_CODE} 的档案，加载完成后会自动显示「${title}」。`
          : error ??
            `尚未加载基金数据，请先在左侧输入基金代码（留空默认 ${DEFAULT_FUND_CODE}）并点击「查询」。`
      }
      actionLabel={loading ? undefined : "重新查询"}
      onAction={() => void loadFund(input.trim() || DEFAULT_FUND_CODE)}
      busy={loading}
    />
  );

  // 分组视图：只渲染当前分组已勾选的模块，两类内容不再混排。
  const scopedOptions = moduleOptionsForScope(FUND_MODULE_OPTIONS, activeScope);
  const visibleModuleKeys = moduleOrder.filter(
    (key) => enabledModules[key] && scopedOptions.some((option) => option.key === key),
  );
  const scopeStats: Record<ModuleScope, { enabled: number; total: number }> = {
    target: { enabled: 0, total: 0 },
    global: { enabled: 0, total: 0 },
  };
  for (const option of FUND_MODULE_OPTIONS) {
    scopeStats[option.scope].total += 1;
    if (enabledModules[option.key]) {
      scopeStats[option.scope].enabled += 1;
    }
  }
  const primaryModule = primaryModuleForScope(FUND_MODULE_OPTIONS, activeScope);
  /** 分组说明：标的组直接给出当前基金，工具组说明与标的无关。 */
  const scopeNote =
    activeScope === "target"
      ? profile
        ? `当前标的：${profile.name}（${code}）· 本组模块随标的切换`
        : "本组模块随当前标的切换"
      : "本组与当前基金无关：账户级工具与自带代码输入的独立工具";

  const renderFundModule = (key: FundModuleKey) => {
    if (!enabledModules[key]) {
      return null;
    }
    if (key === "positions") {
      // 持有列表与自选共用切换入口：点击持有基金即复用主查询链路刷新全盘面。
      return <FundPositionsPanel activeCode={code} onSelectTarget={handleWatchlistSelect} />;
    }
    if (key === "profile") {
      return profile ? (
        <FundProfilePanel profile={profile} loading={loading} />
      ) : (
        renderPendingModule("基金档案")
      );
    }
    if (key === "nav") {
      if (!code) {
        return renderPendingModule("净值走势");
      }
      return (
        <FundNavChartPanel
          nav={nav}
          range={range}
          navType={navType}
          riskMetrics={
            range === "all"
              ? allMetrics
              : range === "1y"
                ? oneYearMetrics
                : chartMetrics
          }
          loading={navLoading}
          blocked={datasourceGuard.blocked}
          onRangeChange={(value) => setRange(value)}
          onNavTypeChange={(value) => setNavType(value)}
        />
      );
    }
    if (key === "intraday") {
      if (!code) {
        return renderPendingModule("当日行情");
      }
      return <FundIntradayPanel intraday={intraday} loading={intradayLoading} />;
    }
    if (key === "holdings") {
      if (!code) {
        return renderPendingModule("持仓分析");
      }
      return <FundHoldingsPanel holdings={holdings} loading={holdingsLoading} />;
    }
    if (key === "risk") {
      if (!code) {
        return renderPendingModule("回撤与风险指标");
      }
      return (
        <FundRiskPanel
          allMetrics={allMetrics}
          oneYearMetrics={oneYearMetrics}
          loading={metricsLoading}
        />
      );
    }
    if (key === "analysis") {
      if (!code) {
        return renderPendingModule("AI 分析");
      }
      return (
        <FundAnalysisPanel
          code={code}
          reports={fundReports}
          loading={fundAnalysisLoading}
          blocked={datasourceGuard.blocked}
          trace={fundAnalysisTraceState}
          tracePolicy={tracePolicy}
          onGenerate={() => void handleFundAnalysis()}
          onDelete={async (reportId) => {
            try {
              await apiFetch(
                `/api/funds/${encodeURIComponent(code)}/reports/${encodeURIComponent(reportId)}`,
                { method: "DELETE" },
              );
              setFundReports((previous) => previous.filter((report) => report.id !== reportId));
              setReplayRefreshToken((value) => value + 1);
              setLastDeletedReportId(reportId);
            } catch (nextError) {
              setError(nextError instanceof Error ? nextError.message : "删除基金报告失败。");
            }
          }}
        />
      );
    }
    if (key === "chat") {
      if (!code) {
        return renderPendingModule("对话助手");
      }
      return (
        <ChatPanel
          code={code}
          conversationId={fundConversationId}
          messages={fundMessages}
          input={fundChatInput}
          loading={fundChatLoading}
          blocked={datasourceGuard.blocked}
          onInputChange={setFundChatInput}
          onSubmit={(event) => void handleFundChatSubmit(event)}
          onStop={stopFundChat}
          trace={fundChatTraceState}
          tracePolicy={tracePolicy}
        />
      );
    }
    if (key === "replay") {
      if (!code) {
        return renderPendingModule("历史复盘");
      }
      return (
        <FundReplayPanel
          key={code}
          code={code}
          refreshToken={replayRefreshToken}
          deletedReportId={lastDeletedReportId}
        />
      );
    }
    if (key === "comparison") {
      return <FundComparisonPanel />;
    }
    if (key === "portfolio") {
      return <FundPortfolioPanel />;
    }
    if (key === "dca") {
      return <FundDcaPanel />;
    }
    if (key === "news") {
      return <FundNewsPanel />;
    }
    if (key === "style") {
      return <FundStylePanel />;
    }
    if (key === "alerts") {
      return <AlertPanel target="fund" />;
    }
    if (key === "daily-report") {
      return <DailyReportPanel kind="fund" />;
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
              <FundOptionsSidebar
                input={input}
                loading={loading}
                blocked={datasourceGuard.blocked}
                code={code}
                onInputChange={setInput}
                onSearch={handleSearch}
                onWatchlistSelect={handleWatchlistSelect}
                onWatchlistClearActive={handleWatchlistClearActive}
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
            <div>
              <h1 className="tech-title text-xl font-semibold tracking-tight">基金分析与 AI 学习台</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                顶部模块菜单分两组：「当前标的」随基金切换，「持仓与全局工具」与标的无关（持有基金、对比、定投、预警、日报等）。
              </p>
            </div>

            <ModuleMenuBar
              scopes={FUND_MODULE_SCOPES}
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

            <RealtimeQuoteBar target="fund" />

            {error ? (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            ) : null}


            {visibleModuleKeys.length > 0 ? (
              <div className="flex flex-col gap-6">
                {visibleModuleKeys.map((key) => (
                  <Fragment key={key}>{renderFundModule(key)}</Fragment>
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
                      ? "本组模块随当前基金切换，勾选后即展示在当前代码下；留空代码时默认展示 510300。"
                      : "本组与当前基金无关（账户级数据与自带代码输入的独立工具），可独立勾选、与标的互不影响。"}
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

            <footer className="text-center text-xs text-muted-foreground">
              基金行情、净值、持仓与 AI 输出可能存在延迟或误差，仅供学习参考，不构成投资建议。
            </footer>
          </div>
        </section>
      </div>
    </div>
  );
}
