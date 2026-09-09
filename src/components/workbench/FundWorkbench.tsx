"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { ChatPanel, type ChatViewMessage } from "@/components/panels/ChatPanel";
import { FundAnalysisPanel } from "@/components/panels/fund/FundAnalysisPanel";
import { FundComparisonPanel } from "@/components/panels/fund/FundComparisonPanel";
import { FundDcaPanel } from "@/components/panels/fund/FundDcaPanel";
import { FundHoldingsPanel } from "@/components/panels/fund/FundHoldingsPanel";
import { FundNewsPanel } from "@/components/panels/fund/FundNewsPanel";
import { FundIntradayPanel } from "@/components/panels/fund/FundIntradayPanel";
import { FundNavChartPanel } from "@/components/panels/fund/FundNavChartPanel";
import { FundProfilePanel } from "@/components/panels/fund/FundProfilePanel";
import { FundPortfolioPanel } from "@/components/panels/fund/FundPortfolioPanel";
import { FundReplayPanel } from "@/components/panels/fund/FundReplayPanel";
import { FundRiskPanel } from "@/components/panels/fund/FundRiskPanel";
import { FundStylePanel } from "@/components/panels/fund/FundStylePanel";
import { FundWatchlistPanel } from "@/components/panels/fund/FundWatchlistPanel";
import type { FundNavRange, FundNavType } from "@/lib/fund-data";
import type { FundMetricsRange } from "@/lib/fund-metrics";
import { DEFAULT_FUND_CODE, normalizeFundCode } from "@/lib/fund-market";
import type {
  ChatStreamEvent,
  FundAnalysisReport,
  FundAnalysisStreamEvent,
  FundConversation,
  FundHoldings,
  FundIndustryNewsSnapshot,
  FundIntraday,
  FundNavPoint,
  FundProfile,
  FundRiskMetrics,
} from "@/lib/shared/types";

const REQUEST_TIMEOUT_MS = 20_000;

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
      throw new Error(payload?.error?.message ?? "基金数据请求失败。");
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

/** 基金工作台容器：管理基金代码、档案与净值展示状态。 */
export default function FundWorkbench() {
  const [input, setInput] = useState(DEFAULT_FUND_CODE);
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
  const [fundIndustryNews, setFundIndustryNews] = useState<FundIndustryNewsSnapshot | null>(null);
  const [fundIndustryNewsLoading, setFundIndustryNewsLoading] = useState(false);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [fundReports, setFundReports] = useState<FundAnalysisReport[]>([]);
  const [fundAnalysisLoading, setFundAnalysisLoading] = useState(false);
  const [fundConversationId, setFundConversationId] = useState<string | undefined>();
  const [fundMessages, setFundMessages] = useState<ChatViewMessage[]>([]);
  const [fundChatInput, setFundChatInput] = useState("");
  const [fundChatLoading, setFundChatLoading] = useState(false);
  const [queryVersion, setQueryVersion] = useState(0);
  const [replayRefreshToken, setReplayRefreshToken] = useState(0);
  const [lastDeletedReportId, setLastDeletedReportId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeProfileCodeRef = useRef<string | null>(null);
  const activeNavKeyRef = useRef<string | null>(null);
  const activeIntradayCodeRef = useRef<string | null>(null);
  const activeHoldingsCodeRef = useRef<string | null>(null);
  const activeFundIndustryNewsCodeRef = useRef<string | null>(null);
  const activeRiskMetricsCodeRef = useRef<string | null>(null);
  const activeChartMetricsKeyRef = useRef<string | null>(null);
  const fundAnalysisAbortRef = useRef<AbortController | null>(null);
  const fundChatAbortRef = useRef<AbortController | null>(null);
  const lastCompletedFundReportRef = useRef<FundAnalysisReport | null>(null);

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
        setError(nextError instanceof Error ? nextError.message : "净值加载失败。");
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
    } catch {
      if (activeIntradayCodeRef.current === nextCode) {
        setIntraday(null);
      }
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
    } catch {
      if (activeHoldingsCodeRef.current === nextCode) {
        setHoldings(null);
      }
    } finally {
      if (activeHoldingsCodeRef.current === nextCode) {
        setHoldingsLoading(false);
      }
    }
  }, []);

  const loadFundNews = useCallback(async (nextCode: string, refresh = false) => {
    activeFundIndustryNewsCodeRef.current = nextCode;
    setFundIndustryNewsLoading(true);
    try {
      const data = await apiFetch<FundIndustryNewsSnapshot>(
        `/api/funds/${encodeURIComponent(nextCode)}/news${refresh ? "?refresh=1" : ""}`,
      );
      if (activeFundIndustryNewsCodeRef.current === nextCode) {
        setFundIndustryNews(data);
      }
    } catch {
      if (activeFundIndustryNewsCodeRef.current === nextCode) {
        setFundIndustryNews(null);
      }
    } finally {
      if (activeFundIndustryNewsCodeRef.current === nextCode) {
        setFundIndustryNewsLoading(false);
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
      const latest = conversations[0];
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
            content: message.content,
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
        return;
      }

      activeProfileCodeRef.current = nextCode;
      setLoading(true);
      setError(null);
      setNav([]);
      setIntraday(null);
      setHoldings(null);
      setFundIndustryNews(null);
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
        if (activeProfileCodeRef.current === nextCode) {
          setCode(nextCode);
          setProfile(profileData);
          setLoading(false);
          setRange("1y");
          setNavType("unit");
          setQueryVersion((version) => version + 1);
        }
      } catch (nextError) {
        if (activeProfileCodeRef.current === nextCode) {
          setError(nextError instanceof Error ? nextError.message : "基金查询失败。");
          setLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    const timer = setTimeout(() => void loadFund(DEFAULT_FUND_CODE), 0);
    return () => clearTimeout(timer);
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
      void loadFundNews(code);
    }, 0);
    return () => clearTimeout(timer);
  }, [code, queryVersion, loadIntraday, loadHoldings, loadFundNews]);

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
    setError(null);
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
        if (event.type === "delta" && event.content) {
          setFundReports((previous) =>
            previous.map((item) =>
              item.id === draftId
                ? { ...item, content: item.content + event.content }
                : item,
            ),
          );
        } else if (event.type === "done" && event.data?.report) {
          lastCompletedFundReportRef.current = event.data.report;
          setFundReports((previous) =>
            previous.map((item) => (item.id === draftId ? event.data?.report ?? item : item)),
          );
        } else if (event.type === "error") {
          throw new Error(event.data?.message ?? "基金分析生成失败。");
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
    } catch (nextError) {
      if (nextError instanceof Error && nextError.name === "AbortError") {
        return;
      }
      setError(nextError instanceof Error ? nextError.message : "基金分析生成失败。");
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
        if (event.type === "meta" && event.data?.conversationId) {
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
                ? { ...message, sources: event.data?.sources, riskNote: event.data?.riskNote }
                : message,
            ),
          );
        } else if (event.type === "error") {
          throw new Error(event.data?.message ?? "基金对话生成失败。");
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
    } catch (nextError) {
      if (nextError instanceof Error && nextError.name === "AbortError") {
        return;
      }
      setError(nextError instanceof Error ? nextError.message : "基金对话生成失败。");
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
    setFundChatLoading(false);
  };

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextInput = input.trim() || DEFAULT_FUND_CODE;
    setInput(nextInput);
    void loadFund(nextInput);
  };

  /** 自选基金切换：直接复用主查询链路，确保档案、净值、风险、AI 与对话全链路一致。 */
  const handleWatchlistSelect = (nextCode: string) => {
    setInput(nextCode);
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
    setFundIndustryNews(null);
    setAllMetrics(null);
    setOneYearMetrics(null);
    setChartMetrics(null);
    setFundReports([]);
    setFundConversationId(undefined);
    setFundMessages([]);
  };

  return (
    <section className="mx-auto flex min-w-0 flex-1 max-w-6xl flex-col gap-6 px-4 py-8">
      <header className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">基金分析与 AI 学习台</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              输入 6 位基金代码，查看基金档案与历史净值走势。
            </p>
          </div>
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="基金代码，如 510300"
              maxLength={6}
              inputMode="numeric"
              className="w-44 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {loading ? "查询中" : "查询"}
            </button>
          </form>
        </div>
      </header>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <FundWatchlistPanel
        activeCode={code}
        onSelect={handleWatchlistSelect}
        onClearActive={handleWatchlistClearActive}
      />

      <FundComparisonPanel />

      <FundPortfolioPanel />

      <FundDcaPanel />

      <FundStylePanel />

      {code ? (
        <FundReplayPanel
          key={code}
          code={code}
          refreshToken={replayRefreshToken}
          deletedReportId={lastDeletedReportId}
        />
      ) : null}

      {profile ? <FundProfilePanel profile={profile} loading={loading} /> : null}

      {code ? (
        <FundNewsPanel
          snapshot={fundIndustryNews}
          loading={fundIndustryNewsLoading}
          onRefresh={() => void loadFundNews(code, true)}
        />
      ) : null}

      {code ? (
        <FundIntradayPanel intraday={intraday} loading={intradayLoading} />
      ) : null}

      {code ? (
        <FundHoldingsPanel holdings={holdings} loading={holdingsLoading} />
      ) : null}

      {code ? (
        <FundRiskPanel
          allMetrics={allMetrics}
          oneYearMetrics={oneYearMetrics}
          loading={metricsLoading}
        />
      ) : null}

      {code ? (
        <FundAnalysisPanel
          code={code}
          reports={fundReports}
          loading={fundAnalysisLoading}
          onGenerate={() => void handleFundAnalysis()}
          onDelete={async (reportId) => {
            try {
              await apiFetch(`/api/funds/${encodeURIComponent(code)}/reports/${encodeURIComponent(reportId)}`, {
                method: "DELETE",
              });
              setFundReports((previous) => previous.filter((report) => report.id !== reportId));
              setReplayRefreshToken((value) => value + 1);
              setLastDeletedReportId(reportId);
            } catch (nextError) {
              setError(nextError instanceof Error ? nextError.message : "删除基金报告失败。");
            }
          }}
        />
      ) : null}

      {code ? (
        <ChatPanel
          code={code}
          conversationId={fundConversationId}
          messages={fundMessages}
          input={fundChatInput}
          loading={fundChatLoading}
          onInputChange={setFundChatInput}
          onSubmit={(event) => void handleFundChatSubmit(event)}
          onStop={stopFundChat}
        />
      ) : null}

      {code ? (
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
          onRangeChange={(value) => setRange(value)}
          onNavTypeChange={(value) => setNavType(value)}
        />
      ) : null}

      {!profile && !loading ? (
        <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed bg-white p-8 text-center shadow-sm">
          <div>
            <h2 className="text-lg font-semibold">基金面板待查询</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              输入基金代码后，这里将展示基金档案与历史净值。
            </p>
          </div>
        </div>
      ) : null}

      <footer className="text-center text-xs text-muted-foreground">
        基金行情、净值、持仓与 AI 输出可能存在延迟或误差，仅供学习参考，不构成投资建议。
      </footer>
    </section>
  );
}
