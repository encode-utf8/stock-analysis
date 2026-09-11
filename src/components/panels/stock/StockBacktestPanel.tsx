"use client";

import { useState } from "react";
import type { FormEvent } from "react";

import { BacktestEquityChart } from "@/components/panels/stock/BacktestEquityChart";
import { Button } from "@/components/ui/button";
import { NoticeDialog } from "@/components/ui/notice-dialog";
import { formatDateTime } from "@/lib/format";
import { BACKTEST_STRATEGY_DEFAULTS } from "@/lib/shared/types";
import type {
  BacktestPeriod,
  BacktestRebalance,
  BacktestResult,
  BacktestStrategyId,
} from "@/lib/shared/types";

const REQUEST_TIMEOUT_MS = 60_000;

const SINGLE_STRATEGIES: Array<{ value: Exclude<BacktestStrategyId, "portfolio-rebalance">; label: string }> = [
  { value: "ma-cross", label: "双均线金叉死叉" },
  { value: "macd-cross", label: "MACD 金叉死叉" },
  { value: "rsi-reversal", label: "RSI 超买超卖反转" },
  { value: "boll-breakout", label: "布林带突破" },
];

const REBALANCE_OPTIONS: Array<{ value: BacktestRebalance; label: string }> = [
  { value: "none", label: "不再平衡" },
  { value: "monthly", label: "每月再平衡" },
  { value: "quarterly", label: "每季度再平衡" },
  { value: "yearly", label: "每年再平衡" },
];

class ApiError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload = (await response.json().catch(() => null)) as {
      success?: boolean;
      data?: T;
      error?: { code?: string; message?: string };
    } | null;
    if (!payload?.success || payload.data === undefined) {
      throw new ApiError(payload?.error?.code ?? "INTERNAL_ERROR", payload?.error?.message ?? "回测请求失败。");
    }
    return payload.data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("回测超时，请缩短区间或稍后重试。");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatMoney(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  const sign = value < 0 ? "-" : "";
  return `${sign}¥${Math.abs(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatRatio(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(2);
}

function returnTone(value: number | null): string {
  if (value === null || value === 0) {
    return "text-slate-900";
  }
  return value > 0 ? "text-red-700" : "text-green-700";
}

function MetricCard({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={"mt-1 text-base font-semibold " + (tone ?? "text-slate-900")}>{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

const inputClass =
  "h-9 rounded-md border bg-white px-2 text-sm text-slate-900 outline-none focus:border-primary";

/** 个股策略回测面板：单标的规则回测 + 组合权重再平衡回测。 */
export function StockBacktestPanel() {
  const [mode, setMode] = useState<"single" | "portfolio">("single");
  const [code, setCode] = useState("600519");
  const [strategy, setStrategy] = useState<Exclude<BacktestStrategyId, "portfolio-rebalance">>("ma-cross");
  const [klinePeriod, setKlinePeriod] = useState<BacktestPeriod>("day");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [initialCapital, setInitialCapital] = useState("100000");
  const [feePercent, setFeePercent] = useState("0.025");
  const [stampPercent, setStampPercent] = useState("0.05");
  const [slippagePercent, setSlippagePercent] = useState("0.1");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [params, setParams] = useState<Record<string, string>>({
    fast: String(BACKTEST_STRATEGY_DEFAULTS["ma-cross"].fast),
    slow: String(BACKTEST_STRATEGY_DEFAULTS["ma-cross"].slow),
    signal: String(BACKTEST_STRATEGY_DEFAULTS["macd-cross"].signal),
    period: String(BACKTEST_STRATEGY_DEFAULTS["rsi-reversal"].period),
    oversold: String(BACKTEST_STRATEGY_DEFAULTS["rsi-reversal"].oversold),
    overbought: String(BACKTEST_STRATEGY_DEFAULTS["rsi-reversal"].overbought),
    multiplier: String(BACKTEST_STRATEGY_DEFAULTS["boll-breakout"].multiplier),
  });
  const [rebalance, setRebalance] = useState<BacktestRebalance>("quarterly");
  const [rows, setRows] = useState<Array<{ code: string; weight: string }>>([
    { code: "510300", weight: "60" },
    { code: "600519", weight: "40" },
  ]);

  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAllTrades, setShowAllTrades] = useState(false);

  const updateParam = (key: string, value: string) => {
    setParams((previous) => ({ ...previous, [key]: value }));
  };

  const updateRow = (index: number, field: "code" | "weight", value: string) => {
    setRows((previous) => previous.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)));
  };

  const addRow = () => {
    setRows((previous) => (previous.length < 5 ? [...previous, { code: "", weight: "" }] : previous));
  };

  const removeRow = (index: number) => {
    setRows((previous) => (previous.length > 2 ? previous.filter((_, rowIndex) => rowIndex !== index) : previous));
  };

  /** 按当前策略挑出真正需要提交的参数。 */
  const buildParams = () => {
    if (strategy === "ma-cross") {
      return { fast: Number(params.fast), slow: Number(params.slow) };
    }
    if (strategy === "macd-cross") {
      return { fast: Number(params.fast), slow: Number(params.slow), signal: Number(params.signal) };
    }
    if (strategy === "rsi-reversal") {
      return {
        period: Number(params.period),
        oversold: Number(params.oversold),
        overbought: Number(params.overbought),
      };
    }
    return { period: Number(params.period), multiplier: Number(params.multiplier) };
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const common = {
        period: klinePeriod,
        start: start || null,
        end: end || null,
        initial_capital: Number(initialCapital),
        fee_rate: Number(feePercent) / 100,
        stamp_duty_rate: Number(stampPercent) / 100,
        slippage_rate: Number(slippagePercent) / 100,
      };
      const body =
        mode === "portfolio"
          ? {
              ...common,
              strategy: "portfolio-rebalance" as const,
              params: {
                rebalance,
                items: rows.map((row) => ({ code: row.code, weight: Number(row.weight) })),
              },
            }
          : {
              ...common,
              code,
              strategy,
              params: buildParams(),
            };

      setResult(
        await apiFetch<BacktestResult>("/api/stock-backtest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      setShowAllTrades(false);
    } catch (nextError) {
      if (nextError instanceof ApiError && nextError.code === "CODE_NOT_FOUND") {
        setNotice(nextError.message);
      } else {
        setError(nextError instanceof Error ? nextError.message : "回测失败。");
      }
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const metrics = result?.metrics ?? null;
  const trades = result?.trades ?? [];
  const visibleTrades = showAllTrades ? trades : trades.slice(0, 20);
  const isRebalance = result?.strategy === "portfolio-rebalance";

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-base font-semibold">策略回测</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          用前复权历史 K 线验证交易规则：信号在收盘后产生、下一根 K 线开盘成交，计入手续费、印花税与滑点。
          结果仅用于学习，历史表现不代表未来。
        </p>
      </div>

      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={mode === "single" ? "default" : "outline"}
          onClick={() => setMode("single")}
        >
          单标的策略
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "portfolio" ? "default" : "outline"}
          onClick={() => setMode("portfolio")}
        >
          组合权重再平衡
        </Button>
      </div>

      {error ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-4 rounded-lg border bg-slate-50/60 p-3">
        <div className="grid gap-3 md:grid-cols-4">
          {mode === "single" ? (
            <>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                股票代码
                <input value={code} onChange={(event) => setCode(event.target.value)} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                策略
                <select
                  value={strategy}
                  onChange={(event) => setStrategy(event.target.value as typeof strategy)}
                  className={inputClass}
                >
                  {SINGLE_STRATEGIES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <div className="md:col-span-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>组合标的与目标权重（%，按合计值归一）</span>
                <Button type="button" size="sm" variant="outline" onClick={addRow} disabled={rows.length >= 5}>
                  添加标的
                </Button>
              </div>
              <div className="mt-2 flex flex-col gap-2">
                {rows.map((row, index) => (
                  <div key={index} className="flex gap-2">
                    <input
                      value={row.code}
                      onChange={(event) => updateRow(index, "code", event.target.value)}
                      placeholder="代码"
                      className={inputClass + " flex-1"}
                    />
                    <input
                      value={row.weight}
                      onChange={(event) => updateRow(index, "weight", event.target.value)}
                      placeholder="权重"
                      inputMode="decimal"
                      className={inputClass + " w-24"}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => removeRow(index)}
                      disabled={rows.length <= 2}
                    >
                      删除
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            K 线周期
            <select
              value={klinePeriod}
              onChange={(event) => setKlinePeriod(event.target.value as BacktestPeriod)}
              className={inputClass}
            >
              <option value="day">日线</option>
              <option value="week">周线</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            初始资金（元）
            <input
              value={initialCapital}
              onChange={(event) => setInitialCapital(event.target.value)}
              inputMode="decimal"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            起始日期（可选）
            <input type="date" value={start} onChange={(event) => setStart(event.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            结束日期（可选）
            <input type="date" value={end} onChange={(event) => setEnd(event.target.value)} className={inputClass} />
          </label>
        </div>

        {mode === "single" ? (
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            {strategy === "ma-cross" || strategy === "macd-cross" ? (
              <>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  快线周期
                  <input
                    value={params.fast}
                    onChange={(event) => updateParam("fast", event.target.value)}
                    inputMode="numeric"
                    className={inputClass}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  慢线周期
                  <input
                    value={params.slow}
                    onChange={(event) => updateParam("slow", event.target.value)}
                    inputMode="numeric"
                    className={inputClass}
                  />
                </label>
                {strategy === "macd-cross" ? (
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    信号线周期
                    <input
                      value={params.signal}
                      onChange={(event) => updateParam("signal", event.target.value)}
                      inputMode="numeric"
                      className={inputClass}
                    />
                  </label>
                ) : null}
              </>
            ) : null}

            {strategy === "rsi-reversal" ? (
              <>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  RSI 周期
                  <input
                    value={params.period}
                    onChange={(event) => updateParam("period", event.target.value)}
                    inputMode="numeric"
                    className={inputClass}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  超卖阈值
                  <input
                    value={params.oversold}
                    onChange={(event) => updateParam("oversold", event.target.value)}
                    inputMode="numeric"
                    className={inputClass}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  超买阈值
                  <input
                    value={params.overbought}
                    onChange={(event) => updateParam("overbought", event.target.value)}
                    inputMode="numeric"
                    className={inputClass}
                  />
                </label>
              </>
            ) : null}

            {strategy === "boll-breakout" ? (
              <>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  布林带周期
                  <input
                    value={params.period}
                    onChange={(event) => updateParam("period", event.target.value)}
                    inputMode="numeric"
                    className={inputClass}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  标准差倍数
                  <input
                    value={params.multiplier}
                    onChange={(event) => updateParam("multiplier", event.target.value)}
                    inputMode="decimal"
                    className={inputClass}
                  />
                </label>
              </>
            ) : null}
          </div>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              再平衡频率
              <select
                value={rebalance}
                onChange={(event) => setRebalance(event.target.value as BacktestRebalance)}
                className={inputClass}
              >
                {REBALANCE_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowAdvanced((previous) => !previous)}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {showAdvanced ? "收起交易成本设置" : "展开交易成本设置（默认万 2.5 手续费 / 万 5 印花税 / 千 1 滑点）"}
          </button>
          {showAdvanced ? (
            <div className="mt-2 grid gap-3 md:grid-cols-4">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                手续费率（%）
                <input
                  value={feePercent}
                  onChange={(event) => setFeePercent(event.target.value)}
                  inputMode="decimal"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                印花税率（%，卖出）
                <input
                  value={stampPercent}
                  onChange={(event) => setStampPercent(event.target.value)}
                  inputMode="decimal"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                滑点率（%）
                <input
                  value={slippagePercent}
                  onChange={(event) => setSlippagePercent(event.target.value)}
                  inputMode="decimal"
                  className={inputClass}
                />
              </label>
            </div>
          ) : null}
        </div>

        <div className="mt-3 flex justify-end">
          <Button type="submit" disabled={loading}>
            {loading ? "回测中..." : "开始回测"}
          </Button>
        </div>
      </form>

      {metrics && result ? (
        <div className="mt-5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-sm font-semibold">{result.strategy_label}</h3>
            <span className="text-xs text-muted-foreground">
              {result.params_label} · {result.period === "day" ? "日线" : "周线"} · 前复权 ·{" "}
              {metrics.start_date} 至 {metrics.end_date}（{metrics.bars} 根）
            </span>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="策略总收益"
              value={formatPercent(metrics.total_return_pct)}
              hint={`期末 ${formatMoney(metrics.final_equity)}`}
              tone={returnTone(metrics.total_return_pct)}
            />
            <MetricCard
              label="买入持有基准"
              value={formatPercent(metrics.benchmark_return_pct)}
              hint={metrics.total_return_pct >= metrics.benchmark_return_pct ? "策略跑赢基准" : "策略跑输基准"}
              tone={returnTone(metrics.benchmark_return_pct)}
            />
            <MetricCard label="年化收益" value={formatPercent(metrics.annualized_return_pct)} tone={returnTone(metrics.annualized_return_pct)} />
            <MetricCard label="年化波动" value={formatPercent(metrics.annualized_volatility_pct)} />
            <MetricCard
              label="最大回撤"
              value={formatPercent(-metrics.max_drawdown_pct)}
              hint={`${metrics.max_drawdown_start} → ${metrics.max_drawdown_end}`}
              tone="text-green-700"
            />
            <MetricCard
              label="最大回撤修复"
              value={metrics.max_drawdown_recovery_complete ? metrics.max_drawdown_recovery_end ?? "已修复" : "尚未修复"}
              hint={metrics.max_drawdown_recovery_complete ? "已回到前高" : "仍在回撤中"}
            />
            <MetricCard label="夏普比率" value={formatRatio(metrics.sharpe)} hint={`索提诺 ${formatRatio(metrics.sortino)}`} />
            <MetricCard label="卡玛比率" value={formatRatio(metrics.calmar)} />
            <MetricCard
              label={isRebalance ? "调仓次数" : "交易次数"}
              value={String(metrics.trade_count)}
              hint={isRebalance ? "按再平衡周期统计" : `平均持有 ${metrics.average_holding_days ?? "—"} 天`}
            />
            <MetricCard
              label="胜率"
              value={metrics.win_rate_pct === null ? "不适用" : formatPercent(metrics.win_rate_pct)}
              hint={metrics.win_rate_pct === null ? "组合再平衡不统计单笔胜率" : "仅统计已平仓交易"}
            />
          </div>

          <div className="mt-4">
            <BacktestEquityChart points={result.equity_curve} initialCapital={result.initial_capital} />
          </div>

          {result.warnings.length > 0 ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-700">
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}

          <div className="mt-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">{isRebalance ? "调仓明细" : "交易明细"}</h4>
              {trades.length > 20 ? (
                <Button type="button" size="sm" variant="outline" onClick={() => setShowAllTrades((previous) => !previous)}>
                  {showAllTrades ? "只看前 20 条" : `展开全部 ${trades.length} 条`}
                </Button>
              ) : null}
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">标的</th>
                    <th className="py-2 pr-3 font-medium">开始日期</th>
                    <th className="py-2 pr-3 font-medium">结束日期</th>
                    <th className="py-2 pr-3 font-medium">买入价</th>
                    <th className="py-2 pr-3 font-medium">卖出价</th>
                    <th className="py-2 pr-3 font-medium">盈亏</th>
                    <th className="py-2 pr-3 font-medium">收益率</th>
                    <th className="py-2 pr-3 font-medium">持有天数</th>
                    <th className="py-2 pr-3 font-medium">说明</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTrades.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-6 text-center text-sm text-muted-foreground">
                        区间内没有产生交易信号，可尝试调整参数或拉长区间。
                      </td>
                    </tr>
                  ) : null}
                  {visibleTrades.map((trade, index) => (
                    <tr key={`${trade.code}-${trade.exit_date}-${index}`} className="border-b">
                      <td className="py-2 pr-3">{trade.code}</td>
                      <td className="py-2 pr-3">{trade.entry_date}</td>
                      <td className="py-2 pr-3">{trade.exit_date}</td>
                      <td className="py-2 pr-3">{trade.entry_price.toFixed(2)}</td>
                      <td className="py-2 pr-3">{trade.exit_price.toFixed(2)}</td>
                      <td className={"py-2 pr-3 " + returnTone(trade.pnl)}>{formatMoney(trade.pnl)}</td>
                      <td className={"py-2 pr-3 " + returnTone(trade.pnl_pct)}>{formatPercent(trade.pnl_pct)}</td>
                      <td className="py-2 pr-3">{trade.holding_days}</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">{trade.exit_reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            回测时间为 {formatDateTime(result.generated_at)}。简化假设：允许小数股、按成交金额比例计费、不考虑停牌与涨跌停无法成交；
            结果仅供学习，不构成投资建议。
          </p>
        </div>
      ) : null}

      <NoticeDialog
        open={notice !== null}
        title="当前无数据"
        description={notice ?? undefined}
        onClose={() => setNotice(null)}
      />
    </section>
  );
}