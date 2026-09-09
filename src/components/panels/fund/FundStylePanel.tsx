"use client";

import { useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { sourceLabel } from "@/lib/format";
import type { FundStyleSnapshot } from "@/lib/shared/types";

const RANGE_OPTIONS = [
  { value: "1m", label: "近1个月" },
  { value: "3m", label: "近3个月" },
  { value: "6m", label: "近6个月" },
  { value: "1y", label: "近1年" },
  { value: "3y", label: "近3年" },
  { value: "all", label: "成立以来" },
] as const;

type StyleRange = (typeof RANGE_OPTIONS)[number]["value"];

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: { message?: string };
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
    if (!payload?.success || payload.data === undefined) {
      throw new Error(payload?.error?.message ?? "基金风格因子请求失败。");
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

function formatNumber(value: number | null, digits = 2): string {
  return value === null ? "—" : value.toFixed(digits);
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2)}%`;
}

function returnTone(value: number | null): string {
  if (value === null || value === 0) {
    return "text-slate-900";
  }
  return value > 0 ? "text-red-700" : "text-green-700";
}

function drawdownTone(value: number | null): string {
  if (value === null || value === 0) {
    return "text-slate-900";
  }
  return "text-green-700";
}

function rangeLabel(range: string): string {
  return RANGE_OPTIONS.find((option) => option.value === range)?.label ?? range;
}

/** 基金风格因子分析面板：展示持仓风格、风险收益特征与 AI/本地归纳说明。 */
export function FundStylePanel() {
  const [code, setCode] = useState("510300");
  const [range, setRange] = useState<StyleRange>("1y");
  const [snapshot, setSnapshot] = useState<FundStyleSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedCode = code.trim();
    if (!/^\d{6}$/.test(normalizedCode)) {
      setError("请输入 6 位基金代码。");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ code: normalizedCode, range });
      const data = await apiFetch<FundStyleSnapshot>(`/api/fund-style?${params.toString()}`);
      setSnapshot(data);
    } catch (nextError) {
      setSnapshot(null);
      setError(nextError instanceof Error ? nextError.message : "基金风格因子加载失败。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold">基金风格因子分析</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            基于真实持仓与风险指标归纳基金风格特征，仅供学习参考。
          </p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2 rounded-lg border bg-slate-50 p-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            基金代码
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="如 510300"
              maxLength={6}
              inputMode="numeric"
              className="w-36 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            分析区间
            <select
              value={range}
              onChange={(event) => setRange(event.target.value as StyleRange)}
              className="rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            >
              {RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={loading}>
            {loading ? "分析中..." : "开始分析"}
          </Button>
        </form>
      </div>

      {error ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {snapshot && !snapshot.available ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {snapshot.reason ?? "当前无法进行风格因子分析。"}
        </div>
      ) : null}

      {snapshot?.available ? (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            {snapshot.tags.map((tag) => (
              <span key={tag} className="rounded bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                {tag}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard label="年化收益" value={formatPercent(snapshot.risk_return.annualized_return_pct)} tone={returnTone(snapshot.risk_return.annualized_return_pct)} />
            <MetricCard label="年化波动" value={formatPercent(snapshot.risk_return.annualized_volatility_pct)} tone="text-slate-900" />
            <MetricCard label="夏普比率" value={formatNumber(snapshot.risk_return.sharpe)} tone={returnTone(snapshot.risk_return.sharpe)} />
            <MetricCard label="索提诺比率" value={formatNumber(snapshot.risk_return.sortino)} tone={returnTone(snapshot.risk_return.sortino)} />
            <MetricCard label="卡玛比率" value={formatNumber(snapshot.risk_return.calmar)} tone={returnTone(snapshot.risk_return.calmar)} />
            <MetricCard
              label="最大回撤"
              value={snapshot.risk_return.max_drawdown_pct === null ? "—" : `-${formatNumber(snapshot.risk_return.max_drawdown_pct)}%`}
              tone={drawdownTone(snapshot.risk_return.max_drawdown_pct)}
            />
            <MetricCard
              label="当前回撤"
              value={snapshot.risk_return.current_drawdown_pct === null ? "—" : `-${formatNumber(snapshot.risk_return.current_drawdown_pct)}%`}
              tone={drawdownTone(snapshot.risk_return.current_drawdown_pct)}
            />
          </div>

          <div className="rounded-lg border bg-slate-50 p-4">
            <h3 className="text-sm font-semibold">持仓集中度</h3>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">前十大持仓</span>
                <span className="font-medium">{formatPercent(snapshot.concentration.top10_weight_pct)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">第一大持仓</span>
                <span className="font-medium">{formatPercent(snapshot.concentration.top1_weight_pct)}</span>
              </div>
            </div>
          </div>

          <div className="rounded-lg border bg-slate-50 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                {snapshot.analysis_source === "ai" ? "AI 风格归纳" : "本地风格归纳"}
              </h3>
              <span className="text-xs text-muted-foreground">
                {snapshot.analysis_source === "ai" ? "AI 生成，仅供学习" : "本地规则归纳"}
              </span>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
              {snapshot.narrative ?? "暂无分析说明。"}
            </p>
          </div>

          <p className="text-xs text-muted-foreground">
            {snapshot.name}（{snapshot.code}）· 区间：{rangeLabel(snapshot.range)} · 数据来源：{sourceLabel(snapshot.source)}。
          </p>
        </div>
      ) : null}
    </section>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="rounded-lg border bg-slate-50 px-3 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${tone}`}>{value}</div>
    </div>
  );
}
