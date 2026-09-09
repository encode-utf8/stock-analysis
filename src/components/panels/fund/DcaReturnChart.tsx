"use client";

import { useState } from "react";
import type { MouseEvent } from "react";

import type { FundDcaEquityPoint } from "@/lib/shared/types";

const WIDTH = 900;
const HEIGHT = 300;
const PADDING_LEFT = 56;
const PADDING_RIGHT = 18;
const PADDING_TOP = 18;
const PADDING_BOTTOM = 30;
const PLOT_WIDTH = WIDTH - PADDING_LEFT - PADDING_RIGHT;
const PLOT_HEIGHT = HEIGHT - PADDING_TOP - PADDING_BOTTOM;

function formatMoney(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}¥${Math.abs(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function returnTone(value: number): string {
  if (value === 0) {
    return "text-slate-900";
  }
  return value > 0 ? "text-red-700" : "text-green-700";
}

/** 基金定投收益率变化曲线：支持鼠标悬停查看单日市值、投入与收益率。 */
interface DcaReturnChartProps {
  points: FundDcaEquityPoint[];
  drawdownStart?: string | null;
  drawdownEnd?: string | null;
  recoveryStart?: string | null;
  recoveryEnd?: string | null;
  recoveryComplete?: boolean;
}

export function DcaReturnChart({
  points,
  drawdownStart = null,
  drawdownEnd = null,
  recoveryStart = null,
  recoveryEnd = null,
  recoveryComplete = false,
}: DcaReturnChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (points.length === 0) {
    return <div className="py-16 text-center text-sm text-muted-foreground">暂无收益率曲线数据。</div>;
  }

  const values = points.map((item) => item.return_pct);
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(0, ...values);
  const valueRange = maxValue - minValue || 1;
  const x = (index: number) =>
    PADDING_LEFT + (index / Math.max(points.length - 1, 1)) * PLOT_WIDTH;
  const y = (value: number) =>
    PADDING_TOP + ((maxValue - value) / valueRange) * PLOT_HEIGHT;
  const zeroY = y(0);
  const linePath = values
    .map((value, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(value)}`)
    .join(" ");
  const areaPath = `${linePath} L ${x(points.length - 1)} ${zeroY} L ${x(0)} ${zeroY} Z`;
  const ticks = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    return {
      ratio,
      value: maxValue - valueRange * ratio,
      y: PADDING_TOP + PLOT_HEIGHT * ratio,
    };
  });
  const hovered = hoveredIndex === null ? null : points[hoveredIndex];

  const indexForDate = (date: string | null) => {
    if (!date || points.length === 0) {
      return null;
    }
    let low = 0;
    let high = points.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const current = points[mid]?.date ?? "";
      if (current === date) {
        return mid;
      }
      if (current < date) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return Math.min(low, points.length - 1);
  };

  const drawdownStartIndex = indexForDate(drawdownStart ?? null);
  const drawdownEndIndex = indexForDate(drawdownEnd ?? null);
  const recoveryStartIndex = indexForDate(recoveryStart ?? null);
  const recoveryEndIndex = (recoveryEnd ? indexForDate(recoveryEnd) : points.length - 1) ?? points.length - 1;

  const handleMouseMove = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }
    const scale = rect.width / WIDTH;
    const plotLeft = PADDING_LEFT * scale;
    const plotWidth = PLOT_WIDTH * scale;
    const ratio = (event.clientX - rect.left - plotLeft) / plotWidth;
    const index = Math.round(Math.max(0, Math.min(1, ratio)) * (points.length - 1));
    setHoveredIndex(index);
  };

  return (
    <div className="relative overflow-x-auto rounded-lg border bg-white p-3">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="min-w-[720px]"
        role="img"
        aria-label="基金定投收益率变化曲线"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredIndex(null)}
      >
        {ticks.map((tick) => (
          <g key={`${tick.value}-${tick.y}`}>
            <line
              x1={PADDING_LEFT}
              x2={WIDTH - PADDING_RIGHT}
              y1={tick.y}
              y2={tick.y}
              stroke="#e5e7eb"
              strokeDasharray="3 3"
            />
            <text
              x={PADDING_LEFT - 8}
              y={tick.y + 4}
              textAnchor="end"
              fontSize="11"
              fill="#737373"
            >
              {tick.value.toFixed(1)}%
            </text>
          </g>
        ))}
        <line
          x1={PADDING_LEFT}
          x2={WIDTH - PADDING_RIGHT}
          y1={zeroY}
          y2={zeroY}
          stroke="#94a3b8"
          strokeWidth="1"
          strokeDasharray="5 5"
        />
        {drawdownStartIndex !== null && drawdownEndIndex !== null ? (
          <rect
            x={x(drawdownStartIndex)}
            y={PADDING_TOP}
            width={Math.max(x(drawdownEndIndex) - x(drawdownStartIndex), 2)}
            height={HEIGHT - PADDING_TOP - PADDING_BOTTOM}
            fill="#22c55e"
            fillOpacity="0.07"
          />
        ) : null}
        {recoveryStartIndex !== null ? (
          <rect
            x={x(recoveryStartIndex)}
            y={PADDING_TOP}
            width={Math.max(x(recoveryEndIndex) - x(recoveryStartIndex), 2)}
            height={HEIGHT - PADDING_TOP - PADDING_BOTTOM}
            fill="#ef4444"
            fillOpacity={recoveryComplete ? 0.1 : 0.08}
            stroke={recoveryComplete ? "none" : "#dc2626"}
            strokeDasharray={recoveryComplete ? undefined : "4 4"}
          />
        ) : null}
        <path d={areaPath} fill="#3b82f6" fillOpacity="0.08" />
        <path
          d={linePath}
          fill="none"
          stroke="#2563eb"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {hoveredIndex !== null ? (
          <line
            x1={x(hoveredIndex)}
            x2={x(hoveredIndex)}
            y1={PADDING_TOP}
            y2={HEIGHT - PADDING_BOTTOM}
            stroke="#94a3b8"
            strokeDasharray="3 3"
          />
        ) : null}
        {points.map((item, index) => (
          <circle
            key={`${item.date}-${index}`}
            cx={x(index)}
            cy={y(item.return_pct)}
            r={hoveredIndex === index ? 5 : 1.5}
            fill={hoveredIndex === index ? "#1d4ed8" : "#3b82f6"}
            opacity="0.9"
          />
        ))}
        <text x={PADDING_LEFT} y={HEIGHT - 6} fontSize="11" fill="#737373">
          {points[0]?.date}
        </text>
        <text
          x={WIDTH - PADDING_RIGHT}
          y={HEIGHT - 6}
          textAnchor="end"
          fontSize="11"
          fill="#737373"
        >
          {points.at(-1)?.date}
        </text>
        <text
          x={WIDTH / 2}
          y={HEIGHT - 6}
          textAnchor="middle"
          fontSize="11"
          fill="#737373"
        >
          {points[Math.floor((points.length - 1) / 2)]?.date}
        </text>
      </svg>

      {(drawdownStart || recoveryStart) ? (
        <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
          {drawdownStart && drawdownEnd ? (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded-sm bg-green-200" />
              最大回撤：{drawdownStart} 至 {drawdownEnd}
            </span>
          ) : null}
          {recoveryStart ? (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded-sm bg-red-200" />
              {recoveryComplete && recoveryEnd
                ? `修复完成：${recoveryStart} 至 ${recoveryEnd}`
                : `正在修复中：自 ${recoveryStart} 起`}
            </span>
          ) : null}
        <p className="mt-1 text-xs text-muted-foreground">说明：回撤区间为收益率从阶段高点下滑到阶段低点的最大跌幅区间；修复区间为收益率从回撤末端重新回到回撤起点水平所需的时间区间。</p>
        </div>
      ) : null}

      {hovered ? (
        <div className="pointer-events-none absolute left-[70px] top-[26px] rounded-md border bg-white/95 px-3 py-2 text-xs text-slate-700 shadow-sm">
          <div className="font-medium">{hovered.date}</div>
          <div className={returnTone(hovered.return_pct)}>
            累计收益率：
            {hovered.return_pct > 0 ? "+" : ""}
            {hovered.return_pct.toFixed(2)}%
          </div>
          <div>累计投入：{formatMoney(hovered.invested_amount)}</div>
          <div>当日市值：{formatMoney(hovered.market_value)}</div>
        </div>
      ) : null}
    </div>
  );
}
