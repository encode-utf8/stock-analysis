"use client";

import type { FundPortfolioCurvePoint } from "@/lib/shared/types";
import { FundLineChart, type FundLineSeries } from "@/components/panels/fund/FundLineChart";

/** 基金组合累计收益曲线。 */
export function PortfolioReturnChart({ points }: { points: FundPortfolioCurvePoint[] }) {
  const series: FundLineSeries[] = [
    {
      key: "portfolio-return",
      label: "组合累计收益",
      color: "#2563eb",
      tone: "return",
      points: points.map((point) => ({ date: point.date, value: point.return_pct })),
    },
  ];

  return <FundLineChart series={series} />;
}
