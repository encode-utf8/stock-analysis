"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { NoticeDialog } from "@/components/ui/notice-dialog";
import {
  DEFAULT_FUND_PROFIT_CALIBER,
  normalizeFundProfitCaliber,
} from "@/lib/fund-position-calc";
import { formatDateTime, freshnessText, sourceLabel } from "@/lib/format";
import type {
  FundPositionNavMode,
  FundPositionSnapshot,
  FundPositionValuation,
  FundProfitCaliber,
} from "@/lib/shared/types";

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
      throw new ApiError(
        payload?.error?.code ?? "INTERNAL_ERROR",
        payload?.error?.message ?? "请求失败。",
      );
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
  return `${sign}¥${Math.abs(value).toLocaleString("zh-CN", {
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

/** 收益类金额：正数前显式加「+」，负数保留「-」，与涨红跌绿配色配套。 */
function formatSignedMoney(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  const body = `¥${Math.abs(value).toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
  if (value > 0) {
    return `+${body}`;
  }
  return value < 0 ? `-${body}` : body;
}

function formatNav(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(4);
}

/** 涨红跌绿，与项目其它面板保持一致。 */
function returnTone(value: number | null): string {
  if (value === null || value === 0) {
    return "text-slate-900";
  }
  return value > 0 ? "text-red-700" : "text-green-700";
}

/** 净值口径中文标签，用于表格中的来源提示。 */
const NAV_MODE_LABELS: Record<FundPositionNavMode, string> = {
  estimate: "盘中估算",
  realtime: "场内实时",
  nav: "官方净值",
  unavailable: "暂不可用",
};

/** 累计收益口径的下拉选项（录入表单与行内编辑共用）。 */
const PROFIT_CALIBER_OPTIONS: Array<{ value: FundProfitCaliber; label: string }> = [
  { value: "include_today", label: "含当日收益" },
  { value: "exclude_today", label: "不含当日收益" },
];

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

/** 持有基金面板：只录入代码、当前持有金额与当前累计收益，当日收益由盘中涨跌幅推导。 */
export function FundPositionsPanel() {
  const [snapshot, setSnapshot] = useState<FundPositionSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [amount, setAmount] = useState("");
  const [profit, setProfit] = useState("");
  // 录入的累计收益是否已含当日收益，缺省「含当日」（与历史数据一致）。
  const [caliber, setCaliber] = useState<FundProfitCaliber>(DEFAULT_FUND_PROFIT_CALIBER);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editProfit, setEditProfit] = useState("");
  const [editCaliber, setEditCaliber] = useState<FundProfitCaliber>(DEFAULT_FUND_PROFIT_CALIBER);
  const [editNote, setEditNote] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FundPositionValuation | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await apiFetch<FundPositionSnapshot>("/api/fund-positions"));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "持有基金加载失败。");
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
      await apiFetch<FundPositionValuation>("/api/fund-positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, amount, profit, profit_caliber: caliber, note }),
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
        setFormError(nextError instanceof Error ? nextError.message : "新增持有基金失败。");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (valuation: FundPositionValuation) => {
    setEditingId(valuation.position.id);
    setEditAmount(String(valuation.position.amount));
    setEditProfit(String(valuation.position.profit));
    setEditCaliber(normalizeFundProfitCaliber(valuation.position.profit_caliber));
    setEditNote(valuation.position.note ?? "");
  };

  const handleSaveEdit = async (id: string) => {
    setSavingId(id);
    setFormError(null);
    try {
      await apiFetch<FundPositionValuation>(`/api/fund-positions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: editAmount,
          profit: editProfit,
          profit_caliber: editCaliber,
          note: editNote,
        }),
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
      await apiFetch<{ id: string }>(`/api/fund-positions/${deleteTarget.position.id}`, {
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
          <h2 className="text-base font-semibold">我的持有基金</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            只录入基金代码、当前持有金额、当前累计收益与「累计收益口径」；持有金额与累计收益是同口径的一对，
            当日收益按盘中涨跌幅折算，恒满足「上一交易日累计收益 + 当日实时收益 = 当前累计收益」。
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

      <form onSubmit={handleSubmit} className="mt-4 grid gap-3 rounded-lg border bg-slate-50/60 p-3 lg:grid-cols-6">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          基金代码
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="如 110022"
            inputMode="numeric"
            className="h-9 rounded-md border bg-white px-2 text-sm text-slate-900 outline-none focus:border-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          当前持有金额（元）
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="如 15000"
            inputMode="decimal"
            className="h-9 rounded-md border bg-white px-2 text-sm text-slate-900 outline-none focus:border-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          当前累计收益（元）
          <input
            value={profit}
            onChange={(event) => setProfit(event.target.value)}
            placeholder="亏损填负数"
            inputMode="decimal"
            className="h-9 rounded-md border bg-white px-2 text-sm text-slate-900 outline-none focus:border-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          累计收益口径
          <select
            value={caliber}
            onChange={(event) => setCaliber(normalizeFundProfitCaliber(event.target.value))}
            aria-label="累计收益口径"
            className="h-9 rounded-md border bg-white px-2 text-sm text-slate-900 outline-none focus:border-primary"
          >
            {PROFIT_CALIBER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          备注（可选）
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="如 定投中"
            className="h-9 rounded-md border bg-white px-2 text-sm text-slate-900 outline-none focus:border-primary"
          />
        </label>
        <div className="flex items-end">
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "添加中..." : "添加持有基金"}
          </Button>
        </div>
      </form>

      <p className="mt-2 text-xs text-muted-foreground">
        口径说明：「含当日收益」= 你填的持有金额与累计收益都已含今日盘中估算，系统反推上一交易日市值与累计收益；
        「不含当日收益」= 你填的是截至上一交易日收盘的持有金额与累计收益，系统用当日涨跌幅折算当前市值与当前累计收益。
        持有金额与累计收益必须同口径：选「不含当日收益」且取不到当日行情时，当前市值、当前累计收益与占比留空，不会用 0 冒充。
      </p>

      {summary ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="总持有金额"
            value={formatMoney(summary.total_market_value)}
            hint={`${summary.holdings_count} 只基金`}
          />
          <MetricCard
            label="推算本金"
            value={formatMoney(summary.total_cost)}
            hint="总持有金额 − 总累计收益"
          />
          <MetricCard
            label="累计收益"
            value={formatSignedMoney(summary.total_profit)}
            hint={
              summary.total_profit === null
                ? "部分持仓缺少当日涨跌幅，无法折算合计"
                : formatPercent(summary.total_profit_pct)
            }
            tone={returnTone(summary.total_profit)}
          />
          <MetricCard
            label="当日收益合计"
            value={formatSignedMoney(summary.total_day_profit)}
            hint={summary.total_day_profit === null ? "盘中行情不可用" : "按盘中涨跌幅估算"}
            tone={returnTone(summary.total_day_profit)}
          />
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[1120px] border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-medium">基金</th>
              <th className="py-2 pr-3 font-medium">持有金额</th>
              <th className="py-2 pr-3 font-medium">当日涨跌幅</th>
              <th className="py-2 pr-3 font-medium">当日收益</th>
              <th className="py-2 pr-3 font-medium">累计收益</th>
              <th className="py-2 pr-3 font-medium">昨收净值</th>
              <th className="py-2 pr-3 font-medium">实时估值</th>
              <th className="py-2 pr-3 font-medium">累计收益率</th>
              <th className="py-2 pr-3 font-medium">占比</th>
              <th className="py-2 pr-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {holdings.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                  {loading ? "正在加载持有基金..." : "还没有持有记录，用上面的表单添加第一只基金。"}
                </td>
              </tr>
            ) : null}
            {holdings.map((valuation) => {
              const { position } = valuation;
              const editing = editingId === position.id;
              return (
                <tr key={position.id} className="border-b align-top">
                  <td className="py-2 pr-3">
                    <div className="font-medium">{position.name}</div>
                    <div className="text-xs text-muted-foreground">{position.code}</div>
                    {position.note ? (
                      <div className="mt-0.5 text-xs text-muted-foreground">备注：{position.note}</div>
                    ) : null}
                    {editing ? (
                      <select
                        value={editCaliber}
                        onChange={(event) =>
                          setEditCaliber(normalizeFundProfitCaliber(event.target.value))
                        }
                        aria-label="修改累计收益口径"
                        className="mt-1 h-7 rounded-md border px-1 text-xs"
                      >
                        {PROFIT_CALIBER_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3">
                    {editing ? (
                      <input
                        value={editAmount}
                        onChange={(event) => setEditAmount(event.target.value)}
                        placeholder="持有金额"
                        inputMode="decimal"
                        className="h-8 w-28 rounded-md border px-2 text-sm"
                      />
                    ) : (
                      <>
                        <div>{formatMoney(valuation.market_value)}</div>
                        <div className="text-xs text-muted-foreground">
                          本金 {formatMoney(valuation.cost_amount)}
                        </div>
                      </>
                    )}
                  </td>
                  <td className={"py-2 pr-3 " + returnTone(valuation.change_pct)}>
                    {formatPercent(valuation.change_pct)}
                  </td>
                  <td className={"py-2 pr-3 " + returnTone(valuation.day_profit)}>
                    {formatSignedMoney(valuation.day_profit)}
                  </td>
                  <td className={"py-2 pr-3 " + returnTone(valuation.total_profit)}>
                    {editing ? (
                      <input
                        value={editProfit}
                        onChange={(event) => setEditProfit(event.target.value)}
                        placeholder="累计收益"
                        inputMode="decimal"
                        className="h-8 w-28 rounded-md border px-2 text-sm"
                      />
                    ) : (
                      <>
                        <div>{formatSignedMoney(valuation.total_profit)}</div>
                        <div className="text-xs text-muted-foreground">
                          昨日累计 {formatSignedMoney(valuation.prev_total_profit)}
                        </div>
                        {valuation.total_profit === null ? (
                          <div className="text-xs text-amber-600">缺当日涨跌幅，无法折算当前累计收益</div>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td className="py-2 pr-3">{formatNav(valuation.prev_nav)}</td>
                  <td className="py-2 pr-3">
                    <div>{formatNav(valuation.estimated_nav)}</div>
                    <div className="text-xs text-muted-foreground">
                      {NAV_MODE_LABELS[valuation.nav_mode]}
                      {valuation.source ? ` · ${sourceLabel(valuation.source)}` : ""}
                    </div>
                    {valuation.fetched_at ? (
                      <div className="text-xs text-muted-foreground">{freshnessText(valuation.fetched_at)}</div>
                    ) : null}
                  </td>
                  <td className={"py-2 pr-3 " + returnTone(valuation.total_profit_pct)}>
                    {formatPercent(valuation.total_profit_pct)}
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="w-14 shrink-0">
                        {valuation.weight_pct === null ? "—" : `${valuation.weight_pct.toFixed(2)}%`}
                      </span>
                      <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded bg-slate-100">
                        <span
                          className="block h-full rounded bg-primary/70"
                          style={{
                            width: `${valuation.weight_pct === null ? 0 : Math.min(Math.max(valuation.weight_pct, 0), 100)}%`,
                          }}
                        />
                      </span>
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap gap-2">
                      {editing ? (
                        <>
                          <input
                            value={editNote}
                            onChange={(event) => setEditNote(event.target.value)}
                            placeholder="备注"
                            className="h-8 w-24 rounded-md border px-2 text-sm"
                          />
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void handleSaveEdit(position.id)}
                            disabled={savingId === position.id}
                          >
                            {savingId === position.id ? "保存中..." : "保存"}
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
        <p className="mt-3 text-xs text-muted-foreground">
          合计：持有金额 {formatMoney(summary.total_market_value)} · 推算本金 {formatMoney(summary.total_cost)} ·
          累计收益 {formatSignedMoney(summary.total_profit)}（{formatPercent(summary.total_profit_pct)}）· 当日收益{" "}
          {formatSignedMoney(summary.total_day_profit)}
        </p>
      ) : null}

      {snapshot ? (
        <p className="mt-4 text-xs text-muted-foreground">
          {snapshot.source_note} 汇总时间：{formatDateTime(snapshot.summary.generated_at)}。
        </p>
      ) : null}
      <p className="mt-1 text-xs text-muted-foreground">
        当前持有金额、累计收益与口径均为手动录入；当日收益按「当前市值 − 上一交易日市值」估算，取不到盘中行情时该列显示为空。
        含当日口径：录入值即当前市值，上一交易日市值 = 录入值 /（1 + 当日涨跌幅）；不含当日口径：录入值即上一交易日市值，当前市值 = 录入值 ×（1 + 当日涨跌幅）。
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        场外基金盘中为估算净值（非官方），收盘后以官方净值为准；数据仅保存在本地，用于学习记录，不构成投资建议。
      </p>

      <NoticeDialog
        open={notice !== null}
        title="当前无数据"
        description={notice ?? undefined}
        onClose={() => setNotice(null)}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除持有基金"
        description={
          deleteTarget
            ? `确认删除 ${deleteTarget.position.name}（${deleteTarget.position.code}）的持有记录？删除后无法恢复。`
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