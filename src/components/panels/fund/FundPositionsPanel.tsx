"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
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
  FundPlanFrequency,
  FundPlanWeekday,
  FundPositionDcaValue,
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

/** 收益类金额：正数前显式加「+」，负数保留「-」，与涨红跌绿配色配套。 */
function formatSignedMoney(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  const body = `${Math.abs(value).toLocaleString("zh-CN", {
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

/** 定投频率下拉选项：每日 / 每周（指定星期几）/ 每两周 / 每月。 */
const PLAN_FREQUENCY_OPTIONS: Array<{ value: FundPlanFrequency; label: string }> = [
  { value: "daily", label: "每日" },
  { value: "weekly", label: "每周" },
  { value: "biweekly", label: "每两周" },
  { value: "monthly", label: "每月" },
];

/** 每周定投的星期几选项（仅工作日，与场外基金申购时段一致）。 */
const PLAN_WEEKDAY_OPTIONS: Array<{ value: FundPlanWeekday; label: string }> = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
];

/** 定投频率中文标签，用于列表摘要。 */
const PLAN_FREQUENCY_LABELS: Record<FundPlanFrequency, string> = {
  daily: "每日",
  weekly: "每周",
  biweekly: "每两周",
  monthly: "每月",
};

/** 表单输入框统一样式，避免重复长串类名。 */
const FIELD_CLASS =
  "h-9 rounded-md border bg-white px-2 text-sm text-slate-900 outline-none focus:border-primary";

/**
 * 组装定投计划请求体。
 * 启用日留空时交给接口按「今天」补缺省值：计划只统计启用之后的期次，不回溯历史。
 */
function buildPlanPayload(
  frequency: FundPlanFrequency,
  weekday: FundPlanWeekday,
  amount: string,
  startDate: string,
): Record<string, unknown> {
  return {
    frequency,
    weekday: frequency === "weekly" ? weekday : null,
    amount,
    start_date: startDate || null,
  };
}

/** 定投计划摘要，如「每周（周三）500 · 启用 2026-06-01」；列表与行内编辑共用。 */
function describePlan(
  plan: Pick<FundPositionDcaValue, "frequency" | "weekday" | "amount" | "start_date">,
): string {
  const weekday =
    plan.frequency === "weekly" && plan.weekday
      ? `（${PLAN_WEEKDAY_OPTIONS.find((item) => item.value === plan.weekday)?.label ?? "—"}）`
      : "";
  return `${PLAN_FREQUENCY_LABELS[plan.frequency]}${weekday} ${plan.amount.toLocaleString("zh-CN")} · 启用 ${plan.start_date}`;
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

/** 持有基金面板：手动持仓与定投计划两种录入方式，同一基金代码自动合并为一条记录。 */
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
  // 定投计划录入：勾选后持有金额与累计收益改由「计划参数 + 历史净值」派生，不再手动填写。
  const [planEnabled, setPlanEnabled] = useState(false);
  const [planFrequency, setPlanFrequency] = useState<FundPlanFrequency>("monthly");
  const [planWeekday, setPlanWeekday] = useState<FundPlanWeekday>(1);
  const [planAmount, setPlanAmount] = useState("");
  // 留空表示「今天启用」，由接口按北京日期补缺省值。
  const [planStartDate, setPlanStartDate] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // 「已叠加到已有条目」这类成功提示用行内横幅，避免弹窗打断连续录入。
  const [formNotice, setFormNotice] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editProfit, setEditProfit] = useState("");
  const [editCaliber, setEditCaliber] = useState<FundProfitCaliber>(DEFAULT_FUND_PROFIT_CALIBER);
  // 「修改」不提供启用定投（按代码合并只走「添加」表单），只保留取消定投与手动校准。
  const [editCancelPlan, setEditCancelPlan] = useState(false);
  const [editCalibAmount, setEditCalibAmount] = useState("");
  const [editCalibProfit, setEditCalibProfit] = useState("");
  const [editClearCalibration, setEditClearCalibration] = useState(false);
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
    setFormNotice(null);
    setSubmitting(true);
    // 同一代码只保留一条记录：先看列表里有没有，用于提交后的合并提示。
    const trimmedCode = code.trim();
    const matched = (snapshot?.holdings ?? []).find((item) => item.position.code === trimmedCode) ?? null;
    try {
      // 定投计划只提交计划参数，持有金额与累计收益由计划按期派生；手动持仓仍提交金额与收益。
      const body: Record<string, unknown> = { code: trimmedCode, note, profit_caliber: caliber };
      if (planEnabled) {
        body.plan = buildPlanPayload(planFrequency, planWeekday, planAmount, planStartDate);
      } else {
        body.amount = amount;
        body.profit = profit;
      }
      const saved = await apiFetch<FundPositionValuation>("/api/fund-positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setFormNotice(
        matched === null
          ? `已添加 ${saved.position.name}（${trimmedCode}）。`
          : planEnabled
            ? `已更新 ${matched.position.name}（${trimmedCode}）的定投计划参数。`
            : `已叠加到已有条目 ${matched.position.name}（${trimmedCode}）：持有金额与累计收益已相加。`,
      );
      setCode("");
      setAmount("");
      setProfit("");
      setNote("");
      setPlanAmount("");
      setPlanStartDate("");
      setPlanEnabled(false);
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
    const { position } = valuation;
    setEditingId(position.id);
    setEditCaliber(normalizeFundProfitCaliber(position.profit_caliber));
    setEditNote(position.note ?? "");
    // 取消定投后需要一组手动值：先用当前派生结果预填，用户可在保存前修正。
    // 手动持仓按「展示口径的层级」预填：不含当日（锚在上一交易日收盘）用上一交易日口径，
    // 这样直接保存不会重复计算当日涨跌，改了数字才会按今天的口径重新锚定。
    const manualExclude = valuation.display_caliber === "exclude_today";
    setEditAmount(
      position.plan
        ? valuation.market_value === null
          ? ""
          : String(valuation.market_value)
        : String(
            (manualExclude ? valuation.prev_market_value : valuation.market_value) ??
              position.amount,
          ),
    );
    setEditProfit(
      position.plan
        ? valuation.total_profit === null
          ? ""
          : String(valuation.total_profit)
        : String(
            (manualExclude ? valuation.prev_total_profit : valuation.total_profit) ??
              position.profit,
          ),
    );
    // 每次进入编辑都从「未选择取消定投」开始，避免上一次的意图残留。
    setEditCancelPlan(false);
    setEditCalibAmount("");
    setEditCalibProfit("");
    setEditClearCalibration(false);
  };

  const handleSaveEdit = async (valuation: FundPositionValuation) => {
    const { position } = valuation;
    const id = position.id;
    setSavingId(id);
    setFormError(null);
    try {
      const body: Record<string, unknown> = { note: editNote };
      if (position.plan) {
        if (editCancelPlan) {
          // 取消定投：把上表两格固化为手动持仓（口径缺省「含当日」，与计划派生口径一致）。
          body.plan = null;
          body.amount = editAmount;
          body.profit = editProfit;
          body.profit_caliber = editCaliber;
        } else if (
          editNote === (position.note ?? "") &&
          !editClearCalibration &&
          editCalibAmount.trim() === ""
        ) {
          // 计划持仓什么都没改时直接收起编辑行，避免出现「没有需要更新的字段」报错。
          setEditingId(null);
          return;
        }
      } else {
        // 手动持仓：始终提交一组配对手动值。
        body.amount = editAmount;
        body.profit = editProfit;
        body.profit_caliber = editCaliber;
      }
      if (editClearCalibration) {
        body.calibration = null;
      } else if (editCalibAmount.trim() !== "") {
        body.calibration = { amount: editCalibAmount, profit: editCalibProfit || "0" };
      }
      await apiFetch<FundPositionValuation>(`/api/fund-positions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
  // 校准基线仍锚定在估算值上、官方净值尚未取到的持仓数量。
  const pendingSettlementCount = holdings.filter((item) => item.settlement_pending).length;
  // 同一代码只保留一条记录：录入时先提示本次提交会「叠加 / 更新」而不是新增第二行。
  const existingMatch = holdings.find((item) => item.position.code === code.trim()) ?? null;
  const caliberMismatch =
    existingMatch !== null &&
    existingMatch.position.plan === null &&
    !planEnabled &&
    normalizeFundProfitCaliber(existingMatch.position.profit_caliber) !== caliber;

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">我的持有基金</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            两种录入方式：手动持仓（基金代码 + 当前持有金额 + 当前累计收益 + 口径）或定投计划（由「计划参数 + 历史净值」
            按期派生持有金额与累计收益，停机期间漏掉的期次会自动补齐）。同一个基金代码只保留一条记录：再次录入会叠加到已有条目，
            定投只会更新原有的那一个计划；需要取消定投时在「修改」里操作。两者都满足
            「上一交易日累计收益 + 当日实时收益 = 当前累计收益」。
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
      {formNotice ? (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {formNotice}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3 rounded-lg border bg-slate-50/60 p-3">
        <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={planEnabled}
            onChange={(event) => setPlanEnabled(event.target.checked)}
            className="h-4 w-4 rounded border"
          />
          启用定投计划（持有金额与累计收益改由「计划 + 历史净值」按期派生）
        </label>
        <div className="grid gap-3 lg:grid-cols-6">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          基金代码
          <input
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              setFormNotice(null);
            }}
            placeholder="如 110022"
            inputMode="numeric"
            className="h-9 rounded-md border bg-white px-2 text-sm text-slate-900 outline-none focus:border-primary"
          />
        </label>
        {planEnabled ? (
          <>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              定投频率
              <select
                value={planFrequency}
                onChange={(event) => setPlanFrequency(event.target.value as FundPlanFrequency)}
                aria-label="定投频率"
                className={FIELD_CLASS}
              >
                {PLAN_FREQUENCY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {planFrequency === "weekly" ? (
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                扣款日（周几）
                <select
                  value={planWeekday}
                  onChange={(event) => setPlanWeekday(Number(event.target.value) as FundPlanWeekday)}
                  aria-label="定投扣款日"
                  className={FIELD_CLASS}
                >
                  {PLAN_WEEKDAY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              每期金额（元）
              <input
                value={planAmount}
                onChange={(event) => setPlanAmount(event.target.value)}
                placeholder="如 500"
                inputMode="decimal"
                className={FIELD_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              启用日（留空 = 今天）
              <input
                type="date"
                value={planStartDate}
                onChange={(event) => setPlanStartDate(event.target.value)}
                className={FIELD_CLASS}
              />
            </label>
          </>
        ) : (
          <>
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
          </>
        )}
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
        </div>
      </form>

      {existingMatch ? (
        <p className="mt-2 text-xs text-muted-foreground">
          该基金已在持有列表中（{existingMatch.position.name}
          {existingMatch.position.plan
            ? "，已启用定投计划"
            : `，累计收益口径：${normalizeFundProfitCaliber(existingMatch.position.profit_caliber) === "include_today" ? "含当日收益" : "不含当日收益"}`}
          ）：
          {existingMatch.position.plan
            ? "本次提交会用新参数更新这一个计划（一个基金只能有一个定投计划）。"
            : planEnabled
              ? "本次提交会把已有持仓折算成定投基线并启用计划。"
              : caliberMismatch
                ? "本次提交的口径与已有条目不一致，会被拒绝——请把「累计收益口径」改成与已有条目一致。"
                : "本次提交会把持有金额与累计收益叠加到已有条目。"}
        </p>
      ) : null}

      <p className="mt-2 text-xs text-muted-foreground">
        口径说明（针对手动持仓）：「含当日收益」= 你填的持有金额与累计收益都已含录入当天的涨跌（盘中按估算记录，官方净值公布后自动按官方口径折算）；
        「不含当日收益」= 你填的是截至录入日之前最近一个交易日收盘的持有金额与累计收益。
        录入值是「某一天收盘口径」的一组快照：系统每天收盘后按官方净值自动推进到最新交易日收盘口径，
        因此持有金额、累计收益与「上一交易日累计收益」都会随交易日更新（录入当天不回溯，从下一个交易日起生效）。
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
                <Fragment key={position.id}>
                  <tr className="border-b align-top">
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{position.name}</span>
                      {valuation.dca ? (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                          定投
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">{position.code}</div>
                    {valuation.dca ? (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {describePlan(valuation.dca)}
                      </div>
                    ) : null}
                    {position.note ? (
                      <div className="mt-0.5 text-xs text-muted-foreground">备注：{position.note}</div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3">
                    {editing ? (
                      <input
                        value={editAmount}
                        onChange={(event) => setEditAmount(event.target.value)}
                        placeholder="持有金额"
                        inputMode="decimal"
                        disabled={position.plan !== null && !editCancelPlan}
                        className="h-8 w-28 rounded-md border px-2 text-sm disabled:opacity-50"
                      />
                    ) : (
                      <>
                        <div>{formatMoney(valuation.market_value)}</div>
                        {valuation.dca ? (
                          <>
                            <div className="text-xs text-muted-foreground">
                              累计投入 {formatMoney(valuation.cost_amount)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              定投 {valuation.dca.periods} 期 · 份额 {valuation.dca.shares.toFixed(2)}
                            </div>
                          </>
                        ) : (
                          <div className="text-xs text-muted-foreground">
                            本金 {formatMoney(valuation.cost_amount)}
                          </div>
                        )}
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
                        disabled={position.plan !== null && !editCancelPlan}
                        className="h-8 w-28 rounded-md border px-2 text-sm disabled:opacity-50"
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
                    {valuation.nav_date ? (
                      <div className="text-xs text-muted-foreground">净值日 {valuation.nav_date}</div>
                    ) : null}
                    {valuation.settlement_pending ? (
                      <div className="text-xs text-amber-600">官方净值未公布，待结算</div>
                    ) : null}
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
                            onClick={() => void handleSaveEdit(valuation)}
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
                {editing ? (
                  <tr className="border-b bg-slate-50/60">
                    <td colSpan={10} className="px-3 py-3">
                      <div className="flex flex-col gap-3">
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="rounded-lg border bg-white p-3">
                            <div className="text-xs font-medium text-slate-700">累计收益口径</div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              只对手动持仓生效：定投计划持仓由计划派生，恒按「含当日收益」折算，点「取消定投」后该下拉才可切换。
                            </p>
                            <select
                              value={editCaliber}
                              onChange={(event) =>
                                setEditCaliber(normalizeFundProfitCaliber(event.target.value))
                              }
                              aria-label="修改累计收益口径"
                              disabled={position.plan !== null && !editCancelPlan}
                              className="mt-2 h-8 rounded-md border px-2 text-xs disabled:opacity-50"
                            >
                              {PROFIT_CALIBER_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            {!position.plan ? (
                              <p className="mt-2 text-xs text-muted-foreground">
                                {valuation.display_caliber === "exclude_today"
                                  ? "上表两格当前按「不含当日」展示：请填截至上一交易日收盘的持有金额与累计收益；直接保存不会重复计算当日涨跌。"
                                  : "上表两格当前按「含当日」展示：请填含今日盘中估算的持有金额与累计收益。"}
                              </p>
                            ) : null}
                          </div>
                          <div className="rounded-lg border bg-white p-3">
                            <div className="text-xs font-medium text-slate-700">定投计划</div>
                            {position.plan ? (
                              <>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {describePlan(position.plan)}
                                  。一个基金只能有一个定投计划，调整参数请在「添加持有基金」里用同一代码重新提交。
                                </p>
                                {editCancelPlan ? (
                                  <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-700">
                                    已选择取消定投：保存后本基金转为手动持仓，上表两格的持有金额与累计收益会被固化，请先核对。
                                  </p>
                                ) : null}
                                <div className="mt-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setEditCancelPlan((current) => !current)}
                                  >
                                    {editCancelPlan ? "撤回取消定投" : "取消定投"}
                                  </Button>
                                </div>
                              </>
                            ) : (
                              <p className="mt-1 text-xs text-muted-foreground">
                                当前是手动持仓。如需改成定投，请在「添加持有基金」里勾选「启用定投计划」并用代码{" "}
                                {position.code} 提交，已有持仓会自动折算成定投基线。
                              </p>
                            )}
                          </div>
                        </div>
                        {position.plan !== null && !editCancelPlan ? (
                          <div className="rounded-lg border bg-white p-3">
                            <div className="text-xs font-medium text-slate-700">手动校准（可选）</div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              按你实际看到的持仓覆盖：填写实际持有金额与实际累计收益，系统折算成「份额 + 本金」基线，
                              校准日（含）之前的期次不再重复计入，之后继续按期累加。
                              {position.calibration
                                ? ` 当前校准于 ${position.calibration.nav_date}：份额 ${position.calibration.shares.toFixed(2)}、本金 ${formatMoney(position.calibration.cost)}。`
                                : " 当前未校准。"}
                            </p>
                            <div className="mt-2 flex flex-wrap items-end gap-2">
                              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                                实际持有金额（元）
                                <input
                                  value={editCalibAmount}
                                  onChange={(event) => {
                                    setEditCalibAmount(event.target.value);
                                    setEditClearCalibration(false);
                                  }}
                                  placeholder="留空表示不校准"
                                  inputMode="decimal"
                                  className="h-8 w-36 rounded-md border px-2 text-sm"
                                />
                              </label>
                              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                                实际累计收益（元）
                                <input
                                  value={editCalibProfit}
                                  onChange={(event) => {
                                    setEditCalibProfit(event.target.value);
                                    setEditClearCalibration(false);
                                  }}
                                  placeholder="亏损填负数"
                                  inputMode="decimal"
                                  className="h-8 w-36 rounded-md border px-2 text-sm"
                                />
                              </label>
                              {position.calibration ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setEditCalibAmount("");
                                    setEditCalibProfit("");
                                    setEditClearCalibration(true);
                                  }}
                                >
                                  {editClearCalibration ? "已标记清除（保存后生效）" : "清除校准"}
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ) : null}
                </Fragment>
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

      {holdings.length > 0 ? (
        <p
          className={
            "mt-3 text-xs " +
            (pendingSettlementCount > 0 ? "text-amber-600" : "text-muted-foreground")
          }
        >
          {pendingSettlementCount > 0
            ? `净值结算：${pendingSettlementCount} 只基金的估算口径（手动录入值 / 校准基线）仍锚定在盘中估算上，官方净值公布后会自动按官方口径重算。`
            : "净值结算：当日官方净值公布后，估值、当日涨跌幅与当日收益会自动切换到官方口径。"}
        </p>
      ) : null}

      {snapshot ? (
        <p className="mt-4 text-xs text-muted-foreground">
          {snapshot.source_note} 汇总时间：{formatDateTime(snapshot.summary.generated_at)}。
        </p>
      ) : null}
      <p className="mt-1 text-xs text-muted-foreground">
        手动持仓的持有金额、累计收益与口径均为手动录入；定投计划持仓由「计划参数 + 历史净值」按期派生：
        只统计启用日之后的期次，停机漏跑的期次会在下次打开时自动补齐（按同一份净值重算，结果与一直在线一致），
        需要时可在「修改」里按实际持仓手动校准，或在「修改」里取消定投、把当前派生值固化成手动持仓。
        当日收益按「当前市值 − 上一交易日市值」估算，取不到盘中行情时该列显示为空。
        手动持仓的当前市值 = 上一交易日收盘口径 ×（1 + 当日涨跌幅）：录入值锚在录入日的口径层级上，
        每天收盘后系统按官方净值把它推进到最新收盘口径，因此「上一交易日累计收益」不会停留在录入当天的数值。
        含当日录入：录入值视为录入当天的当前值（盘中估算，官方净值公布后按官方口径折算后继续推进）；
        不含当日录入：录入值视为录入日之前最近一个交易日的收盘口径。
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