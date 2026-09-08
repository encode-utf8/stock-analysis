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

interface MetricCardProps {
  label: string;
  value: string;
  hint: string;
  tone?: "up" | "down" | "neutral";
}

function MetricCard({ label, value, hint, tone }: MetricCardProps) {
  const toneClass =
    tone === "up"
      ? "border-red-200 bg-red-50/60"
      : tone === "down"
        ? "border-green-200 bg-green-50/60"
        : "border-transparent bg-muted/20";
  const valueClass =
    tone === "up"
      ? "text-red-600"
      : tone === "down"
        ? "text-green-700"
        : "text-foreground";
  return (
    <div className={`rounded-lg border p-3 ${toneClass}`} title={hint}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-2 text-lg font-semibold ${valueClass}`}>{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

function numberTone(value: number | null): "up" | "down" | "neutral" {
  if (value === null || value === 0) {
    return "neutral";
  }
  return value > 0 ? "up" : "down";
}

interface MetricsSectionProps {
  title: string;
  metrics: FundRiskMetrics | null;
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
            label="年化收益率"
            value={signedPercent(metrics.annualized_return_pct)}
            hint="按区间收益率折算为年化"
            tone={numberTone(metrics.annualized_return_pct)}
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
            tone={numberTone(metrics.sharpe)}
          />
          <MetricCard
            label="索提诺比率"
            value={numberText(metrics.sortino)}
            hint="仅惩罚下行波动"
            tone={numberTone(metrics.sortino)}
          />
          <MetricCard
            label="卡玛比率"
            value={numberText(metrics.calmar)}
            hint="年化收益 / 最大回撤"
            tone={numberTone(metrics.calmar)}
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
          范围数据固定展示“成立以来”并补充“近1年”；回撤幅度、修复状态与修复耗时展示在净值图表中。
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
