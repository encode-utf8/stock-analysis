"use client";

import { useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import type { FundPortfolioMode, FundPortfolioSummary } from "@/lib/shared/types";

const RANGE_OPTIONS = [
  { value: "1m", label: "近1个月" },
  { value: "3m", label: "近3个月" },
  { value: "6m", label: "近6个月" },
  { value: "1y", label: "近1年" },
  { value: "3y", label: "近3年" },
  { value: "all", label: "成立以来" },
] as const;

type PortfolioRange = (typeof RANGE_OPTIONS)[number]["value"];

interface PortfolioRow {
  code: string;
  allocation: string;
}

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

function formatMoney(value: number | null): string {
  if (value === null) {
    return "—";
  }
  const sign = value < 0 ? "-" : "";
  return `${sign}¥${Math.abs(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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

function rangeLabel(range: string): string {
  return RANGE_OPTIONS.find((option) => option.value === range)?.label ?? range;
}

/** 基金组合分析面板：按用户指定权重合成多只基金，展示组合与单基金风险指标。 */
export function FundPortfolioPanel() {
  const [rows, setRows] = useState<PortfolioRow[]>([
    { code: "510300", allocation: "60" },
    { code: "110022", allocation: "40" },
  ]);
  const [mode, setMode] = useState<FundPortfolioMode>("weight");
  const [range, setRange] = useState<PortfolioRange>("1y");
  const [summary, setSummary] = useState<FundPortfolioSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addRow = () => {
    setRows((previous) =>
      previous.length < 5 ? [...previous, { code: "", allocation: "" }] : previous,
    );
  };

  const updateRow = (index: number, field: "code" | "allocation", value: string) => {
    setRows((previous) =>
      previous.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row,
      ),
    );
  };

  const removeRow = (index: number) => {
    setRows((previous) =>
      previous.length > 2 ? previous.filter((_, rowIndex) => rowIndex !== index) : previous,
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const codes = rows.map((row) => row.code.trim());
    if (codes.some((code) => code.length === 0)) {
      setError("请填写完整，每个基金代码为 6 位数字。");
      return;
    }

    const allocations = rows.map((row) => row.allocation.trim());
    const hasAnyAllocation = allocations.some((allocation) => allocation.length > 0);
    const hasAllAllocations = allocations.every((allocation) => allocation.length > 0);

    if (mode === "shares") {
      if (!hasAllAllocations) {
        setError("持仓份额模式请为每一行都填写持仓份额。");
        return;
      }
    } else if (hasAnyAllocation && !hasAllAllocations) {
      setError("请为每一行都填写权重，或全部留空使用等权。");
      return;
    }

    if (mode === "weight" && hasAllAllocations) {
      const weightValues = allocations.map((allocation) => Number(allocation));
      if (weightValues.some((value) => !Number.isFinite(value) || value < 0)) {
        setError("权重需为非负数字。");
        return;
      }
      const weightTotal = weightValues.reduce((sum, value) => sum + value, 0);
      if (Math.abs(weightTotal - 100) > 0.01) {
        setError(`权重合计需等于 100，当前为 ${weightTotal.toFixed(2)}。`);
        return;
      }
    }

    if (mode === "shares" && hasAllAllocations) {
      const shareValues = allocations.map((allocation) => Number(allocation));
      if (shareValues.some((value) => !Number.isFinite(value) || value <= 0)) {
        setError("持仓份额需为大于 0 的数字。");
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ codes: codes.join(","), range, mode });
      if (hasAnyAllocation) {
        params.set(mode === "shares" ? "shares" : "weights", allocations.join(","));
      }
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
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold">基金组合分析</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            输入 2–5 个基金代码，可按百分比权重或持仓份额分析，按共同交易日合成组合并比较同区间表现。
          </p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2 rounded-lg border bg-slate-50 p-3">
          <div className="flex flex-col gap-2">
            {rows.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  value={row.code}
                  onChange={(event) => updateRow(index, "code", event.target.value)}
                  placeholder={`基金 ${index + 1}，如 510300`}
                  maxLength={6}
                  inputMode="numeric"
                  className="w-44 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                />
                <input
                  value={row.allocation}
                  onChange={(event) => updateRow(index, "allocation", event.target.value)}
                  placeholder={mode === "weight" ? "权重 %" : "份额（份）"}
                  inputMode="decimal"
                  className="w-28 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                />
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  disabled={rows.length <= 2}
                  className="rounded-md border px-2 py-2 text-sm text-muted-foreground disabled:opacity-40"
                  aria-label="删除该行"
                >
                  删除
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addRow}
              disabled={rows.length >= 5}
              className="self-start rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground disabled:opacity-40"
            >
              + 增加基金
            </button>
          </div>
          <div className="ml-auto flex items-end gap-2">
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as FundPortfolioMode)}
              className="rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="weight">百分比权重</option>
              <option value="shares">持仓份额</option>
            </select>
            <select
              value={range}
              onChange={(event) => setRange(event.target.value as PortfolioRange)}
              className="rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            >
              {RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <Button type="submit" disabled={loading}>
              {loading ? "分析中…" : "开始分析"}
            </Button>
          </div>
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
            {summary.mode === "shares" ? (
              <>
                <MetricCard
                  label="总持仓金额"
                  value={formatMoney(summary.total_holding_amount)}
                  tone="text-slate-900"
                />
                <MetricCard
                  label="最新总市值"
                  value={formatMoney(summary.total_latest_value)}
                  tone="text-slate-900"
                />
                <MetricCard
                  label="持仓盈亏"
                  value={formatMoney(summary.total_profit_loss)}
                  tone={returnTone(summary.total_profit_loss)}
                />
              </>
            ) : null}
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
                  {summary.mode === "shares" ? (
                    <>
                      <th className="px-2 py-2">持仓金额</th>
                      <th className="px-2 py-2">权重</th>
                      <th className="px-2 py-2">最新市值</th>
                      <th className="px-2 py-2">持仓盈亏</th>
                    </>
                  ) : (
                    <th className="px-2 py-2">权重</th>
                  )}
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
                    {summary.mode === "shares" ? (
                      <>
                        <td className="px-2 py-3 text-slate-900">
                          {formatMoney(item.holding_amount)}
                        </td>
                        <td className="px-2 py-3 text-slate-900">
                          {formatNumber(item.weight_pct)}%
                        </td>
                        <td className="px-2 py-3 text-slate-900">
                          {formatMoney(item.latest_value)}
                        </td>
                        <td className={`px-2 py-3 font-medium ${returnTone(item.profit_loss)}`}>
                          {formatMoney(item.profit_loss)}
                        </td>
                      </>
                    ) : (
                      <td className="px-2 py-3 text-slate-900">
                        {formatNumber(item.weight_pct)}%
                      </td>
                    )}
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
