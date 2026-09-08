"use client";

import { useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import type { FundPortfolioSummary } from "@/lib/shared/types";

const RANGE_OPTIONS = ["1m", "3m", "6m", "1y", "3y", "all"] as const;
type PortfolioRange = (typeof RANGE_OPTIONS)[number];

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
      throw new Error(payload?.error?.message ?? "基金组合请求失败。");
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

function ratioTone(value: number | null): string {
  if (value === null || value === 0) {
    return "text-slate-900";
  }
  return value > 0 ? "text-red-700" : "text-green-700";
}

function rangeLabel(range: PortfolioRange): string {
  return range === "all" ? "成立以来" : range;
}

/** 基金组合分析面板：按用户指定权重合成多只基金，展示组合与单基金风险指标。 */
export function FundPortfolioPanel() {
  const [codesInput, setCodesInput] = useState("510300,110022");
  const [weightsInput, setWeightsInput] = useState("60,40");
  const [range, setRange] = useState<PortfolioRange>("1y");
  const [summary, setSummary] = useState<FundPortfolioSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        codes: codesInput,
        weights: weightsInput,
        range,
      });
      const data = await apiFetch<FundPortfolioSummary>(`/api/fund-portfolio?${params.toString()}`);
      setSummary(data);
    } catch (nextError) {
      setSummary(null);
      setError(nextError instanceof Error ? nextError.message : "基金组合加载失败。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-base font-semibold">基金组合分析</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            输入 2–5 个基金代码与权重，按共同交易日合成组合并比较同区间表现。
          </p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-wrap gap-2">
          <input
            value={codesInput}
            onChange={(event) => setCodesInput(event.target.value)}
            placeholder="如 510300,110022"
            className="w-52 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
          <input
            value={weightsInput}
            onChange={(event) => setWeightsInput(event.target.value)}
            placeholder="权重，如 60,40"
            className="w-40 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
          <select
            value={range}
            onChange={(event) => setRange(event.target.value as PortfolioRange)}
            className="rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          >
            {RANGE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {rangeLabel(option)}
              </option>
            ))}
          </select>
          <Button type="submit" disabled={loading}>
            {loading ? "分析中…" : "开始分析"}
          </Button>
        </form>
      </div>

      {error ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {summary ? (
        <div className="mt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="区间收益"
              value={formatPercent(summary.total_return_pct)}
              tone={returnTone(summary.total_return_pct)}
            />
            <MetricCard
              label="年化收益"
              value={formatPercent(summary.annualized_return_pct)}
              tone={returnTone(summary.annualized_return_pct)}
            />
            <MetricCard
              label="年化波动"
              value={formatPercent(summary.annualized_volatility_pct)}
              tone="text-slate-900"
            />
            <MetricCard
              label="最大回撤"
              value={summary.max_drawdown_pct === null ? "—" : `-${formatNumber(summary.max_drawdown_pct)}%`}
              tone={drawdownTone(summary.max_drawdown_pct)}
            />
            <MetricCard
              label="当前回撤"
              value={summary.current_drawdown_pct === null ? "—" : `-${formatNumber(summary.current_drawdown_pct)}%`}
              tone={drawdownTone(summary.current_drawdown_pct)}
            />
            <MetricCard
              label="夏普比率"
              value={formatNumber(summary.sharpe)}
              tone={ratioTone(summary.sharpe)}
            />
            <MetricCard
              label="索提诺比率"
              value={formatNumber(summary.sortino)}
              tone={ratioTone(summary.sortino)}
            />
            <MetricCard
              label="卡玛比率"
              value={formatNumber(summary.calmar)}
              tone={ratioTone(summary.calmar)}
            />
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-2 py-2">基金</th>
                  <th className="px-2 py-2">权重</th>
                  <th className="px-2 py-2">区间收益</th>
                  <th className="px-2 py-2">年化收益</th>
                  <th className="px-2 py-2">年化波动</th>
                  <th className="px-2 py-2">最大回撤</th>
                  <th className="px-2 py-2">夏普</th>
                  <th className="px-2 py-2">卡玛</th>
                </tr>
              </thead>
              <tbody>
                {summary.items.map((item) => (
                  <tr key={item.code} className="border-b last:border-0">
                    <td className="px-2 py-3">
                      <div className="font-medium">{item.name}</div>
                      <div className="text-xs text-muted-foreground">{item.code}</div>
                    </td>
                    <td className="px-2 py-3 text-slate-900">
                      {formatNumber(item.weight_pct)}%
                    </td>
                    <td className={`px-2 py-3 font-medium ${returnTone(item.period_return_pct)}`}>
                      {formatPercent(item.period_return_pct)}
                    </td>
                    <td className={`px-2 py-3 font-medium ${returnTone(item.annualized_return_pct)}`}>
                      {formatPercent(item.annualized_return_pct)}
                    </td>
                    <td className="px-2 py-3 text-slate-900">
                      {formatPercent(item.annualized_volatility_pct)}
                    </td>
                    <td className={`px-2 py-3 font-medium ${drawdownTone(item.max_drawdown_pct)}`}>
                      -{formatNumber(item.max_drawdown_pct)}%
                    </td>
                    <td className={`px-2 py-3 font-medium ${ratioTone(item.sharpe)}`}>
                      {formatNumber(item.sharpe)}
                    </td>
                    <td className={`px-2 py-3 font-medium ${ratioTone(item.calmar)}`}>
                      {formatNumber(item.calmar)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-2 text-xs text-muted-foreground">
            区间：{rangeLabel(summary.range as PortfolioRange)}；数据仅供学习参考，不构成投资建议。
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
