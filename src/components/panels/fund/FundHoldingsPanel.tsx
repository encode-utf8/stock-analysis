"use client";

import { formatDateTime } from "@/lib/format";
import type { FundHoldings } from "@/lib/shared/types";

interface FundHoldingsPanelProps {
  holdings: FundHoldings | null;
  loading: boolean;
}

function fundSourceLabel(source: string): string {
  if (source === "akshare") {
    return "AkShare 基金数据";
  }
  if (source === "deterministic-fallback") {
    return "确定性降级数据";
  }
  return source;
}

function allocationText(allocation: Record<string, number>): string {
  const entries = Object.entries(allocation);
  if (entries.length === 0) {
    return "暂无";
  }
  return entries.map(([key, value]) => `${key} ${value.toFixed(2)}%`).join("、");
}

/** 基金最新季度持仓面板。 */
export function FundHoldingsPanel({ holdings, loading }: FundHoldingsPanelProps) {
  if (loading) {
    return (
      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="py-12 text-center text-sm text-muted-foreground">
          持仓数据加载中...
        </div>
      </section>
    );
  }

  if (!holdings) {
    return (
      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="py-12 text-center text-sm text-muted-foreground">
          暂无持仓数据。
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">最新季度持仓</h2>
          <p className="text-xs text-muted-foreground">
            报告期：{holdings.report_date}，来源：
            {fundSourceLabel(holdings.source)}，抓取时间：
            {formatDateTime(holdings.fetched_at)}
          </p>
        </div>
        <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
          持仓报告期，存在滞后
        </span>
      </div>

      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="text-xs text-muted-foreground">前十大合计占比</div>
          <div className="mt-1 text-xl font-semibold">
            {holdings.top10_weight_pct === null
              ? "暂无"
              : `${holdings.top10_weight_pct.toFixed(2)}%`}
          </div>
        </div>
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="text-xs text-muted-foreground">第一大重仓占比</div>
          <div className="mt-1 text-xl font-semibold">
            {holdings.top1_weight_pct === null
              ? "暂无"
              : `${holdings.top1_weight_pct.toFixed(2)}%`}
          </div>
        </div>
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="text-xs text-muted-foreground">资产配置</div>
          <div className="mt-1 text-sm font-medium">
            {allocationText(holdings.asset_allocation)}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-muted/30 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">序号</th>
              <th className="px-3 py-2 font-medium">资产名称</th>
              <th className="px-3 py-2 font-medium">代码</th>
              <th className="px-3 py-2 font-medium">占净值比例</th>
              <th className="px-3 py-2 font-medium">行业</th>
            </tr>
          </thead>
          <tbody>
            {holdings.top_holdings.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">
                  暂无前十大持仓明细。
                </td>
              </tr>
            ) : (
              holdings.top_holdings.map((holding, index) => (
                <tr key={`${holding.code ?? holding.name}-${index}`} className="border-t">
                  <td className="px-3 py-2 text-muted-foreground">{index + 1}</td>
                  <td className="px-3 py-2 font-medium">{holding.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{holding.code ?? "—"}</td>
                  <td className="px-3 py-2 font-medium">
                    {holding.weight_pct.toFixed(2)}%
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {holding.industry ?? "未知"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {Object.keys(holdings.industry_allocation).length > 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          行业配置：{allocationText(holdings.industry_allocation)}
        </p>
      ) : null}
    </section>
  );
}
