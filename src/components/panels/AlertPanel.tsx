"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import {
  ALERT_MAX_CONDITIONS,
  ALERT_METRIC_LABELS,
  ALERT_METRIC_UNITS,
  ALERT_TARGET_METRICS,
  formatAlertRuleLabel,
} from "@/lib/shared/types";
import type {
  AlertCondition,
  AlertEvent,
  AlertLogic,
  AlertMetric,
  AlertOperator,
  AlertRule,
  AlertSettings,
  AlertTarget,
  FundWatchlistItem,
  JobRun,
  WatchlistItem,
} from "@/lib/shared/types";
import { subscribeWatchlistChange, type WatchlistKind } from "@/lib/watchlist-bus";

/** 统一接口响应包装。 */
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
      throw new Error(payload?.error?.message ?? "请求失败");
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

/** 构造带 JSON 请求体的初始化参数。 */
function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** 邮件推送结果文案。 */
const EMAIL_STATUS_LABELS: Record<AlertEvent["email_status"], string> = {
  sent: "邮件已发送",
  skipped: "未发送邮件",
  failed: "邮件发送失败",
};

/** 将错误对象转为可展示文案。 */
function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** 新建条件时的默认口径：涨跌幅类默认跌 3%，回撤类默认回撤 20%，价格类默认跌破 0。 */
function defaultCondition(metric: AlertMetric): AlertCondition {
  if (metric === "price" || metric === "unit_nav") {
    return { metric, operator: "lte", threshold: 0 };
  }
  if (metric === "drawdown_pct" || metric === "current_drawdown_pct") {
    return { metric, operator: "gte", threshold: 20 };
  }
  return { metric, operator: "lte", threshold: -3 };
}

/** 交易日历状态。 */
interface AlertCalendarInfo {
  source: string;
  today: string;
  is_trading_day: boolean;
  first_day: string | null;
  last_day: string | null;
  fetched_at: string;
}

/** 交易日历来源文案。 */
function calendarSourceLabel(source: string | undefined): string {
  if (!source) {
    return "未知";
  }
  return source === "weekday-fallback" ? "工作日近似（侧车不可用）" : "AkShare 交易日历";
}

const EMPTY_SETTINGS: AlertSettings = {
  email_to: null,
  email_enabled: true,
  email_configured: false,
  max_targets: 3,
  updated_at: "",
};

interface AlertPanelProps {
  /** 面板绑定的工作台标的类型：股票工作台传 stock，基金工作台传 fund。 */
  target: AlertTarget;
}

/** 预警中心：规则编排、事件流与邮件通道设置。 */
export function AlertPanel({ target }: AlertPanelProps) {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [settings, setSettings] = useState<AlertSettings>(EMPTY_SETTINGS);
  const [stockOptions, setStockOptions] = useState<WatchlistItem[]>([]);
  const [fundOptions, setFundOptions] = useState<FundWatchlistItem[]>([]);
  const [calendarInfo, setCalendarInfo] = useState<AlertCalendarInfo | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formCode, setFormCode] = useState("");
  const [formLogic, setFormLogic] = useState<AlertLogic>("and");
  const [formConditions, setFormConditions] = useState<AlertCondition[]>([
    defaultCondition(ALERT_TARGET_METRICS[target][0]),
  ]);
  const [savingRule, setSavingRule] = useState(false);

  const [emailDraft, setEmailDraft] = useState("");
  const [emailEnabledDraft, setEmailEnabledDraft] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);

  // 注意：不要在同步路径内先 setState，否则会触发 react-hooks/set-state-in-effect。
  const loadAll = useCallback(async () => {
    try {
      const [ruleData, eventData, settingData, stockData, fundData, calendarData] = await Promise.all([
        apiFetch<AlertRule[]>("/api/alerts/rules"),
        apiFetch<AlertEvent[]>("/api/alerts/events?limit=100"),
        apiFetch<AlertSettings>("/api/alerts/settings"),
        apiFetch<WatchlistItem[]>("/api/watchlist"),
        apiFetch<FundWatchlistItem[]>("/api/fund-watchlist"),
        apiFetch<AlertCalendarInfo>("/api/alerts/calendar"),
      ]);
      setRules(ruleData);
      setEvents(eventData);
      setSettings(settingData);
      setEmailDraft(settingData.email_to ?? "");
      setEmailEnabledDraft(settingData.email_enabled);
      setStockOptions(stockData);
      setFundOptions(fundData);
      setCalendarInfo(calendarData);
    } catch (nextError) {
      setError(errorText(nextError, "预警数据加载失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 放进微任务回调，避免在 effect 同步路径里直接 setState。
    void Promise.resolve().then(() => loadAll());
  }, [loadAll]);

  /** 自选池增删后只刷新可选标的，不必重拉规则与事件。 */
  const refreshOptions = useCallback(async (kind: WatchlistKind) => {
    try {
      if (kind === "stock") {
        setStockOptions(await apiFetch<WatchlistItem[]>("/api/watchlist"));
      } else {
        setFundOptions(await apiFetch<FundWatchlistItem[]>("/api/fund-watchlist"));
      }
    } catch {
      // 同步失败不打断主流程：用户仍可通过重新加载页面获取最新自选池。
    }
  }, []);

  // 左侧自选池变化时立即同步下拉选项，避免用户手动刷新页面。
  useEffect(() => {
    return subscribeWatchlistChange((kind) => {
      void refreshOptions(kind);
    });
  }, [refreshOptions]);

  const targetRules = useMemo(
    () => rules.filter((rule) => rule.target === target),
    [rules, target],
  );
  const targetEvents = useMemo(
    () =>
      events
        .filter((event) => event.target === target)
        .filter((event) => (onlyUnread ? event.status === "unread" : true)),
    [events, target, onlyUnread],
  );
  const codeOptions = target === "stock" ? stockOptions : fundOptions;
  const unreadCount = events.filter((event) => event.status === "unread").length;
  const targetLimit = settings.max_targets;

  const resetForm = useCallback(
    (target: AlertTarget) => {
      setEditingId(null);
      setFormCode("");
      setFormLogic("and");
      setFormConditions([defaultCondition(ALERT_TARGET_METRICS[target][0])]);
    },
    [],
  );

  const editRule = (rule: AlertRule) => {
    setEditingId(rule.id);
    setFormCode(rule.code);
    setFormLogic(rule.logic);
    setFormConditions(rule.conditions.map((condition) => ({ ...condition })));
    setNotice(null);
  };

  const updateCondition = (index: number, patch: Partial<AlertCondition>) => {
    setFormConditions((current) =>
      current.map((condition, position) =>
        position === index ? { ...condition, ...patch } : condition,
      ),
    );
  };

  const changeConditionMetric = (index: number, metric: AlertMetric) => {
    setFormConditions((current) =>
      current.map((condition, position) =>
        position === index ? defaultCondition(metric) : condition,
      ),
    );
  };

  const handleScan = async () => {
    setScanning(true);
    setError(null);
    setNotice(null);
    try {
      const run = await apiFetch<JobRun>("/api/admin/alerts/scan", { method: "POST" });
      const detail = run.detail as {
        triggered_count?: number;
        scanned_targets?: number;
        skipped_count?: number;
        trading_day_source?: string;
      };
      setNotice(
        `评估完成：检查 ${detail.scanned_targets ?? 0} 个标的，触发 ${detail.triggered_count ?? 0} 条，跳过 ${detail.skipped_count ?? 0} 类原因；交易日历来源：${calendarSourceLabel(detail.trading_day_source)}。`,
      );
      await loadAll();
    } catch (nextError) {
      setError(errorText(nextError, "手动评估失败"));
    } finally {
      setScanning(false);
    }
  };

  const handleSaveRule = async () => {
    if (!editingId && !formCode) {
      setError("请先选择要监控的自选标的。");
      return;
    }
    setSavingRule(true);
    setError(null);
    setNotice(null);
    try {
      if (editingId) {
        await apiFetch<AlertRule>(
          `/api/alerts/rules/${editingId}`,
          jsonInit("PATCH", { logic: formLogic, conditions: formConditions }),
        );
        setNotice("规则已更新。");
      } else {
        await apiFetch<AlertRule>(
          "/api/alerts/rules",
          jsonInit("POST", {
            target: target,
            code: formCode,
            logic: formLogic,
            conditions: formConditions,
          }),
        );
        setNotice("规则已创建。");
      }
      resetForm(target);
      await loadAll();
    } catch (nextError) {
      setError(errorText(nextError, "规则保存失败"));
    } finally {
      setSavingRule(false);
    }
  };

  const toggleRule = async (rule: AlertRule) => {
    setError(null);
    try {
      await apiFetch<AlertRule>(
        `/api/alerts/rules/${rule.id}`,
        jsonInit("PATCH", { enabled: !rule.enabled }),
      );
      await loadAll();
    } catch (nextError) {
      setError(errorText(nextError, "规则状态更新失败"));
    }
  };

  const removeRule = async (rule: AlertRule) => {
    setError(null);
    try {
      await apiFetch<{ id: string }>(`/api/alerts/rules/${rule.id}`, { method: "DELETE" });
      if (editingId === rule.id) {
        resetForm(target);
      }
      await loadAll();
    } catch (nextError) {
      setError(errorText(nextError, "规则删除失败"));
    }
  };

  const updateEventStatus = async (event: AlertEvent, status: AlertEvent["status"]) => {
    setError(null);
    try {
      await apiFetch<{ id: string }>(
        `/api/alerts/events/${event.id}`,
        jsonInit("PATCH", { status }),
      );
      await loadAll();
    } catch (nextError) {
      setError(errorText(nextError, "事件状态更新失败"));
    }
  };

  const removeEvent = async (event: AlertEvent) => {
    setError(null);
    try {
      await apiFetch<{ id: string }>(`/api/alerts/events/${event.id}`, { method: "DELETE" });
      await loadAll();
    } catch (nextError) {
      setError(errorText(nextError, "事件删除失败"));
    }
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    setError(null);
    setNotice(null);
    try {
      const next = await apiFetch<AlertSettings>(
        "/api/alerts/settings",
        jsonInit("PATCH", { email_to: emailDraft.trim(), email_enabled: emailEnabledDraft }),
      );
      setSettings(next);
      setEmailDraft(next.email_to ?? "");
      setNotice("邮件设置已保存。");
    } catch (nextError) {
      setError(errorText(nextError, "邮件设置保存失败"));
    } finally {
      setSavingSettings(false);
    }
  };

  const handleTestEmail = async () => {
    setTestingEmail(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiFetch<{ status: string; reason: string | null; email_to: string }>(
        "/api/admin/alerts/test-email",
        jsonInit("POST", { email_to: emailDraft.trim() }),
      );
      setNotice(
        result.status === "sent"
          ? `测试邮件已发送到 ${result.email_to}，请查收。`
          : `未发送测试邮件：${result.reason ?? "原因未知"}`,
      );
    } catch (nextError) {
      setError(errorText(nextError, "测试邮件发送失败"));
    } finally {
      setTestingEmail(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">预警中心</h2>
            <p className="text-xs text-muted-foreground">
              基金以盘中估算净值盯盘（场内实时价 / 场外估算），仅在交易日盘中触发；同一规则 12 小时内只提醒一次。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-md border bg-muted px-2 py-1 text-xs text-muted-foreground">
              当前工作台：{target === "stock" ? "个股预警" : "基金预警"}
            </span>
            <Button type="button" size="sm" disabled={scanning} onClick={() => void handleScan()}>
              {scanning ? "评估中..." : "立即评估"}
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>预警标的：{targetRules.length}/{targetLimit}（股票 + 基金合计上限 {targetLimit}）</span>
          <span>未读事件：{unreadCount} 条</span>
          <span>
            邮件通道：
            {settings.email_configured
              ? settings.email_enabled
                ? "已配置并开启"
                : "已配置但已关闭推送"
              : "未配置 SMTP，仅页面展示"}
          </span>
          <span>收件邮箱：{settings.email_to ?? "未设置"}</span>
          <span>
            今日（{calendarInfo?.today ?? "—"}）：
            {calendarInfo
              ? calendarInfo.is_trading_day
                ? "交易日"
                : "休市"
              : "未知"}
          </span>
          <span>交易日历：{calendarSourceLabel(calendarInfo?.source)}</span>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {notice}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="rounded-lg border p-4">
            <h3 className="text-sm font-semibold">{editingId ? "编辑预警规则" : "新增预警规则"}</h3>

            <div className="mt-3 space-y-3">
              <div>
                <label htmlFor="alert-rule-code" className="text-xs font-medium text-muted-foreground">
                  自选标的（{target === "stock" ? "股票" : "基金"}）
                </label>
                <select
                  id="alert-rule-code"
                  value={formCode}
                  disabled={Boolean(editingId)}
                  onChange={(event) => setFormCode(event.target.value)}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary disabled:bg-muted"
                >
                  <option value="">请选择自选标的</option>
                  {codeOptions.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.code} {option.name}
                    </option>
                  ))}
                </select>
                {codeOptions.length === 0 ? (
                  <p className="mt-1 text-xs text-amber-600">
                    当前自选池为空，请先在左侧加入自选{target === "stock" ? "股" : "基金"}。
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">条件组合</span>
                <select
                  value={formLogic}
                  onChange={(event) => setFormLogic(event.target.value as AlertLogic)}
                  className="rounded-md border px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="and">全部满足（且）</option>
                  <option value="or">任一满足（或）</option>
                </select>
                <span className="text-xs text-muted-foreground">
                  条件数量 {formConditions.length}/{ALERT_MAX_CONDITIONS}
                </span>
              </div>

              <div className="space-y-2">
                {formConditions.map((condition, index) => (
                  <div
                    key={`${condition.metric}-${index}`}
                    className="flex flex-wrap items-center gap-2 rounded-md border px-2 py-2"
                  >
                    <select
                      value={condition.metric}
                      onChange={(event) => changeConditionMetric(index, event.target.value as AlertMetric)}
                      className="rounded-md border px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-primary"
                    >
                      {ALERT_TARGET_METRICS[target].map((metric) => (
                        <option key={metric} value={metric}>
                          {ALERT_METRIC_LABELS[metric]}
                        </option>
                      ))}
                    </select>
                    <select
                      value={condition.operator}
                      onChange={(event) =>
                        updateCondition(index, { operator: event.target.value as AlertOperator })
                      }
                      className="rounded-md border px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="gte">≥</option>
                      <option value="lte">≤</option>
                    </select>
                    <input
                      type="number"
                      step="0.01"
                      value={condition.threshold}
                      onChange={(event) =>
                        updateCondition(index, { threshold: Number(event.target.value) })
                      }
                      className="w-24 rounded-md border px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-primary"
                    />
                    <span className="text-xs text-muted-foreground">
                      {ALERT_METRIC_UNITS[condition.metric]}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={formConditions.length <= 1}
                      onClick={() =>
                        setFormConditions((current) =>
                          current.filter((_item, position) => position !== index),
                        )
                      }
                    >
                      删除
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={formConditions.length >= ALERT_MAX_CONDITIONS}
                  onClick={() =>
                    setFormConditions((current) => [
                      ...current,
                      defaultCondition(ALERT_TARGET_METRICS[target][0]),
                    ])
                  }
                >
                  添加条件
                </Button>
                <Button type="button" size="sm" disabled={savingRule} onClick={() => void handleSaveRule()}>
                  {savingRule ? "保存中..." : editingId ? "保存修改" : "创建规则"}
                </Button>
                {editingId ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => resetForm(target)}
                  >
                    取消编辑
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="rounded-lg border p-4">
            <h3 className="text-sm font-semibold">
              已配置规则（{target === "stock" ? "股票" : "基金"}）
            </h3>
            {loading ? (
              <p className="mt-2 text-sm text-muted-foreground">加载中...</p>
            ) : targetRules.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">暂无规则，可在上方创建。</p>
            ) : (
              <ul className="mt-2 space-y-3">
                {targetRules.map((rule) => (
                  <li key={rule.id} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium">
                        {rule.code} {rule.name}
                      </div>
                      <span
                        className={
                          "rounded-full px-2 py-0.5 text-xs font-medium " +
                          (rule.enabled ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600")
                        }
                      >
                        {rule.enabled ? "已启用" : "已停用"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm">{formatAlertRuleLabel(rule)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      冷却 {rule.cooldown_hours} 小时 · 上次触发：
                      {rule.last_triggered_at ? formatDateTime(rule.last_triggered_at) : "暂无"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => void toggleRule(rule)}>
                        {rule.enabled ? "停用" : "启用"}
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => editRule(rule)}>
                        编辑
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => void removeRule(rule)}>
                        删除
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border p-4">
            <h3 className="text-sm font-semibold">邮件推送设置</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              SMTP 参数通过本地 `.env` 配置（`SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASS`、`SMTP_FROM`）；
              此处只保存收件邮箱与推送开关。
            </p>
            <div className="mt-3 space-y-3">
              <div>
                <label htmlFor="alert-email-to" className="text-xs font-medium text-muted-foreground">
                  收件邮箱
                </label>
                <input
                  id="alert-email-to"
                  type="email"
                  value={emailDraft}
                  placeholder="name@example.com"
                  onChange={(event) => setEmailDraft(event.target.value)}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={emailEnabledDraft}
                  onChange={(event) => setEmailEnabledDraft(event.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                触发预警时发送摘要邮件
              </label>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" disabled={savingSettings} onClick={() => void handleSaveSettings()}>
                  {savingSettings ? "保存中..." : "保存设置"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={testingEmail}
                  onClick={() => void handleTestEmail()}
                >
                  {testingEmail ? "发送中..." : "发送测试邮件"}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">预警事件流</h3>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={onlyUnread}
                onChange={(event) => setOnlyUnread(event.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              只看未读
            </label>
          </div>
          {loading ? (
            <p className="mt-2 text-sm text-muted-foreground">加载中...</p>
          ) : targetEvents.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              暂无事件。系统在交易时段运行时会自动扫描，也可点击「立即评估」。
            </p>
          ) : (
            <ul className="mt-2 space-y-3">
              {targetEvents.map((event) => (
                <li
                  key={event.id}
                  className={
                    "rounded-md border p-3 " + (event.status === "unread" ? "border-amber-300 bg-amber-50" : "")
                  }
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{event.message}</span>
                    <span
                      className={
                        "rounded-full px-2 py-0.5 text-xs font-medium " +
                        (event.status === "unread"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-slate-100 text-slate-600")
                      }
                    >
                      {event.status === "unread" ? "未读" : "已读"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    观测时间：{formatDateTime(event.observed_at)} · 数据来源：{event.data_source} ·{" "}
                    {EMAIL_STATUS_LABELS[event.email_status]}
                    {event.email_reason ? `（${event.email_reason}）` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void updateEventStatus(event, event.status === "unread" ? "read" : "unread")
                      }
                    >
                      {event.status === "unread" ? "标记已读" : "标记未读"}
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => void removeEvent(event)}>
                      删除
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        说明：股票预警基于最近一次行情快照；基金预警基于盘中估算净值（场内实时价 / 场外估算），均非交易所正式成交口径，
        且存在延迟，仅用于学习与观察，不构成投资建议。
      </p>
    </section>
  );
}
