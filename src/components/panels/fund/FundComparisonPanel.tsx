"use client";

import { useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { sourceLabel } from "@/lib/format";
import { FUND_TRADING_MODE_LABELS, FUND_TYPE_LABELS } from "@/lib/fund-market";
import type { FundComparisonSnapshot } from "@/lib/shared/types";

const RANGE_OPTIONS = [
  { value: "1m", label: "近1个月" },
  { value: "3m", label: "近3个月" },
  { value: "6m", label: "近6个月" },
  { value: "1y", label: "近1年" },
  { value: "3y", label: "近3年" },
  { value: "all", label: "成立以来" },
] as const;

type ComparisonRange = (typeof RANGE_OPTIONS)[number]["value"];

function rangeLabel(range: string): string {
  return RANGE_OPTIONS.find((option) => option.value === range)?.label ?? range;
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
      throw new Error(payload?.error?.message ?? "基金对比请求失败。");
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

/** 基金多代码对比面板：按同一区间横向对比业绩与风险指标。 */
export function FundComparisonPanel() {
  const [codeRows, setCodeRows] = useState<string[]>(["510300", "110022"]);
  const [range, setRange] = useState<ComparisonRange>("1y");
  const [snapshot, setSnapshot] = useState<FundComparisonSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addRow = () => {
    setCodeRows((previous) => (previous.length < 5 ? [...previous, ""] : previous));
  };

  const updateRow = (index: number, value: string) => {
    setCodeRows((previous) =>
      previous.map((code, rowIndex) => (rowIndex === index ? value : code)),
    );
  };

  const removeRow = (index: number) => {
    setCodeRows((previous) =>
      previous.length > 2 ? previous.filter((_, rowIndex) => rowIndex !== index) : previous,
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const codes = codeRows.map((code) => code.trim());
    if (codes.some((code) => code.length === 0)) {
      setError("请填写完整，每个基金代码为 6 位数字。");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<FundComparisonSnapshot>(
        `/api/fund-comparison?codes=${encodeURIComponent(codes.join(","))}&range=${range}`,
      );
      setSnapshot(data);
    } catch (nextError) {
      setSnapshot(null);
      setError(nextError instanceof Error ? nextError.message : "基金对比加载失败。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold">基金对比</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            输入 2–5 个基金代码，横向比较同区间业绩与风险指标。
          </p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2 rounded-lg border bg-slate-50 p-3">
          <div className="flex flex-col gap-2">
            {codeRows.map((code, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  value={code}
                  onChange={(event) => updateRow(index, event.target.value)}
                  placeholder={`基金 ${index + 1}，如 510300`}
                  maxLength={6}
                  inputMode="numeric"
                  className="w-52 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                />
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  disabled={codeRows.length <= 2}
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
              disabled={codeRows.length >= 5}
              className="self-start rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground disabled:opacity-40"
            >
              + 增加基金
            </button>
          </div>
          <div className="ml-auto flex items-end gap-2">
            <select
              value={range}
              onChange={(event) => setRange(event.target.value as ComparisonRange)}
              className="rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            >
              {RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <Button type="submit" disabled={loading}>
              {loading ? "对比中..." : "开始对比"}
            </Button>
          </div>
        </form>
      </div>

      {error ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {snapshot ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-2 py-2">基金</th>
                <th className="px-2 py-2">类型</th>
                <th className="px-2 py-2">最新净值</th>
                <th className="px-2 py-2">当日涨跌</th>
                <th className="px-2 py-2">区间收益</th>
                <th className="px-2 py-2">年化收益</th>
                <th className="px-2 py-2">年化波动</th>
                <th className="px-2 py-2">最大回撤</th>
                <th className="px-2 py-2">当前回撤</th>
                <th className="px-2 py-2">夏普</th>
                <th className="px-2 py-2">卡玛</th>
                <th className="px-2 py-2">数据来源</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.items.map((item) => (
                <tr key={item.code} className="border-b last:border-0">
                  <td className="px-2 py-3">
                    <div className="font-medium">{item.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {item.code} ·{" "}
                      {FUND_TRADING_MODE_LABELS[item.trading_mode] ?? item.trading_mode}
                    </div>
                  </td>
                  <td className="px-2 py-3">
                    {FUND_TYPE_LABELS[item.type] ?? item.type}
                  </td>
                  <td className="px-2 py-3">
                    <div>{formatNumber(item.latest_cumulative_nav, 4)}</div>
                    <div className="text-xs text-muted-foreground">
                      {item.latest_nav_date ?? "暂无日期"}
                    </div>
                  </td>
                  <td className={`px-2 py-3 font-medium ${returnTone(item.latest_change_pct)}`}>
                    {formatPercent(item.latest_change_pct)}
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
                  <td className={`px-2 py-3 font-medium ${drawdownTone(item.current_drawdown_pct)}`}>
                    -{formatNumber(item.current_drawdown_pct)}%
                  </td>
                  <td className={`px-2 py-3 font-medium ${ratioTone(item.sharpe)}`}>
                    {formatNumber(item.sharpe)}
                  </td>
                  <td className={`px-2 py-3 font-medium ${ratioTone(item.calmar)}`}>
                    {formatNumber(item.calmar)}
                  </td>
                  <td className="px-2 py-3 text-xs text-muted-foreground">
                    {sourceLabel(item.source)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            区间：{rangeLabel(snapshot.range)}；数据仅供学习参考，不构成投资建议。
          </p>
        </div>
      ) : null}
    </section>
  );
}
