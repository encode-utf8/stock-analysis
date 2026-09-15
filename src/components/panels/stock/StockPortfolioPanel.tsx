"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { NoticeDialog } from "@/components/ui/notice-dialog";
import { formatDateTime, freshnessText, sourceLabel } from "@/lib/format";
import type { StockHoldingValuation, StockPortfolioSnapshot } from "@/lib/shared/types";

const REQUEST_TIMEOUT_MS = 30_000;

/** 带错误码的接口异常，便于识别「代码无数据」这类需要弹窗的场景。 */
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
      throw new ApiError(payload?.error?.code ?? "INTERNAL_ERROR", payload?.error?.message ?? "请求失败。");
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

function formatMoney(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  const sign = value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

/** 涨红跌绿，与项目其它面板保持一致。 */
function returnTone(value: number | null): string {
  if (value === null || value === 0) {
    return "text-slate-900";
  }
  return value > 0 ? "text-red-700" : "text-green-700";
}

function MetricCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={"mt-1 text-lg font-semibold " + (tone ?? "text-slate-900")}>{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function WeightBar({
  label,
  sublabel,
  percent,
}: {
  label: string;
  sublabel: string;
  percent: number;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {sublabel} · {percent.toFixed(2)}%
        </span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded bg-slate-100">
        <div
          className="h-full rounded bg-primary/70"
          style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }}
        />
      </div>
    </div>
  );
}

/** 个股持仓组合面板：手动录入投入金额与当前收益，按最新行情估值汇总。 */
export function StockPortfolioPanel() {
  const [snapshot, setSnapshot] = useState<StockPortfolioSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [amount, setAmount] = useState("");
  const [profit, setProfit] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editProfit, setEditProfit] = useState("");
  const [editNote, setEditNote] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StockHoldingValuation | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await apiFetch<StockPortfolioSnapshot>("/api/stock-portfolio"));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "持仓加载失败。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 放进微任务回调，避免在 effect 同步路径里直接 setState。
    void Promise.resolve().then(() => load());
  }, [load]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await apiFetch<StockHoldingValuation>("/api/stock-portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, amount, profit, note }),
      });
      setCode("");
      setAmount("");
      setProfit("");
      setNote("");
      await load();
    } catch (nextError) {
      if (nextError instanceof ApiError && nextError.code === "CODE_NOT_FOUND") {
        setNotice(nextError.message);
      } else {
        setFormError(nextError instanceof Error ? nextError.message : "新增持仓失败。");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (valuation: StockHoldingValuation) => {
    setEditingId(valuation.holding.id);
    setEditAmount(String(valuation.holding.amount));
    setEditProfit(String(valuation.holding.profit));
    setEditNote(valuation.holding.note ?? "");
  };

  const handleSaveEdit = async (id: string) => {
    setSavingId(id);
    setFormError(null);
    try {
      await apiFetch<StockHoldingValuation>(`/api/stock-portfolio/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: editAmount, profit: editProfit, note: editNote }),
      });
      setEditingId(null);
      await load();
    } catch (nextError) {
      setFormError(nextError instanceof Error ? nextError.message : "保存失败。");
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    setDeleting(true);
    try {
      await apiFetch<{ id: string }>(`/api/stock-portfolio/${deleteTarget.holding.id}`, {
        method: "DELETE",
      });
      setDeleteTarget(null);
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "删除失败。");
    } finally {
      setDeleting(false);
    }
  };

  const summary = snapshot?.summary ?? null;
  const holdings = snapshot?.holdings ?? [];

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">我的持仓组合</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            手动记录每只票的投入金额与当前持仓收益，市值与收益率自动推导，并结合最新行情估算当日盈亏。
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? "刷新中..." : "刷新行情"}
        </Button>
      </div>

      {error ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}
      {formError ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {formError}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-4 grid gap-3 rounded-lg border bg-slate-50/60 p-3 md:grid-cols-5">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          股票代码
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="如 600519"
            inputMode="numeric"
            className="h-9 rounded-md border bg-white px-2 text-sm text-slate-900 outline-none focus:border-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          投入金额（元）
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="如 100000"
            inputMode="decimal"
            className="h-9 rounded-md border bg-white px-2 text-sm text-slate-900 outline-none focus:border-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          目前持仓收益（元）
          <input
            value={profit}
            onChange={(event) => setProfit(event.target.value)}
            placeholder="亏损填负数"
            inputMode="decimal"
            className="h-9 rounded-md border bg-white px-2 text-sm text-slate-900 outline-none focus:border-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          备注（可选）
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="如 长期持有"
            className="h-9 rounded-md border bg-white px-2 text-sm text-slate-900 outline-none focus:border-primary"
          />
        </label>
        <div className="flex items-end">
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "添加中..." : "添加持仓"}
          </Button>
        </div>
      </form>

      {summary ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="总投入" value={formatMoney(summary.total_amount)} hint={`${summary.holdings_count} 只标的`} />
          <MetricCard label="总市值" value={formatMoney(summary.total_market_value)} />
          <MetricCard
            label="累计收益"
            value={formatMoney(summary.total_profit)}
            hint={formatPercent(summary.total_profit_pct)}
            tone={returnTone(summary.total_profit)}
          />
          <MetricCard
            label="当日盈亏"
            value={formatMoney(summary.day_profit)}
            hint={summary.day_profit === null ? "行情不可用" : "按最新价与当日涨跌幅估算"}
            tone={returnTone(summary.day_profit)}
          />
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-medium">标的</th>
              <th className="py-2 pr-3 font-medium">投入金额</th>
              <th className="py-2 pr-3 font-medium">持仓收益</th>
              <th className="py-2 pr-3 font-medium">收益率</th>
              <th className="py-2 pr-3 font-medium">市值</th>
              <th className="py-2 pr-3 font-medium">当日盈亏</th>
              <th className="py-2 pr-3 font-medium">最新价</th>
              <th className="py-2 pr-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {holdings.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  {loading ? "正在加载持仓..." : "还没有持仓记录，用上面的表单添加第一只票。"}
                </td>
              </tr>
            ) : null}
            {holdings.map((valuation) => {
              const { holding } = valuation;
              const editing = editingId === holding.id;
              return (
                <tr key={holding.id} className="border-b align-top">
                  <td className="py-2 pr-3">
                    <div className="font-medium">{holding.name}</div>
                    <div className="text-xs text-muted-foreground">{holding.code}</div>
                    {holding.note ? (
                      <div className="mt-0.5 text-xs text-muted-foreground">备注：{holding.note}</div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3">
                    {editing ? (
                      <input
                        value={editAmount}
                        onChange={(event) => setEditAmount(event.target.value)}
                        inputMode="decimal"
                        className="h-8 w-28 rounded-md border px-2 text-sm"
                      />
                    ) : (
                      formatMoney(holding.amount)
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {editing ? (
                      <input
                        value={editProfit}
                        onChange={(event) => setEditProfit(event.target.value)}
                        inputMode="decimal"
                        className="h-8 w-28 rounded-md border px-2 text-sm"
                      />
                    ) : (
                      <span className={returnTone(holding.profit)}>{formatMoney(holding.profit)}</span>
                    )}
                  </td>
                  <td className={"py-2 pr-3 " + returnTone(valuation.profit_pct)}>
                    {formatPercent(valuation.profit_pct)}
                  </td>
                  <td className="py-2 pr-3">{formatMoney(valuation.market_value)}</td>
                  <td className={"py-2 pr-3 " + returnTone(valuation.day_profit)}>
                    {formatMoney(valuation.day_profit)}
                  </td>
                  <td className="py-2 pr-3">
                    {valuation.quote_available ? (
                      <>
                        <div>{valuation.price?.toFixed(2)}</div>
                        <div className={"text-xs " + returnTone(valuation.change_pct)}>
                          {formatPercent(valuation.change_pct)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {valuation.source ? sourceLabel(valuation.source) : ""}
                          {valuation.fetched_at ? ` · ${freshnessText(valuation.fetched_at)}` : ""}
                        </div>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">行情不可用</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap gap-2">
                      {editing ? (
                        <>
                          <input
                            value={editNote}
                            onChange={(event) => setEditNote(event.target.value)}
                            placeholder="备注"
                            className="h-8 w-28 rounded-md border px-2 text-sm"
                          />
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void handleSaveEdit(holding.id)}
                            disabled={savingId === holding.id}
                          >
                            {savingId === holding.id ? "保存中..." : "保存"}
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => setEditingId(null)}>
                            取消
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button type="button" size="sm" variant="outline" onClick={() => startEdit(valuation)}>
                            修改
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => setDeleteTarget(valuation)}>
                            删除
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {summary && holdings.length > 0 ? (
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold">持仓权重</h3>
            <div className="mt-2 flex flex-col gap-2">
              {summary.weights.map((item) => (
                <WeightBar
                  key={item.code}
                  label={item.name}
                  sublabel={formatMoney(item.market_value)}
                  percent={item.weight_pct}
                />
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold">行业分布</h3>
            <div className="mt-2 flex flex-col gap-2">
              {summary.industry_allocation.map((item) => (
                <WeightBar
                  key={item.industry}
                  label={item.industry}
                  sublabel={formatMoney(item.market_value)}
                  percent={item.weight_pct}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {snapshot ? (
        <p className="mt-4 text-xs text-muted-foreground">
          {snapshot.source_note} 组合汇总时间：{formatDateTime(snapshot.summary.generated_at)}。
        </p>
      ) : null}
      <p className="mt-1 text-xs text-muted-foreground">
        组合数据仅保存在本地，用于学习记录；市值与当日盈亏为估算值，不构成投资建议。
      </p>

      <NoticeDialog
        open={notice !== null}
        title="当前无数据"
        description={notice ?? undefined}
        onClose={() => setNotice(null)}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除持仓"
        description={
          deleteTarget
            ? `确认删除 ${deleteTarget.holding.name}（${deleteTarget.holding.code}）的持仓记录？删除后无法恢复。`
            : undefined
        }
        confirmLabel="确认删除"
        loading={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}