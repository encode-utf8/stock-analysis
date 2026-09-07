"use client";

import { formatDateTime } from "@/lib/format";
import type { FundRiskMetrics } from "@/lib/shared/types";

interface FundRiskPanelProps {
  allMetrics: FundRiskMetrics | null;
  oneYearMetrics: FundRiskMetrics | null;
  loading: boolean;
}

function signedPercent(value: number | null, digits = 2): string {
  if (value === null) {
    return "暂无";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function percent(value: number | null, digits = 2): string {
  if (value === null) {
    return "暂无";
  }
  return `${value.toFixed(digits)}%`;
}

function numberText(value: number | null, suffix = ""): string {
  if (value === null) {
    return "暂无";
  }
  return `${value.toFixed(2)}${suffix}`;
}

function formatRecoveryDuration(startDate: string, endDate: string): string {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return "";
  }

  let years = end.getUTCFullYear() - start.getUTCFullYear();
  let months = end.getUTCMonth() - start.getUTCMonth();
  let days = end.getUTCDate() - start.getUTCDate();

  if (days < 0) {
    const previousMonthDays = new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 0),
    ).getUTCDate();
    days += previousMonthDays;
    months -= 1;
  }
  if (months < 0) {
    months += 12;
    years -= 1;
  }

  const parts: string[] = [];
  if (years > 0) {
    parts.push(`${years}年`);
  }
  if (months > 0) {
    parts.push(`${months}个月`);
  }
  if (days > 0) {
    parts.push(`${days}天`);
  }
  return parts.length > 0 ? parts.join("") : "不足1天";
}

interface MetricCardProps {
  label: string;
  value: string;
  hint: string;
  tone?: "danger" | "warning";
}

function MetricCard({ label, value, hint, tone }: MetricCardProps) {
  const toneClass =
    tone === "danger"
      ? "border-red-200 bg-red-50/60"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50/60"
        : "border-transparent bg-muted/20";
  return (
    <div className={`rounded-lg border p-3 ${toneClass}`} title={hint}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-2 text-lg font-semibold">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

interface MetricsSectionProps {
  title: string;
  metrics: FundRiskMetrics | null;
}

function recoveryDisplay(metrics: FundRiskMetrics): {
  value: string;
  hint: string;
  tone?: "warning";
} {
  if (!metrics.max_drawdown_recovery_complete) {
    return {
      value: "正在修复中",
      hint: `${metrics.max_drawdown_recovery_start} 起，尚未回到回撤起点净值`,
      tone: "warning",
    };
  }

  const endDate = metrics.max_drawdown_recovery_end ?? metrics.end_date;
  return {
    value: formatRecoveryDuration(metrics.max_drawdown_recovery_start, endDate),
    hint: `${metrics.max_drawdown_recovery_start} 至 ${endDate} 完成修复`,
  };
}

function MetricsSection({ title, metrics }: MetricsSectionProps) {
  return (
    <div className="rounded-lg border bg-muted/10 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground">
          {metrics ? `${metrics.start_date} 至 ${metrics.end_date}` : "暂无数据"}
        </span>
      </div>

      {metrics ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="区间最大回撤"
            value={percent(metrics.max_drawdown_pct)}
            hint={`${metrics.max_drawdown_start} 至 ${metrics.max_drawdown_end}`}
            tone="danger"
          />
          <MetricCard
            label="最大回撤修复"
            value={recoveryDisplay(metrics).value}
            hint={recoveryDisplay(metrics).hint}
            tone={recoveryDisplay(metrics).tone}
          />
          <MetricCard
            label="年化收益率"
            value={signedPercent(metrics.annualized_return_pct)}
            hint="按区间收益率折算为年化"
          />
          <MetricCard
            label="年化波动率"
            value={percent(metrics.annualized_volatility_pct)}
            hint="按日收益率标准差年化"
          />
          <MetricCard
            label="夏普比率"
            value={numberText(metrics.sharpe)}
            hint="风险调整后收益，越高越好"
          />
          <MetricCard
            label="索提诺比率"
            value={numberText(metrics.sortino)}
            hint="仅惩罚下行波动"
          />
          <MetricCard
            label="卡玛比率"
            value={numberText(metrics.calmar)}
            hint="年化收益 / 最大回撤"
          />
          <MetricCard
            label="最长修复天数"
            value={
              metrics.longest_recovery_days === null
                ? "暂无"
                : `${metrics.longest_recovery_days} 个交易日`
            }
            hint="历史峰值修复所需的最长交易日数"
          />
          <MetricCard
            label="平均修复天数"
            value={
              metrics.average_recovery_days === null
                ? "暂无"
                : `${metrics.average_recovery_days} 个交易日`
            }
            hint="完整修复区间的平均交易日数"
          />
        </div>
      ) : (
        <div className="py-8 text-center text-sm text-muted-foreground">
          暂无可计算的区间指标。
        </div>
      )}
    </div>
  );
}

function CurrentMetricsSection({ metrics }: { metrics: FundRiskMetrics | null }) {
  if (!metrics) {
    return (
      <div className="rounded-lg border bg-muted/10 p-3">
        <h3 className="text-sm font-semibold">当前最新（即时）</h3>
        <div className="py-8 text-center text-sm text-muted-foreground">
          暂无最新风险数据。
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-muted/10 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">当前最新（即时）</h3>
        <span className="text-xs text-muted-foreground">数据日期：{metrics.end_date}</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <MetricCard
          label="当前回撤"
          value={percent(metrics.current_drawdown_pct)}
          hint="最新净值距当前区间内最高净值"
          tone="warning"
        />
        <MetricCard
          label="当前修复进度"
          value={percent(metrics.current_recovery_progress_pct, 1)}
          hint="最新净值从最近回撤低点向最近峰值修复"
        />
      </div>

      {metrics.current_recovery_progress_pct !== null ? (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>当前修复进度</span>
            <span>{metrics.current_recovery_progress_pct.toFixed(1)}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{
                width: `${Math.min(100, Math.max(0, metrics.current_recovery_progress_pct))}%`,
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 基金回撤与风险指标面板。 */
export function FundRiskPanel({
  allMetrics,
  oneYearMetrics,
  loading,
}: FundRiskPanelProps) {
  const latestMetrics = allMetrics ?? oneYearMetrics;

  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="mb-3">
        <h2 className="text-lg font-semibold">回撤与风险指标</h2>
        <p className="text-xs text-muted-foreground">
          范围数据固定展示“成立以来”并补充“近1年”；当前回撤与修复进度取最新净值。
          {latestMetrics
            ? ` 更新于 ${formatDateTime(latestMetrics.updated_at)}`
            : " 等待风险指标数据"}
        </p>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          风险指标计算中...
        </div>
      ) : allMetrics || oneYearMetrics ? (
        <div className="space-y-4">
          <MetricsSection title="成立以来" metrics={allMetrics} />
          <MetricsSection title="近1年" metrics={oneYearMetrics} />
          <CurrentMetricsSection metrics={oneYearMetrics ?? allMetrics} />

          <p className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            回撤与风险指标仅描述历史表现，不代表未来收益；计算口径为累计净值，分红再投资等细节以基金披露为准。
          </p>
        </div>
      ) : (
        <div className="py-12 text-center text-sm text-muted-foreground">
          暂无可计算的基金风险指标。
        </div>
      )}
    </section>
  );
}
