"use client";

import { formatDateTime } from "@/lib/format";
import type { Kline, TechnicalIndicators } from "@/lib/shared/types";
import { IndicatorTrendChart } from "@/components/panels/IndicatorTrendChart";

interface IndicatorsPanelProps {
  indicators: TechnicalIndicators | null;
  klines: Kline[];
}

function formatValue(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined ? "暂无" : value.toFixed(digits);
}

/** 单个指标值及其灰色小字说明。 */
function IndicatorMetric({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-sm">
        <span className="font-medium">{label}：</span>
        {value}
      </p>
      <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{description}</p>
    </div>
  );
}

/** 技术指标面板。 */
export function IndicatorsPanel({ indicators, klines }: IndicatorsPanelProps) {
  if (!indicators) {
    return null;
  }

  return (
    <section className="tech-panel tech-lift p-4 shadow-sm">
      <h2 className="text-lg font-semibold">技术指标</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        本地计算，基于 {klines.length} 根 K 线，更新时间 {formatDateTime(indicators.updated_at)}
      </p>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <IndicatorMetric label="MA5" value={formatValue(indicators.ma.ma5)} description="最近 5 日收盘价均值，观察短线趋势。" />
          <IndicatorMetric label="MA10" value={formatValue(indicators.ma.ma10)} description="最近 10 日收盘价均值，观察短期趋势。" />
          <IndicatorMetric label="MA20" value={formatValue(indicators.ma.ma20)} description="最近 20 日收盘价均值，常作月线参考。" />
          <IndicatorMetric label="MA60" value={formatValue(indicators.ma.ma60)} description="最近 60 日收盘价均值，常作长期趋势参考。" />
          <IndicatorMetric label="MACD DIF" value={formatValue(indicators.macd.dif)} description="快线，12 日与 26 日 EMA 的差值。" />
          <IndicatorMetric label="MACD DEA" value={formatValue(indicators.macd.dea)} description="慢线，DIF 的 9 日平滑值，用于识别金叉/死叉。" />
          <IndicatorMetric label="MACD 柱" value={formatValue(indicators.macd.histogram)} description="DIF 与 DEA 差值的放大值，反映多空动能。" />
          <IndicatorMetric label="KDJ K" value={formatValue(indicators.kdj.k, 1)} description="快速确认线，对短期价格变化较敏感。" />
          <IndicatorMetric label="KDJ D" value={formatValue(indicators.kdj.d, 1)} description="慢速主线，通常较 K 线更平滑。" />
          <IndicatorMetric label="KDJ J" value={formatValue(indicators.kdj.j, 1)} description="敏感线，常用于判断超买超卖。" />
          <IndicatorMetric label="RSI6" value={formatValue(indicators.rsi.rsi6, 1)} description="6 日相对强弱，高于 70 偏超买，低于 30 偏超卖。" />
          <IndicatorMetric label="RSI12" value={formatValue(indicators.rsi.rsi12, 1)} description="12 日相对强弱，同样参考 70/30 阈值。" />
          <IndicatorMetric label="RSI24" value={formatValue(indicators.rsi.rsi24, 1)} description="24 日相对强弱，波动更平滑，适合中期判断。" />
          <IndicatorMetric label="BOLL 上轨" value={formatValue(indicators.boll.upper)} description="20 日均线加 2 倍标准差，常视为压力位。" />
          <IndicatorMetric label="BOLL 中轨" value={formatValue(indicators.boll.middle)} description="20 日均线，反映近期价格中枢。" />
          <IndicatorMetric label="BOLL 下轨" value={formatValue(indicators.boll.lower)} description="20 日均线减 2 倍标准差，常视为支撑位。" />
        </div>
        <IndicatorTrendChart klines={klines} />
      </div>
    </section>
  );
}
