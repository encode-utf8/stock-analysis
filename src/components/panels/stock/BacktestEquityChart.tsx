"use client";

import { useMemo, useState } from "react";
import type { MouseEvent } from "react";

import { resolveHoverIndex } from "@/lib/chart-hover";
import type { BacktestPoint } from "@/lib/shared/types";

interface BacktestEquityChartProps {
  points: BacktestPoint[];
  initialCapital: number;
}

const WIDTH = 900;
const HEIGHT = 320;
const PADDING_LEFT = 78;
const PADDING_RIGHT = 18;
const PADDING_TOP = 24;
const PADDING_BOTTOM = 32;
const PLOT_WIDTH = WIDTH - PADDING_LEFT - PADDING_RIGHT;
const PLOT_HEIGHT = HEIGHT - PADDING_TOP - PADDING_BOTTOM;

function formatMoney(value: number): string {
  return `${Math.round(value).toLocaleString("zh-CN")}`;
}

function formatSignedPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

/**
 * 回测净值曲线：策略与买入持有基准同图对照。
 * 与基金侧一致使用手绘 SVG，不引入图表库依赖；svg 按 viewBox 的自然宽高比铺满卡片宽度，
 * 窄屏由外层 overflow-x-auto 横向滚动，元素与 viewBox 等比因此悬停换算不受留白影响。
 */
export function BacktestEquityChart({ points, initialCapital }: BacktestEquityChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // 净值曲线的几何计算只依赖数据本身，缓存起来避免鼠标移动时反复重建整条路径。
  const geometry = useMemo(() => {
    if (points.length < 2) {
      return null;
    }

    const values = points.flatMap((point) => [point.strategy, point.benchmark]);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const padding = Math.max((rawMax - rawMin) * 0.08, initialCapital * 0.01, 1);
    const min = rawMin - padding;
    const max = rawMax + padding;

    const xOf = (index: number) => PADDING_LEFT + (index / (points.length - 1)) * PLOT_WIDTH;
    const yOf = (value: number) => PADDING_TOP + (1 - (value - min) / (max - min)) * PLOT_HEIGHT;

    const strategyPath = points
      .map((point, index) => `${index === 0 ? "M" : "L"}${xOf(index).toFixed(2)},${yOf(point.strategy).toFixed(2)}`)
      .join(" ");
    const benchmarkPath = points
      .map((point, index) => `${index === 0 ? "M" : "L"}${xOf(index).toFixed(2)},${yOf(point.benchmark).toFixed(2)}`)
      .join(" ");

    const gridValues = [0, 0.25, 0.5, 0.75, 1].map((ratio) => min + (max - min) * ratio);
    const labelIndices = [0, Math.floor((points.length - 1) / 2), points.length - 1];

    return { xOf, yOf, strategyPath, benchmarkPath, gridValues, labelIndices };
  }, [points, initialCapital]);

  if (!geometry) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        暂无可绘制的净值数据。
      </div>
    );
  }

  const { xOf, yOf, strategyPath, benchmarkPath, gridValues, labelIndices } = geometry;
  const hovered = hoverIndex === null ? null : points[hoverIndex];
  const hoveredRatio = hovered === null ? null : (hovered.strategy / initialCapital - 1) * 100;

  const handleMove = (event: MouseEvent<SVGSVGElement>) => {
    // 按 SVG 实际渲染的内容换算（扣掉 xMidYMid meet 的居中留白），避免宽屏下悬停错位。
    const index = resolveHoverIndex({
      clientX: event.clientX,
      box: event.currentTarget.getBoundingClientRect(),
      viewBoxWidth: WIDTH,
      viewBoxHeight: HEIGHT,
      paddingLeft: PADDING_LEFT,
      paddingRight: PADDING_RIGHT,
      count: points.length,
    });
    if (index !== null) {
      setHoverIndex(index);
    }
  };

  return (
    <div className="relative overflow-x-auto rounded-lg border bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5 bg-red-600" aria-hidden="true" />
          策略净值
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5 bg-slate-500" aria-hidden="true" />
          买入持有基准
        </span>
        <span>初始资金 {formatMoney(initialCapital)}</span>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="min-w-[720px]"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="回测净值曲线"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {gridValues.map((value) => (
          <g key={value}>
            <line
              x1={PADDING_LEFT}
              x2={WIDTH - PADDING_RIGHT}
              y1={yOf(value)}
              y2={yOf(value)}
              stroke="#e2e8f0"
              strokeDasharray="3 3"
            />
            <text x={PADDING_LEFT - 8} y={yOf(value) + 4} textAnchor="end" fontSize="11" fill="#64748b">
              {formatMoney(value)}
            </text>
          </g>
        ))}

        {labelIndices.map((index) => (
          <text
            key={index}
            x={xOf(index)}
            y={HEIGHT - 10}
            textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}
            fontSize="11"
            fill="#64748b"
          >
            {points[index].date}
          </text>
        ))}

        <path d={benchmarkPath} fill="none" stroke="#64748b" strokeWidth="1.6" strokeDasharray="5 4" />
        <path d={strategyPath} fill="none" stroke="#dc2626" strokeWidth="2" />

        {hovered && hoverIndex !== null ? (
          <g>
            <line
              x1={xOf(hoverIndex)}
              x2={xOf(hoverIndex)}
              y1={PADDING_TOP}
              y2={PADDING_TOP + PLOT_HEIGHT}
              stroke="#94a3b8"
              strokeDasharray="3 3"
            />
            <circle cx={xOf(hoverIndex)} cy={yOf(hovered.strategy)} r="3.5" fill="#dc2626" />
            <circle cx={xOf(hoverIndex)} cy={yOf(hovered.benchmark)} r="3.5" fill="#64748b" />
          </g>
        ) : null}
      </svg>

      <div className="mt-2 min-h-[2.5rem] text-xs text-muted-foreground">
        {hovered && hoveredRatio !== null ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="font-medium text-slate-700">{hovered.date}</span>
            <span>
              策略 {formatMoney(hovered.strategy)}（{formatSignedPercent(hoveredRatio)}）
            </span>
            <span>基准 {formatMoney(hovered.benchmark)}</span>
          </div>
        ) : (
          <span>把鼠标移到曲线上可查看任意日期的净值与收益。</span>
        )}
      </div>
    </div>
  );
}