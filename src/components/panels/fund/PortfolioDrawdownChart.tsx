"use client";

import type { FundPortfolioCurvePoint } from "@/lib/shared/types";
import { FundLineChart, type FundLineSeries } from "@/components/panels/fund/FundLineChart";

/** 基金组合回撤曲线。 */
export function PortfolioDrawdownChart({ points }: { points: FundPortfolioCurvePoint[] }) {
  const series: FundLineSeries[] = [
    {
      key: "portfolio-drawdown",
      label: "组合回撤",
      color: "#16a34a",
      tone: "drawdown",
      points: points.map((point) => ({ date: point.date, value: point.drawdown_pct })),
    },
  ];

  return <FundLineChart series={series} />;
}
