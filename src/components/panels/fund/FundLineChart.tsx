"use client";

import { useState } from "react";
import type { MouseEvent } from "react";

export interface FundLineSeries {
  key: string;
  label: string;
  color: string;
  tone: "return" | "drawdown" | "neutral";
  points: Array<{ date: string; value: number }>;
}

interface FundLineChartProps {
  series: FundLineSeries[];
}

const WIDTH = 900;
const HEIGHT = 300;
const PADDING_LEFT = 58;
const PADDING_RIGHT = 18;
const PADDING_TOP = 18;
const PADDING_BOTTOM = 30;
const PLOT_WIDTH = WIDTH - PADDING_LEFT - PADDING_RIGHT;
const PLOT_HEIGHT = HEIGHT - PADDING_TOP - PADDING_BOTTOM;

function valueTone(tone: FundLineSeries["tone"], value: number): string {
  if (tone === "drawdown") {
    return value === 0 ? "text-slate-700" : "text-green-700";
  }
  if (tone === "neutral") {
    return "text-slate-700";
  }
  if (value === 0) {
    return "text-slate-700";
  }
  return value > 0 ? "text-red-700" : "text-green-700";
}

function formatValue(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

/** 基金多曲线交互图：支持多序列叠加、悬停查看各序列收益。 */
export function FundLineChart({ series }: FundLineChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const datesSet = new Set<string>();
  for (const item of series) {
    for (const point of item.points) {
      datesSet.add(point.date);
    }
  }
  const dates = Array.from(datesSet).sort((left, right) => left.localeCompare(right));
  if (dates.length === 0) {
    return <div className="py-16 text-center text-sm text-muted-foreground">暂无曲线数据。</div>;
  }

  const alignedSeries = series.map((item) => {
    const valueByDate = new Map(item.points.map((point) => [point.date, point.value]));
    const values: Array<number | null> = [];
    let previous: number | null = null;
    for (const date of dates) {
      const value = valueByDate.get(date);
      if (value !== undefined) {
        previous = value;
      }
      values.push(previous);
    }
    return { item, values };
  });

  const allValues = alignedSeries.flatMap((item) =>
    item.values.filter((value): value is number => value !== null),
  );
  if (allValues.length === 0) {
    return <div className="py-16 text-center text-sm text-muted-foreground">暂无曲线数据。</div>;
  }

  const minValue = Math.min(0, ...allValues);
  const maxValue = Math.max(0, ...allValues);
  const valueRange = maxValue - minValue || 1;
  const x = (index: number) =>
    PADDING_LEFT + (index / Math.max(dates.length - 1, 1)) * PLOT_WIDTH;
  const y = (value: number) =>
    PADDING_TOP + ((maxValue - value) / valueRange) * PLOT_HEIGHT;
  const zeroY = y(0);
  const ticks = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    return {
      ratio,
      value: maxValue - valueRange * ratio,
      y: PADDING_TOP + PLOT_HEIGHT * ratio,
    };
  });

  const buildPath = (values: Array<number | null>) => {
    let path = "";
    let started = false;
    values.forEach((value, index) => {
      if (value === null) {
        return;
      }
      path += `${started ? "L" : "M"} ${x(index)} ${y(value)} `;
      started = true;
    });
    return path.trim();
  };

  const hoveredDate = hoveredIndex === null ? null : dates[hoveredIndex];

  const handleMouseMove = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }
    const scale = rect.width / WIDTH;
    const plotLeft = PADDING_LEFT * scale;
    const plotWidth = PLOT_WIDTH * scale;
    const ratio = (event.clientX - rect.left - plotLeft) / plotWidth;
    const index = Math.round(Math.max(0, Math.min(1, ratio)) * (dates.length - 1));
    setHoveredIndex(index);
  };

  return (
    <div className="relative overflow-x-auto rounded-lg border bg-white p-3">
      <div className="mb-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
        {series.map((item) => (
          <span key={item.key} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            {item.label}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="min-w-[720px]"
        role="img"
        aria-label="基金收益曲线对比图"
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
        {alignedSeries.map(({ item, values }) => (
          <path
            key={item.key}
            d={buildPath(values)}
            fill="none"
            stroke={item.color}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
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
        {hoveredIndex !== null
          ? alignedSeries.map(({ item, values }) => {
              const value = values[hoveredIndex];
              return value === null ? null : (
                <circle
                  key={`dot-${item.key}`}
                  cx={x(hoveredIndex)}
                  cy={y(value)}
                  r="5"
                  fill={item.color}
                  stroke="#ffffff"
                  strokeWidth="1.5"
                />
              );
            })
          : null}
        <text x={PADDING_LEFT} y={HEIGHT - 6} fontSize="11" fill="#737373">
          {dates[0]}
        </text>
        <text
          x={WIDTH - PADDING_RIGHT}
          y={HEIGHT - 6}
          textAnchor="end"
          fontSize="11"
          fill="#737373"
        >
          {dates.at(-1)}
        </text>
        <text
          x={WIDTH / 2}
          y={HEIGHT - 6}
          textAnchor="middle"
          fontSize="11"
          fill="#737373"
        >
          {dates[Math.floor((dates.length - 1) / 2)]}
        </text>
      </svg>

      {hoveredDate && hoveredIndex !== null ? (
        <div className="pointer-events-none absolute left-[72px] top-[52px] rounded-md border bg-white/95 px-3 py-2 text-xs text-slate-700 shadow-sm">
          <div className="font-medium">{hoveredDate}</div>
          {alignedSeries.map(({ item, values }) => {
            const value = values[hoveredIndex];
            return value === null ? null : (
              <div key={`tooltip-${item.key}`}>
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="ml-1">{item.label}?</span>
                <span className={valueTone(item.tone, value)}>{formatValue(value)}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
