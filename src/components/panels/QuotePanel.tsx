"use client";

import { formatDateTime, freshnessText, sourceLabel } from "@/lib/format";
import type { MarketQuote, Stock } from "@/lib/shared/types";

interface QuotePanelProps {
  stock: Stock;
  quote: MarketQuote;
}

function trendClass(value: number | null): string {
  if (value === null || value === 0) {
    return "";
  }
  return value > 0 ? "text-red-600" : "text-green-700";
}

/** 当前行情概览面板。 */
export function QuotePanel({ stock, quote }: QuotePanelProps) {
  const items: Array<{ label: string; value: string; note: string; tone?: string }> = [
    { label: "最新价", value: quote.price.toFixed(2), note: `${quote.change_pct >= 0 ? "+" : ""}${quote.change_pct.toFixed(2)}%`, tone: trendClass(quote.change_pct) },
    { label: "今开", value: quote.open.toFixed(2), note: `昨收 ${quote.prev_close.toFixed(2)}` },
    { label: "最高 / 最低", value: `${quote.high.toFixed(2)} / ${quote.low.toFixed(2)}`, note: stock.exchange },
    { label: "成交量额", value: `${(quote.volume / 1000000).toFixed(2)} 万手`, note: `${(quote.amount / 100000000).toFixed(1)} 亿元` },
  ];

  return (
    <section className="space-y-3">
      <div className="rounded-xl border bg-white px-4 py-3 text-xs text-muted-foreground">
        数据时间：{formatDateTime(quote.fetched_at)}（{freshnessText(quote.fetched_at)}），
        来源：{sourceLabel(quote.source)}
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="text-xs text-muted-foreground">{item.label}</div>
            <div className="mt-2 text-2xl font-semibold">{item.value}</div>
            <div className={`mt-1 text-xs text-muted-foreground ${item.tone ?? ""}`}>{item.note}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
