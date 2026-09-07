"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { FundHoldingsPanel } from "@/components/panels/fund/FundHoldingsPanel";
import { FundIntradayPanel } from "@/components/panels/fund/FundIntradayPanel";
import { FundNavChartPanel } from "@/components/panels/fund/FundNavChartPanel";
import { FundProfilePanel } from "@/components/panels/fund/FundProfilePanel";
import { FundRiskPanel } from "@/components/panels/fund/FundRiskPanel";
import type { FundNavRange, FundNavType } from "@/lib/fund-data";
import type { FundMetricsRange } from "@/lib/fund-metrics";
import { DEFAULT_FUND_CODE, normalizeFundCode } from "@/lib/fund-market";
import type {
  FundHoldings,
  FundIntraday,
  FundNavPoint,
  FundProfile,
  FundRiskMetrics,
} from "@/lib/shared/types";

const REQUEST_TIMEOUT_MS = 20_000;

async function apiFetch<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
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
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [queryVersion, setQueryVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const activeProfileCodeRef = useRef<string | null>(null);
  const activeNavKeyRef = useRef<string | null>(null);
  const activeIntradayCodeRef = useRef<string | null>(null);
  const activeHoldingsCodeRef = useRef<string | null>(null);
  const activeRiskMetricsCodeRef = useRef<string | null>(null);
  const activeChartMetricsKeyRef = useRef<string | null>(null);

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
      setAllMetrics(null);
      setOneYearMetrics(null);
      setChartMetrics(null);
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
    if (!code || range === "all" || range === "1y") {
      return;
    }
    const timer = setTimeout(() => void loadChartMetrics(code, range), 0);
    return () => clearTimeout(timer);
  }, [code, queryVersion, range, loadChartMetrics]);

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextInput = input.trim() || DEFAULT_FUND_CODE;
    setInput(nextInput);
    void loadFund(nextInput);
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

      {profile ? <FundProfilePanel profile={profile} loading={loading} /> : null}

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
