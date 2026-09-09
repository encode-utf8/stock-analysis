"use client";

import type { FundComparisonNavSeries } from "@/lib/shared/types";
import { FundLineChart, type FundLineSeries } from "@/components/panels/fund/FundLineChart";

const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c"];

/** 基金对比归一化收益曲线：多只基金统一从 0% 起点展示。 */
export function ComparisonNavChart({ series }: { series: FundComparisonNavSeries[] }) {
  const chartSeries: FundLineSeries[] = series
    .filter((item) => item.points.length > 0)
    .map((item, index) => ({
      key: item.code,
      label: item.name || item.code,
      color: COLORS[index % COLORS.length],
      tone: "return",
      points: item.points.map((point) => ({ date: point.date, value: point.return_pct })),
    }));

  return <FundLineChart series={chartSeries} />;
}
