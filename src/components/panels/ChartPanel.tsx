"use client";

import { useState } from "react";

import {
  degradedSnapshotSuffix,
  formatDateTime,
  freshnessText,
  sourceLabel,
} from "@/lib/format";
import type {
  AdjustType,
  Kline,
  KlinePeriod,
  MarketQuote,
  Stock,
} from "@/lib/shared/types";

interface ChartPanelProps {
  stock: Stock;
  quote: MarketQuote;
  klines: Kline[];
  period: KlinePeriod;
  adjust: AdjustType;
  loading: boolean;
  /** 数据源故障冷却中：禁用周期与复权切换，避免连续点击。 */
  blocked?: boolean;
  onPeriodChange: (period: KlinePeriod) => void;
  onAdjustChange: (adjust: AdjustType) => void;
}

function CandlestickChart({ klines }: { klines: Kline[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (klines.length === 0) {
    return <div className="text-sm text-muted-foreground">暂无 K 线数据。</div>;
  }

  const width = 900;
  const height = 320;
  const volumeHeight = 70;
  const paddingLeft = 58;
  const paddingRight = 18;
  const paddingTop = 18;
  const paddingBottom = 22;
  const plotHeight = height - paddingTop - paddingBottom - volumeHeight;
  const plotBottom = height - paddingBottom - volumeHeight;
  const minPrice = Math.min(...klines.map((item) => item.low));
  const maxPrice = Math.max(...klines.map((item) => item.high));
  const range = maxPrice - minPrice || 1;
  const volumeMax = Math.max(...klines.map((item) => item.volume));
  const slot = (width - paddingLeft - paddingRight) / klines.length;
  const candleWidth = Math.max(2, slot * 0.6);

  const yPrice = (price: number) =>
    paddingTop + ((maxPrice - price) / range) * plotHeight;
  const yVolume = (volume: number) =>
    height - paddingBottom - (volume / volumeMax) * volumeHeight;
  const xCenter = (index: number) => paddingLeft + index * slot + slot / 2;

  const priceTicks = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    return {
      ratio,
      price: maxPrice - range * ratio,
      y: paddingTop + plotHeight * ratio,
    };
  });
  const hovered = hoveredIndex === null ? null : klines[hoveredIndex];

  return (
    <div className="relative overflow-x-auto tech-panel tech-lift p-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="min-w-[720px]"
        role="img"
        aria-label="K 线图"
      >
        {priceTicks.map((tick) => (
          <g key={`${tick.price}-${tick.y}`}>
            <line
              x1={paddingLeft}
              x2={width - paddingRight}
              y1={tick.y}
              y2={tick.y}
              stroke="var(--chart-grid)"
              strokeDasharray="3 3"
            />
            <text
              x={paddingLeft - 8}
              y={tick.y + 4}
              textAnchor="end"
              fontSize="11"
              fill="var(--chart-text)"
            >
              {tick.price.toFixed(2)}
            </text>
          </g>
        ))}
        <line
          x1={paddingLeft}
          x2={width - paddingRight}
          y1={plotBottom}
          y2={plotBottom}
          stroke="var(--chart-grid)"
        />
        {klines.map((item, index) => {
          const center = xCenter(index);
          const color = item.close >= item.open ? "#ef4444" : "#22c55e";
          const highY = yPrice(item.high);
          const lowY = yPrice(item.low);
          const openY = yPrice(item.open);
          const closeY = yPrice(item.close);
          return (
            <g
              key={`${item.ts}-${index}`}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <rect
                x={paddingLeft + index * slot}
                y={paddingTop}
                width={slot}
                height={height - paddingTop - paddingBottom}
                fill="transparent"
              />
              <line x1={center} x2={center} y1={highY} y2={lowY} stroke={color} />
              <rect
                x={center - candleWidth / 2}
                y={Math.min(openY, closeY)}
                width={candleWidth}
                height={Math.max(Math.abs(closeY - openY), 1)}
                fill={color}
              />
              <rect
                x={center - candleWidth / 2}
                y={yVolume(item.volume)}
                width={candleWidth}
                height={height - paddingBottom - yVolume(item.volume)}
                fill={color}
                opacity={0.45}
              />
            </g>
          );
        })}
        {hovered ? (
          <g pointerEvents="none">
            <line
              x1={xCenter(hoveredIndex ?? 0)}
              x2={xCenter(hoveredIndex ?? 0)}
              y1={paddingTop}
              y2={plotBottom}
              stroke="#94a3b8"
              strokeDasharray="2 2"
            />
            <rect
              x={Math.min(
                Math.max(xCenter(hoveredIndex ?? 0) - 72, paddingLeft - 6),
                width - paddingRight - 148,
              )}
              y={paddingTop + 4}
              width={144}
              height={94}
              rx={6}
              fill="var(--chart-tooltip-bg)"
              fillOpacity={0.96}
              stroke="var(--chart-tooltip-border)"
            />
            <text
              x={Math.min(
                Math.max(xCenter(hoveredIndex ?? 0) - 60, paddingLeft + 4),
                width - paddingRight - 138,
              )}
              y={paddingTop + 20}
              fontSize="12"
              fill="var(--chart-tooltip-text)"
            >
              时间：{new Date(hovered.ts).toLocaleString("zh-CN", { hour12: false })}
            </text>
            <text
              x={Math.min(
                Math.max(xCenter(hoveredIndex ?? 0) - 60, paddingLeft + 4),
                width - paddingRight - 138,
              )}
              y={paddingTop + 38}
              fontSize="12"
              fill="var(--chart-tooltip-text)"
            >
              开：{hovered.open.toFixed(2)}  高：{hovered.high.toFixed(2)}
            </text>
            <text
              x={Math.min(
                Math.max(xCenter(hoveredIndex ?? 0) - 60, paddingLeft + 4),
                width - paddingRight - 138,
              )}
              y={paddingTop + 56}
              fontSize="12"
              fill="var(--chart-tooltip-text)"
            >
              低：{hovered.low.toFixed(2)}  收：{hovered.close.toFixed(2)}
            </text>
            <text
              x={Math.min(
                Math.max(xCenter(hoveredIndex ?? 0) - 60, paddingLeft + 4),
                width - paddingRight - 138,
              )}
              y={paddingTop + 74}
              fontSize="12"
              fill="#94a3b8"
            >
              量：{(hovered.volume / 10000).toFixed(1)} 万
            </text>
          </g>
        ) : null}
        <text x={paddingLeft} y={height - 4} fontSize="11" fill="var(--chart-text)">
          {klines[0]?.ts.slice(0, 10)}
        </text>
        <text
          x={width - paddingRight}
          y={height - 4}
          textAnchor="end"
          fontSize="11"
          fill="var(--chart-text)"
        >
          {klines.at(-1)?.ts.slice(0, 10)}
        </text>
        <text
          x={width / 2}
          y={height - 4}
          textAnchor="middle"
          fontSize="11"
          fill="var(--chart-text)"
        >
          {klines[Math.floor((klines.length - 1) / 2)]?.ts.slice(0, 10)}
        </text>
        <text
          x={paddingLeft - 6}
          y={paddingTop - 6}
          textAnchor="end"
          fontSize="11"
          fill="#94a3b8"
        >
          价格
        </text>
        <text
          x={width - paddingRight}
          y={height - paddingBottom + 10}
          textAnchor="end"
          fontSize="11"
          fill="#94a3b8"
        >
          成交量
        </text>
      </svg>
    </div>
  );
}

/** K 线图表面板。 */
export function ChartPanel({
  stock,
  quote,
  klines,
  period,
  adjust,
  loading,
  blocked = false,
  onPeriodChange,
  onAdjustChange,
}: ChartPanelProps) {
  return (
    <section className="tech-panel tech-lift p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{stock.name}（{stock.code}）盘面</h2>
          <p className="text-xs text-muted-foreground">
            数据时间：{formatDateTime(quote.fetched_at)}（{freshnessText(quote.fetched_at)}），
            来源：{sourceLabel(quote.source)}
            {degradedSnapshotSuffix(quote.degraded_snapshot)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={period}
            onChange={(event) => onPeriodChange(event.target.value as KlinePeriod)}
            disabled={blocked}
            className="rounded-md border px-2 py-1.5 text-sm"
            aria-label="K 线周期"
          >
            <option value="minute">分时</option>
            <option value="day">日 K</option>
            <option value="week">周 K</option>
            <option value="month">月 K</option>
          </select>
          <select
            value={adjust}
            onChange={(event) => onAdjustChange(event.target.value as AdjustType)}
            disabled={blocked}
            className="rounded-md border px-2 py-1.5 text-sm"
            aria-label="复权方式"
          >
            <option value="qfq">前复权</option>
            <option value="hfq">后复权</option>
            <option value="none">不复权</option>
          </select>
        </div>
      </div>
      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">图表加载中...</div>
      ) : (
        <CandlestickChart klines={klines} />
      )}
    </section>
  );
}
