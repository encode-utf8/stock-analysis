"use client";

import { useState } from "react";

import type { FundNavRange, FundNavType } from "@/lib/fund-data";
import { formatDateTime } from "@/lib/format";
import type { FundNavPoint, FundRiskMetrics } from "@/lib/shared/types";

interface FundNavChartPanelProps {
  nav: FundNavPoint[];
  range: FundNavRange;
  navType: FundNavType;
  riskMetrics?: FundRiskMetrics | null;
  loading: boolean;
  onRangeChange: (range: FundNavRange) => void;
  onNavTypeChange: (navType: FundNavType) => void;
}

function fundSourceLabel(source: string): string {
  if (source === "akshare") {
    return "AkShare 基金数据";
  }
  if (source === "deterministic-fallback") {
    return "确定性降级数据";
  }
  return source;
}

interface ChartRegion {
  startIndex: number;
  endIndex: number;
  lowValue: number;
  highValue: number;
}

function navIndexAtOrAfter(nav: FundNavPoint[], date: string): number | null {
  if (nav.length === 0) {
    return null;
  }
  const index = nav.findIndex((point) => point.nav_date >= date);
  return index >= 0 ? index : nav.length - 1;
}

function navValueAt(nav: FundNavPoint[], index: number, navType: FundNavType): number {
  const point = nav[index];
  return navType === "unit" ? point.unit_nav : point.cumulative_nav;
}

function findDrawdownRegion(
  nav: FundNavPoint[],
  navType: FundNavType,
  metrics: FundRiskMetrics | null,
  range: FundNavRange,
): ChartRegion | null {
  if (!metrics || metrics.range !== range || nav.length < 2) {
    return null;
  }

  const startIndex = navIndexAtOrAfter(nav, metrics.max_drawdown_start);
  const endIndex = navIndexAtOrAfter(nav, metrics.max_drawdown_end);
  if (startIndex === null || endIndex === null || endIndex <= startIndex) {
    return null;
  }

  let lowValue = Number.POSITIVE_INFINITY;
  let highValue = Number.NEGATIVE_INFINITY;
  for (let index = startIndex; index <= endIndex; index += 1) {
    const value = navValueAt(nav, index, navType);
    lowValue = Math.min(lowValue, value);
    highValue = Math.max(highValue, value);
  }

  return {
    startIndex,
    endIndex,
    lowValue,
    highValue,
  };
}

function findRecoveryRegion(
  nav: FundNavPoint[],
  navType: FundNavType,
  metrics: FundRiskMetrics | null,
  range: FundNavRange,
): ChartRegion | null {
  if (!metrics || metrics.range !== range || nav.length < 2) {
    return null;
  }

  const startIndex = navIndexAtOrAfter(nav, metrics.max_drawdown_recovery_start);
  const endDate =
    metrics.max_drawdown_recovery_end ?? nav.at(-1)?.nav_date;
  const endIndex = endDate ? navIndexAtOrAfter(nav, endDate) : null;
  if (startIndex === null || endIndex === null || endIndex <= startIndex) {
    return null;
  }

  let lowValue = Number.POSITIVE_INFINITY;
  let highValue = Number.NEGATIVE_INFINITY;
  for (let index = startIndex; index <= endIndex; index += 1) {
    const value = navValueAt(nav, index, navType);
    lowValue = Math.min(lowValue, value);
    highValue = Math.max(highValue, value);
  }

  return {
    startIndex,
    endIndex,
    lowValue,
    highValue,
  };
}

function NavLineChart({
  nav,
  range,
  navType,
  riskMetrics,
}: {
  nav: FundNavPoint[];
  range: FundNavRange;
  navType: FundNavType;
  riskMetrics?: FundRiskMetrics | null;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (nav.length === 0) {
    return <div className="py-16 text-center text-sm text-muted-foreground">暂无净值数据。</div>;
  }

  const width = 900;
  const height = 300;
  const paddingLeft = 56;
  const paddingRight = 18;
  const paddingTop = 18;
  const paddingBottom = 30;
  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;
  const values = nav.map((item) =>
    navType === "unit" ? item.unit_nav : item.cumulative_nav,
  );
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valueRange = maxValue - minValue || 1;
  const x = (index: number) =>
    paddingLeft + (index / Math.max(nav.length - 1, 1)) * plotWidth;
  const y = (value: number) =>
    paddingTop + ((maxValue - value) / valueRange) * plotHeight;
  const linePath = values
    .map((value, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(value)}`)
    .join(" ");
  const areaPath = `${linePath} L ${x(nav.length - 1)} ${height - paddingBottom} L ${x(0)} ${height - paddingBottom} Z`;
  const drawdown = findDrawdownRegion(nav, navType, riskMetrics ?? null, range);
  const recovery = findRecoveryRegion(nav, navType, riskMetrics ?? null, range);
  const ticks = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    return {
      ratio,
      value: maxValue - valueRange * ratio,
      y: paddingTop + plotHeight * ratio,
    };
  });
  const hovered = hoveredIndex === null ? null : nav[hoveredIndex];

  return (
    <div className="relative overflow-x-auto rounded-lg border bg-white p-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="min-w-[720px]"
        role="img"
        aria-label="基金净值走势图"
      >
        {drawdown && drawdown.endIndex > drawdown.startIndex ? (
          <rect
            x={x(drawdown.startIndex)}
            y={y(drawdown.highValue)}
            width={Math.max(0, x(drawdown.endIndex) - x(drawdown.startIndex))}
            height={Math.max(
              0,
              y(drawdown.lowValue) - y(drawdown.highValue),
            )}
            fill="#ef4444"
            fillOpacity="0.06"
          />
        ) : null}
        {recovery && recovery.endIndex > recovery.startIndex ? (
          <rect
            x={x(recovery.startIndex)}
            y={y(recovery.highValue)}
            width={Math.max(0, x(recovery.endIndex) - x(recovery.startIndex))}
            height={Math.max(
              0,
              y(recovery.lowValue) - y(recovery.highValue),
            )}
            fill="#10b981"
            fillOpacity="0.07"
          />
        ) : null}
        {ticks.map((tick) => (
          <g key={`${tick.value}-${tick.y}`}>
            <line
              x1={paddingLeft}
              x2={width - paddingRight}
              y1={tick.y}
              y2={tick.y}
              stroke="#e5e7eb"
              strokeDasharray="3 3"
            />
            <text
              x={paddingLeft - 8}
              y={tick.y + 4}
              textAnchor="end"
              fontSize="11"
              fill="#737373"
            >
              {tick.value.toFixed(3)}
            </text>
          </g>
        ))}
        <path d={areaPath} fill="#3b82f6" fillOpacity="0.08" />
        <path
          d={linePath}
          fill="none"
          stroke="#2563eb"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {nav.map((item, index) => (
          <circle
            key={`${item.nav_date}-${index}`}
            cx={x(index)}
            cy={y(navType === "unit" ? item.unit_nav : item.cumulative_nav)}
            r={hoveredIndex === index ? 5 : 2.5}
            fill={hoveredIndex === index ? "#1d4ed8" : "#3b82f6"}
            opacity="0.9"
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
          />
        ))}
        <text x={paddingLeft} y={height - 6} fontSize="11" fill="#737373">
          {nav[0]?.nav_date}
        </text>
        <text
          x={width - paddingRight}
          y={height - 6}
          textAnchor="end"
          fontSize="11"
          fill="#737373"
        >
          {nav.at(-1)?.nav_date}
        </text>
        <text
          x={width / 2}
          y={height - 6}
          textAnchor="middle"
          fontSize="11"
          fill="#737373"
        >
          {nav[Math.floor((nav.length - 1) / 2)]?.nav_date}
        </text>
      </svg>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded-sm bg-red-400/70" />
          最大回撤区间
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded-sm bg-emerald-400/70" />
          最大回撤修复区间
        </span>
      </div>
      {hovered ? (
        <div className="pointer-events-none absolute left-[70px] top-[26px] rounded-md border bg-white/95 px-3 py-2 text-xs text-slate-700 shadow-sm">
          <div>{hovered.nav_date}</div>
          <div>
            {navType === "unit" ? "单位净值" : "累计净值"}：
            {(navType === "unit" ? hovered.unit_nav : hovered.cumulative_nav).toFixed(4)}
          </div>
          <div>
            日涨跌：
            {hovered.daily_change_pct === null
              ? "暂无"
              : `${hovered.daily_change_pct > 0 ? "+" : ""}${hovered.daily_change_pct.toFixed(2)}%`}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 基金历史净值面板。 */
export function FundNavChartPanel({
  nav,
  range,
  navType,
  riskMetrics,
  loading,
  onRangeChange,
  onNavTypeChange,
}: FundNavChartPanelProps) {
  const latest = nav.at(-1);
  const oldest = nav[0];
  const intervalReturn =
    latest && oldest
      ? ((navType === "unit" ? latest.unit_nav : latest.cumulative_nav) /
          (navType === "unit" ? oldest.unit_nav : oldest.cumulative_nav) -
          1) *
        100
      : null;

  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">历史净值走势</h2>
          <p className="text-xs text-muted-foreground">
            {latest
              ? `最新净值日期：${latest.nav_date}，来源：${fundSourceLabel(latest.source)}，抓取时间：${formatDateTime(latest.fetched_at)}`
              : "等待净值数据"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={range}
            onChange={(event) => onRangeChange(event.target.value as FundNavRange)}
            className="rounded-md border px-2 py-1.5 text-sm"
            aria-label="净值区间"
          >
            <option value="1m">近 1 月</option>
            <option value="3m">近 3 月</option>
            <option value="6m">近 6 月</option>
            <option value="1y">近 1 年</option>
            <option value="3y">近 3 年</option>
            <option value="all">全部</option>
          </select>
          <select
            value={navType}
            onChange={(event) => onNavTypeChange(event.target.value as FundNavType)}
            className="rounded-md border px-2 py-1.5 text-sm"
            aria-label="净值口径"
          >
            <option value="unit">单位净值</option>
            <option value="cumulative">累计净值</option>
          </select>
        </div>
      </div>

      {latest ? (
        <div className="mb-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border bg-muted/20 p-3">
            <div className="text-xs text-muted-foreground">最新{navType === "unit" ? "单位" : "累计"}净值</div>
            <div className="mt-1 text-xl font-semibold">
              {(navType === "unit" ? latest.unit_nav : latest.cumulative_nav).toFixed(4)}
            </div>
          </div>
          <div className="rounded-lg border bg-muted/20 p-3">
            <div className="text-xs text-muted-foreground">最新日涨跌</div>
            <div className="mt-1 text-xl font-semibold">
              {latest.daily_change_pct === null
                ? "暂无"
                : `${latest.daily_change_pct > 0 ? "+" : ""}${latest.daily_change_pct.toFixed(2)}%`}
            </div>
          </div>
          <div className="rounded-lg border bg-muted/20 p-3">
            <div className="text-xs text-muted-foreground">区间涨跌</div>
            <div className="mt-1 text-xl font-semibold">
              {intervalReturn === null
                ? "暂无"
                : `${intervalReturn > 0 ? "+" : ""}${intervalReturn.toFixed(2)}%`}
            </div>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">净值加载中...</div>
      ) : (
        <NavLineChart nav={nav} range={range} navType={navType} riskMetrics={riskMetrics} />
      )}
    </section>
  );
}
