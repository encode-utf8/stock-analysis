"use client";

import { useState } from "react";

import {
  calculateBollSeries,
  calculateKdjSeries,
  calculateMacdSeries,
  calculateRsiSeries,
} from "@/lib/indicators";
import type { Kline } from "@/lib/shared/types";

type ChartMode = "macd" | "kdj" | "rsi" | "boll";

const WIDTH = 900;
const HEIGHT = 260;
const PADDING_LEFT = 52;
const PADDING_RIGHT = 20;
const PADDING_TOP = 14;
const PADDING_BOTTOM = 22;

const CHART_OPTIONS: Array<{ key: ChartMode; label: string }> = [
  { key: "macd", label: "MACD" },
  { key: "kdj", label: "KDJ" },
  { key: "rsi", label: "RSI" },
  { key: "boll", label: "BOLL" },
];

function xFor(index: number, length: number): number {
  const plotWidth = WIDTH - PADDING_LEFT - PADDING_RIGHT;
  return PADDING_LEFT + (length > 1 ? (index / (length - 1)) * plotWidth : plotWidth / 2);
}

function dateText(klines: Kline[], pointIndex: number | undefined): string {
  if (pointIndex === undefined) {
    return "";
  }
  return klines[pointIndex]?.ts.slice(0, 10) ?? "";
}

function Legend({ items }: { items: Array<{ color: string; label: string }> }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1">
          <span className="h-2 w-4 rounded-sm" style={{ backgroundColor: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function ChartNote({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-xs leading-5 text-muted-foreground">{children}</p>;
}

function MacdChart({ klines }: { klines: Kline[] }) {
  const points = calculateMacdSeries(klines.map((item) => item.close));
  if (points.length < 2) {
    return <EmptyChart text="MACD 数据不足，需至少 26 根 K 线。" />;
  }

  const lineHeight = 96;
  const gap = 18;
  const lineTop = PADDING_TOP;
  const lineBottom = PADDING_TOP + lineHeight;
  const histTop = lineBottom + gap;
  const histBottom = HEIGHT - PADDING_BOTTOM;
  const histZeroY = histTop + (histBottom - histTop) / 2;
  const lineMin = Math.min(0, ...points.map((item) => item.dif), ...points.map((item) => item.dea));
  const lineMax = Math.max(0, ...points.map((item) => item.dif), ...points.map((item) => item.dea));
  const lineRange = lineMax - lineMin || 1;
  const histMax = Math.max(...points.map((item) => Math.abs(item.histogram)), 1);
  const plotWidth = WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const slot = points.length > 1 ? plotWidth / (points.length - 1) : plotWidth;
  const yLine = (value: number) => lineTop + ((lineMax - value) / lineRange) * lineHeight;
  const histHeight = (value: number) => (Math.abs(value) / histMax) * (histZeroY - histTop);

  const crossovers = points.slice(1).reduce<Array<{ index: number; type: "gold" | "death" }>>(
    (acc, point, offset) => {
      const previous = points[offset];
      if (previous.dif <= previous.dea && point.dif > point.dea) {
        acc.push({ index: offset + 1, type: "gold" });
      } else if (previous.dif >= previous.dea && point.dif < point.dea) {
        acc.push({ index: offset + 1, type: "death" });
      }
      return acc;
    },
    [],
  );

  return (
    <div>
      <Legend
        items={[
          { color: "#3b82f6", label: "DIF" },
          { color: "#f59e0b", label: "DEA" },
          { color: "#ef4444", label: "金叉" },
          { color: "#22c55e", label: "死叉" },
        ]}
      />
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="min-w-[720px]" aria-label="MACD 指标图">
          <line x1={PADDING_LEFT} x2={WIDTH - PADDING_RIGHT} y1={lineBottom} y2={lineBottom} stroke="var(--chart-grid)" />
          <line x1={PADDING_LEFT} x2={WIDTH - PADDING_RIGHT} y1={histZeroY} y2={histZeroY} stroke="#94a3b8" strokeDasharray="3 3" />
          {points.map((point, index) => {
            const color = point.histogram >= 0 ? "#ef4444" : "#22c55e";
            const barY = point.histogram >= 0 ? histZeroY - histHeight(point.histogram) : histZeroY;
            return (
              <rect
                key={`${point.index}-hist`}
                x={xFor(index, points.length) - Math.max(1, slot * 0.22)}
                y={barY}
                width={Math.max(1, slot * 0.44)}
                height={Math.max(histHeight(point.histogram), 1)}
                fill={color}
                opacity={0.75}
              />
            );
          })}
          <polyline
            points={points.map((point, index) => `${xFor(index, points.length)},${yLine(point.dif)}`).join(" ")}
            fill="none"
            stroke="#3b82f6"
            strokeWidth="1.8"
          />
          <polyline
            points={points.map((point, index) => `${xFor(index, points.length)},${yLine(point.dea)}`).join(" ")}
            fill="none"
            stroke="#f59e0b"
            strokeWidth="1.8"
          />
          {crossovers.map((cross) => {
            const point = points[cross.index];
            const isGold = cross.type === "gold";
            const color = isGold ? "#ef4444" : "#22c55e";
            return (
              <g key={`${point.index}-${cross.type}`}>
                <circle cx={xFor(cross.index, points.length)} cy={yLine(point.dif)} r="3" fill={color} />
                <text
                  x={xFor(cross.index, points.length)}
                  y={isGold ? yLine(point.dif) - 8 : yLine(point.dif) + 16}
                  textAnchor="middle"
                  fontSize="11"
                  fill={color}
                >
                  {isGold ? "金叉" : "死叉"}
                </text>
              </g>
            );
          })}
          <text x={PADDING_LEFT} y={HEIGHT - 4} fontSize="11" fill="var(--chart-text)">
            {dateText(klines, points[0]?.index)}
          </text>
          <text x={WIDTH - PADDING_RIGHT} y={HEIGHT - 4} textAnchor="end" fontSize="11" fill="var(--chart-text)">
            {dateText(klines, points.at(-1)?.index)}
          </text>
          <text x={PADDING_LEFT - 6} y={PADDING_TOP + 10} textAnchor="end" fontSize="11" fill="#94a3b8">
            DIF/DEA
          </text>
          <text x={PADDING_LEFT - 6} y={histZeroY + 4} textAnchor="end" fontSize="11" fill="#94a3b8">
            MACD 柱
          </text>
        </svg>
      </div>
      <ChartNote>金叉 = DIF 上穿 DEA，通常视为偏多信号；死叉 = DIF 下穿 DEA，通常视为偏空信号。</ChartNote>
    </div>
  );
}

function KdjChart({ klines }: { klines: Kline[] }) {
  const points = calculateKdjSeries(klines);
  if (points.length < 2) {
    return <EmptyChart text="KDJ 数据不足，需至少 9 根 K 线。" />;
  }

  const min = 0;
  const max = 100;
  const range = max - min || 1;
  const chartHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const y = (value: number) => PADDING_TOP + ((max - value) / range) * chartHeight;

  return (
    <div>
      <Legend
        items={[
          { color: "#3b82f6", label: "K" },
          { color: "#f59e0b", label: "D" },
          { color: "#9333ea", label: "J" },
        ]}
      />
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="min-w-[720px]" aria-label="KDJ 指标图">
          {[20, 50, 80].map((level) => (
            <g key={level}>
              <line x1={PADDING_LEFT} x2={WIDTH - PADDING_RIGHT} y1={y(level)} y2={y(level)} stroke="var(--chart-grid)" strokeDasharray="3 3" />
              <text x={PADDING_LEFT - 8} y={y(level) + 4} textAnchor="end" fontSize="10" fill="#94a3b8">
                {level}
              </text>
            </g>
          ))}
          <polyline points={points.map((point, index) => `${xFor(index, points.length)},${y(point.k)}`).join(" ")} fill="none" stroke="#3b82f6" strokeWidth="1.8" />
          <polyline points={points.map((point, index) => `${xFor(index, points.length)},${y(point.d)}`).join(" ")} fill="none" stroke="#f59e0b" strokeWidth="1.8" />
          <polyline points={points.map((point, index) => `${xFor(index, points.length)},${y(point.j)}`).join(" ")} fill="none" stroke="#9333ea" strokeWidth="1.8" />
          <text x={PADDING_LEFT} y={HEIGHT - 4} fontSize="11" fill="var(--chart-text)">
            {dateText(klines, points[0]?.index)}
          </text>
          <text x={WIDTH - PADDING_RIGHT} y={HEIGHT - 4} textAnchor="end" fontSize="11" fill="var(--chart-text)">
            {dateText(klines, points.at(-1)?.index)}
          </text>
        </svg>
      </div>
      <ChartNote>K 上穿 D 为金叉，下穿 D 为死叉；J 值超出 0 到 100 区间较多时提示超买或超卖。</ChartNote>
    </div>
  );
}

function RsiChart({ klines }: { klines: Kline[] }) {
  const closes = klines.map((item) => item.close);
  const rsi6 = calculateRsiSeries(closes, 6);
  const rsi12 = calculateRsiSeries(closes, 12);
  const rsi24 = calculateRsiSeries(closes, 24);
  const length = closes.length;
  if (length < 24) {
    return <EmptyChart text="RSI 数据不足，需至少 24 根 K 线。" />;
  }

  const min = 0;
  const max = 100;
  const range = max - min || 1;
  const chartHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const y = (value: number) => PADDING_TOP + ((max - value) / range) * chartHeight;
  const linePoints = (values: Array<number | null>) =>
    values
      .map((value, index) => (value === null ? null : `${xFor(index, length)},${y(value)}`))
      .filter((value): value is string => value !== null)
      .join(" ");

  return (
    <div>
      <Legend
        items={[
          { color: "#3b82f6", label: "RSI6" },
          { color: "#f59e0b", label: "RSI12" },
          { color: "#9333ea", label: "RSI24" },
        ]}
      />
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="min-w-[720px]" aria-label="RSI 指标图">
          {[30, 70].map((level) => (
            <g key={level}>
              <line x1={PADDING_LEFT} x2={WIDTH - PADDING_RIGHT} y1={y(level)} y2={y(level)} stroke="var(--chart-grid)" strokeDasharray="3 3" />
              <text x={PADDING_LEFT - 8} y={y(level) + 4} textAnchor="end" fontSize="10" fill="#94a3b8">
                {level}
              </text>
            </g>
          ))}
          <polyline points={linePoints(rsi6)} fill="none" stroke="#3b82f6" strokeWidth="1.8" />
          <polyline points={linePoints(rsi12)} fill="none" stroke="#f59e0b" strokeWidth="1.8" />
          <polyline points={linePoints(rsi24)} fill="none" stroke="#9333ea" strokeWidth="1.8" />
          <text x={PADDING_LEFT} y={HEIGHT - 4} fontSize="11" fill="var(--chart-text)">
            {klines[0]?.ts.slice(0, 10)}
          </text>
          <text x={WIDTH - PADDING_RIGHT} y={HEIGHT - 4} textAnchor="end" fontSize="11" fill="var(--chart-text)">
            {klines.at(-1)?.ts.slice(0, 10)}
          </text>
        </svg>
      </div>
      <ChartNote>RSI 高于 70 通常偏超买，低于 30 通常偏超卖；多周期 RSI 同步转向时信号更可靠。</ChartNote>
    </div>
  );
}

function BollChart({ klines }: { klines: Kline[] }) {
  const closes = klines.map((item) => item.close);
  const points = calculateBollSeries(closes);
  if (points.length < 2) {
    return <EmptyChart text="BOLL 数据不足，需至少 20 根 K 线。" />;
  }

  const allValues = [
    ...points.map((point) => point.upper),
    ...points.map((point) => point.middle),
    ...points.map((point) => point.lower),
    ...points.map((point) => klines[point.index]?.close ?? point.middle),
  ];
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;
  const chartHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const y = (value: number) => PADDING_TOP + ((max - value) / range) * chartHeight;

  return (
    <div>
      <Legend
        items={[
          { color: "#3b82f6", label: "收盘价" },
          { color: "#f59e0b", label: "上轨" },
          { color: "#94a3b8", label: "中轨" },
          { color: "#22c55e", label: "下轨" },
        ]}
      />
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="min-w-[720px]" aria-label="BOLL 指标图">
          <polyline points={points.map((point, index) => `${xFor(index, points.length)},${y(point.upper)}`).join(" ")} fill="none" stroke="#f59e0b" strokeWidth="1.5" />
          <polyline points={points.map((point, index) => `${xFor(index, points.length)},${y(point.middle)}`).join(" ")} fill="none" stroke="#94a3b8" strokeWidth="1.5" />
          <polyline points={points.map((point, index) => `${xFor(index, points.length)},${y(point.lower)}`).join(" ")} fill="none" stroke="#22c55e" strokeWidth="1.5" />
          <polyline
            points={points.map((point, index) => `${xFor(index, points.length)},${y(klines[point.index]?.close ?? point.middle)}`).join(" ")}
            fill="none"
            stroke="#3b82f6"
            strokeWidth="2"
          />
          <text x={PADDING_LEFT} y={HEIGHT - 4} fontSize="11" fill="var(--chart-text)">
            {dateText(klines, points[0]?.index)}
          </text>
          <text x={WIDTH - PADDING_RIGHT} y={HEIGHT - 4} textAnchor="end" fontSize="11" fill="var(--chart-text)">
            {dateText(klines, points.at(-1)?.index)}
          </text>
        </svg>
      </div>
      <ChartNote>价格沿中轨运行，突破上轨或下轨通常提示短期强势或弱势；轨道收口可能预示波动率放大。</ChartNote>
    </div>
  );
}

function EmptyChart({ text }: { text: string }) {
  return <div className="py-16 text-center text-sm text-muted-foreground">{text}</div>;
}

/** 技术指标切换图：在 MACD 图框顶部居中的位置切换不同指标。 */
export function IndicatorTrendChart({ klines }: { klines: Kline[] }) {
  const [mode, setMode] = useState<ChartMode>("macd");

  return (
    <div className="tech-panel tech-lift p-3">
      <div className="mb-2 flex justify-center gap-1 rounded-md bg-muted/40 p-1">
        {CHART_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setMode(option.key)}
            className={`rounded px-3 py-1 text-xs font-medium transition ${
              mode === option.key ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {mode === "macd" ? <MacdChart klines={klines} /> : null}
      {mode === "kdj" ? <KdjChart klines={klines} /> : null}
      {mode === "rsi" ? <RsiChart klines={klines} /> : null}
      {mode === "boll" ? <BollChart klines={klines} /> : null}
    </div>
  );
}
