"use client";

import { useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { sourceLabel } from "@/lib/format";
import type { FundDcaFrequency, FundDcaPortfolioSnapshot, FundDcaSnapshot } from "@/lib/shared/types";
import { DcaReturnChart } from "@/components/panels/fund/DcaReturnChart";
import { DcaComparisonChart } from "@/components/panels/fund/DcaComparisonChart";

const FREQUENCY_OPTIONS: Array<{ value: FundDcaFrequency; label: string }> = [
  { value: "daily", label: "每日" },
  { value: "weekly", label: "每周" },
  { value: "biweekly", label: "每两周" },
  { value: "monthly", label: "每月" },
];

const RANGE_OPTIONS = [
  { value: "1m", label: "近1个月" },
  { value: "3m", label: "近3个月" },
  { value: "6m", label: "近6个月" },
  { value: "1y", label: "近1年" },
  { value: "3y", label: "近3年" },
  { value: "all", label: "成立以来" },
] as const;

type DcaRange = (typeof RANGE_OPTIONS)[number]["value"];

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
      throw new Error(payload?.error?.message ?? "基金定投请求失败。");
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

function rangeLabel(range: string): string {
  return RANGE_OPTIONS.find((option) => option.value === range)?.label ?? range;
}

function frequencyLabel(frequency: FundDcaFrequency): string {
  return FREQUENCY_OPTIONS.find((option) => option.value === frequency)?.label ?? frequency;
}

/** 基金定投回测面板：按指定频率与金额回测基金定投结果。 */
export function FundDcaPanel() {
  const [code, setCode] = useState("510300");
  const [frequency, setFrequency] = useState<FundDcaFrequency>("monthly");
  const [amount, setAmount] = useState("1000");
  const [range, setRange] = useState<DcaRange>("1y");
  const [snapshot, setSnapshot] = useState<FundDcaSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [showTable, setShowTable] = useState(false);
  const [showPortfolio, setShowPortfolio] = useState(false);
  const [portfolioRows, setPortfolioRows] = useState<Array<{ code: string; amount: string }>>([
    { code: "510300", amount: "1000" },
    { code: "110022", amount: "1000" },
  ]);
  const [portfolioSnapshot, setPortfolioSnapshot] = useState<FundDcaPortfolioSnapshot | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);

  const contributions = snapshot?.contributions ?? [];
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(contributions.length / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const visibleContributions = contributions.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedCode = code.trim();
    if (!/^\d{6}$/.test(normalizedCode)) {
      setError("请输入 6 位基金代码。");
      return;
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > 10_000_000) {
      setError("每期定投金额需为大于 0 且不超过 1000 万的数字。");
      return;
    }

    setLoading(true);
    setError(null);
    setPage(0);
    setShowTable(false);
    try {
      const params = new URLSearchParams({
        code: normalizedCode,
        range,
        frequency,
        amount,
      });
      const data = await apiFetch<FundDcaSnapshot>(`/api/fund-dca?${params.toString()}`);
      setSnapshot(data);
    } catch (nextError) {
      setSnapshot(null);
      setError(nextError instanceof Error ? nextError.message : "基金定投回测加载失败。");
    } finally {
      setLoading(false);
    }
  };

  const updatePortfolioRow = (index: number, field: "code" | "amount", value: string) => {
    setPortfolioRows((previous) =>
      previous.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row,
      ),
    );
  };

  const addPortfolioRow = () => {
    setPortfolioRows((previous) =>
      previous.length < 5 ? [...previous, { code: "", amount: "" }] : previous,
    );
  };

  const removePortfolioRow = (index: number) => {
    setPortfolioRows((previous) =>
      previous.length > 2 ? previous.filter((_, rowIndex) => rowIndex !== index) : previous,
    );
  };

  const handlePortfolioSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const codes = portfolioRows.map((row) => row.code.trim());
    if (codes.some((code) => !/^\d{6}$/.test(code))) {
      setPortfolioError("请为每一行填写 6 位基金代码。");
      return;
    }
    const amounts = portfolioRows.map((row) => row.amount.trim());
    const amountValues = amounts.map((amount) => Number(amount));
    if (
      amounts.some((amount) => amount.length === 0) ||
      amountValues.some((value) => !Number.isFinite(value) || value <= 0 || value > 10_000_000)
    ) {
      setPortfolioError("每只基金每期金额需为大于 0 且不超过 1000 万的数字。");
      return;
    }

    setPortfolioLoading(true);
    setPortfolioError(null);
    setPortfolioSnapshot(null);
    try {
      const params = new URLSearchParams({
        codes: codes.join(","),
        range,
        frequency,
        amounts: amounts.join(","),
      });
      const data = await apiFetch<FundDcaPortfolioSnapshot>(`/api/fund-dca?${params.toString()}`);
      setPortfolioSnapshot(data);
    } catch (nextError) {
      setPortfolioError(nextError instanceof Error ? nextError.message : "基金组合定投回测失败。");
    } finally {
      setPortfolioLoading(false);
    }
  };

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold">基金定投回测</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            按固定频率与金额回测基金历史定投表现；结果仅供学习参考，不构成投资建议。
          </p>
        </div>
        <form
          onSubmit={handleSubmit}
          className="flex flex-wrap items-end gap-2 rounded-lg border bg-slate-50 p-3"
        >
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
            定投频率
            <select
              value={frequency}
              onChange={(event) => setFrequency(event.target.value as FundDcaFrequency)}
              className="rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            >
              {FREQUENCY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            每期金额
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              className="w-32 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            回测区间
            <select
              value={range}
              onChange={(event) => setRange(event.target.value as DcaRange)}
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
            {loading ? "回测中..." : "开始回测"}
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
          {snapshot.reason ?? "当前无法计算定投回测。"}
        </div>
      ) : null}

      {snapshot?.available ? (
        <div className="mt-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard
              label="定投期数"
              value={`${snapshot.total_periods} 期`}
              tone="text-slate-900"
            />
            <MetricCard label="累计投入" value={formatMoney(snapshot.total_invested)} tone="text-slate-900" />
            <MetricCard label="期末市值" value={formatMoney(snapshot.final_value)} tone="text-slate-900" />
            <MetricCard label="累计盈亏" value={formatMoney(snapshot.profit_loss)} tone={returnTone(snapshot.profit_loss)} />
            <MetricCard label="累计收益率" value={formatPercent(snapshot.profit_loss_pct)} tone={returnTone(snapshot.profit_loss_pct)} />
            <MetricCard
              label="一次性买入收益率"
              value={formatPercent(snapshot.lump_sum_return_pct)}
              tone={returnTone(snapshot.lump_sum_return_pct)}
            />
            <MetricCard
              label="年化收益率"
              value={formatPercent(snapshot.annualized_return_pct)}
              tone={returnTone(snapshot.annualized_return_pct)}
            />
            <MetricCard
              label="最大回撤"
              value={snapshot.max_drawdown_pct === null ? "—" : `-${formatNumber(snapshot.max_drawdown_pct)}%`}
              tone={drawdownTone(snapshot.max_drawdown_pct)}
            />
            <MetricCard
              label="当前回撤"
              value={snapshot.current_drawdown_pct === null ? "—" : `-${formatNumber(snapshot.current_drawdown_pct)}%`}
              tone={drawdownTone(snapshot.current_drawdown_pct)}
            />
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">收益率变化曲线</h3>
              <p className="text-xs text-muted-foreground">悬停查看单日投入、市值与收益率。</p>
            </div>
            <DcaReturnChart
              points={snapshot.equity_curve}
              drawdownStart={snapshot.max_drawdown_start_date}
              drawdownEnd={snapshot.max_drawdown_end_date}
              recoveryStart={snapshot.recovery_start_date}
              recoveryEnd={snapshot.recovery_end_date}
              recoveryComplete={snapshot.recovery_complete}
            />
          </div>


          {snapshot.frequency === "monthly" && snapshot.payday_comparison.length > 0 ? (
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">组合定投收益率曲线</h3>
                <p className="text-xs text-muted-foreground">每月固定扣款日对定投结果的影响。</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-2 py-2">扣款日</th>
                      <th className="px-2 py-2">区间收益率</th>
                      <th className="px-2 py-2">区间收益率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.payday_comparison.map((item) => (
                      <tr key={item.day} className="border-b last:border-0">
                        <td className="px-2 py-3">?? {item.day} ?</td>
                        <td className={`px-2 py-3 font-medium ${returnTone(item.total_return_pct)}`}>
                          {item.total_return_pct === null ? "?" : `${item.total_return_pct > 0 ? "+" : ""}${item.total_return_pct.toFixed(2)}%`}
                        </td>
                        <td className={`px-2 py-3 font-medium ${returnTone(item.annualized_return_pct)}`}>
                          {item.annualized_return_pct === null ? "?" : `${item.annualized_return_pct > 0 ? "+" : ""}${item.annualized_return_pct.toFixed(2)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">定投 vs 一次性买入</h3>
              <p className="text-xs text-muted-foreground">同区间等额本金一次性投入与定投策略对比。</p>
            </div>
            <DcaComparisonChart
              dcaPoints={snapshot.equity_curve}
              lumpSumPoints={snapshot.lump_sum_curve}
            />
          </div>

          {snapshot.frequency !== "daily" ? (
            <div className="mt-3 border-t pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowTable((value) => !value)}
              >
                {showTable ? "收起定投明细" : "查看定投明细"}
              </Button>
            </div>
          ) : null}

          {showTable && snapshot.frequency !== "daily" ? (
            <>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-2 py-2">定投日期</th>
                      <th className="px-2 py-2">单位净值</th>
                      <th className="px-2 py-2">本期投入</th>
                      <th className="px-2 py-2">累计投入</th>
                      <th className="px-2 py-2">累计份额</th>
                      <th className="px-2 py-2">当日市值</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleContributions.map((item) => (
                      <tr key={item.date} className="border-b last:border-0">
                        <td className="px-2 py-3">{item.date}</td>
                        <td className="px-2 py-3">{formatNumber(item.nav, 4)}</td>
                        <td className="px-2 py-3">{formatMoney(item.amount)}</td>
                        <td className="px-2 py-3">{formatMoney(item.cumulative_invested)}</td>
                        <td className="px-2 py-3">{formatNumber(item.cumulative_shares, 6)}</td>
                        <td className={`px-2 py-3 font-medium ${returnTone(item.market_value - item.cumulative_invested)}`}>
                          {formatMoney(item.market_value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((value) => Math.max(0, value - 1))}
                  disabled={currentPage === 0}
                >
                  上一页
                </Button>
                <span>
                  第 {currentPage + 1} / {totalPages} 页 · 共 {contributions.length} 期
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}
                  disabled={currentPage >= totalPages - 1}
                >
                  下一页
                </Button>
              </div>
            </>
          ) : null}

          <p className="mt-2 text-xs text-muted-foreground">
            {snapshot.name}（{snapshot.code}）· {frequencyLabel(snapshot.frequency)}
            {snapshot.amount_per_period > 0 ? `，每期 ${formatMoney(snapshot.amount_per_period)}` : ""} ·{" "}
            区间：{rangeLabel(snapshot.range)}；按单位净值计算，未单独处理分红，数据来源：{sourceLabel(snapshot.source)}。
          </p>
        </div>
      ) : null}
      {showPortfolio ? (
        <div className="mt-4 rounded-lg border bg-slate-50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">多基金组合定投</h3>
            <Button type="button" variant="outline" size="sm" onClick={() => setShowPortfolio(false)}>
              ??
            </Button>
          </div>
          <form onSubmit={handlePortfolioSubmit} className="flex flex-col gap-2">
            {portfolioRows.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  value={row.code}
                  onChange={(event) => updatePortfolioRow(index, "code", event.target.value)}
                  placeholder={`基金 ${index + 1}，如 510300`}
                  maxLength={6}
                  inputMode="numeric"
                  className="w-44 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                />
                <input
                  value={row.amount}
                  onChange={(event) => updatePortfolioRow(index, "amount", event.target.value)}
                  placeholder="每期金额"
                  inputMode="decimal"
                  className="w-32 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                />
                <button
                  type="button"
                  onClick={() => removePortfolioRow(index)}
                  disabled={portfolioRows.length <= 2}
                  className="rounded-md border px-2 py-2 text-sm text-muted-foreground disabled:opacity-40"
                  aria-label="删除基金"
                >
                  ??
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addPortfolioRow}
                disabled={portfolioRows.length >= 5}
              >
                + 添加基金
              </Button>
              <Button type="submit" size="sm" disabled={portfolioLoading}>
                {portfolioLoading ? "回测中..." : "开始回测"}
              </Button>
            </div>
          </form>

          {portfolioError ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {portfolioError}
            </div>
          ) : null}

          {portfolioSnapshot && !portfolioSnapshot.available ? (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {portfolioSnapshot.reason ?? "当前无法计算组合定投回测。"}
            </div>
          ) : null}

          {portfolioSnapshot?.available ? (
            <div className="mt-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <MetricCard
                  label="每期总额"
                  value={formatMoney(portfolioSnapshot.amount_per_period)}
                  tone="text-slate-900"
                />
                <MetricCard
                  label="每期总额"
                  value={formatMoney(portfolioSnapshot.total_invested)}
                  tone="text-slate-900"
                />
                <MetricCard
                  label="每期总额"
                  value={formatMoney(portfolioSnapshot.total_value)}
                  tone="text-slate-900"
                />
                <MetricCard
                  label="每期总额"
                  value={formatMoney(portfolioSnapshot.profit_loss)}
                  tone={returnTone(portfolioSnapshot.profit_loss)}
                />
                <MetricCard
                  label="累计收益率"
                  value={formatPercent(portfolioSnapshot.profit_loss_pct)}
                  tone={returnTone(portfolioSnapshot.profit_loss_pct)}
                />
                <MetricCard
                  label="累计收益率"
                  value={formatPercent(portfolioSnapshot.annualized_return_pct)}
                  tone={returnTone(portfolioSnapshot.annualized_return_pct)}
                />
                <MetricCard
                  label="每期总额"
                  value={portfolioSnapshot.max_drawdown_pct === null ? "?" : `-${formatNumber(portfolioSnapshot.max_drawdown_pct)}%`}
                  tone={drawdownTone(portfolioSnapshot.max_drawdown_pct)}
                />
                <MetricCard
                  label="每期总额"
                  value={portfolioSnapshot.current_drawdown_pct === null ? "?" : `-${formatNumber(portfolioSnapshot.current_drawdown_pct)}%`}
                  tone={drawdownTone(portfolioSnapshot.current_drawdown_pct)}
                />
              </div>
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">组合定投收益率曲线</h3>
                  <p className="text-xs text-muted-foreground">鼠标悬停查看组合市值、投入与收益率。</p>
                </div>
                <DcaReturnChart points={portfolioSnapshot.equity_curve} />
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4">
          <Button type="button" variant="outline" size="sm" onClick={() => setShowPortfolio(true)}>
            多基金组合定投
          </Button>
        </div>
      )}

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
