"use client";

import type { FundDcaEquityPoint } from "@/lib/shared/types";
import { FundLineChart, type FundLineSeries } from "@/components/panels/fund/FundLineChart";

/** 定投与一次性买入收益对比曲线。 */
export function DcaComparisonChart({
  dcaPoints,
  lumpSumPoints,
}: {
  dcaPoints: FundDcaEquityPoint[];
  lumpSumPoints: FundDcaEquityPoint[];
}) {
  const series: FundLineSeries[] = [
    {
      key: "dca",
      label: "定投策略",
      color: "#2563eb",
      tone: "return",
      points: dcaPoints.map((point) => ({ date: point.date, value: point.return_pct })),
    },
    {
      key: "lump-sum",
      label: "一次性买入",
      color: "#ea580c",
      tone: "return",
      points: lumpSumPoints.map((point) => ({ date: point.date, value: point.return_pct })),
    },
  ];

  return <FundLineChart series={series} />;
}
