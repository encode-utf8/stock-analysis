"use client";

import { formatDateTime } from "@/lib/format";
import type { FundIntraday } from "@/lib/shared/types";

interface FundIntradayPanelProps {
  intraday: FundIntraday | null;
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

function signed(value: number | null, digits = 2): string {
  if (value === null) {
    return "暂无";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function trendClass(value: number | null): string {
  if (value === null || value === 0) {
    return "";
  }
  return value > 0 ? "text-red-600" : "text-green-700";
}

function formatAmount(value: number | null): string {
  if (value === null) {
    return "暂无";
  }
  if (Math.abs(value) >= 100_000_000) {
    return `${(value / 100_000_000).toFixed(2)} 亿`;
  }
  if (Math.abs(value) >= 10_000) {
    return `${(value / 10_000).toFixed(2)} 万`;
  }
  return value.toLocaleString("zh-CN");
}

/** 基金当日行情面板：场内实时或场外盘中估算。 */
export function FundIntradayPanel({ intraday, loading }: FundIntradayPanelProps) {
  if (loading) {
    return (
      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="py-12 text-center text-sm text-muted-foreground">
          当日行情加载中...
        </div>
      </section>
    );
  }

  if (!intraday) {
    return (
      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="py-12 text-center text-sm text-muted-foreground">
          暂无当日行情数据。
        </div>
      </section>
    );
  }

  const isEstimate = intraday.mode === "estimate";
  const headline = isEstimate ? intraday.estimated_nav : intraday.price;

  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">
            {isEstimate ? "盘中估算净值" : "当日实时行情"}
          </h2>
          <p className="text-xs text-muted-foreground">
            更新时间：{formatDateTime(intraday.ts)}，来源：
            {fundSourceLabel(intraday.source)}
          </p>
        </div>
        {isEstimate ? (
          <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
            估算值，非官方净值
          </span>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="text-xs text-muted-foreground">
            {isEstimate ? "估算净值" : "最新价"}
          </div>
          <div className="mt-1 text-2xl font-semibold">
            {headline === null ? "暂无" : headline.toFixed(4)}
          </div>
        </div>
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="text-xs text-muted-foreground">涨跌幅</div>
          <div className={`mt-1 text-2xl font-semibold ${trendClass(intraday.change_pct)}`}>
            {intraday.change_pct === null
              ? "暂无"
              : `${signed(intraday.change_pct)}%`}
          </div>
        </div>
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="text-xs text-muted-foreground">
            {isEstimate ? "官方净值" : "IOPV 实时估值"}
          </div>
          <div className="mt-1 text-2xl font-semibold">
            {isEstimate
              ? intraday.official_nav === null
                ? "暂无"
                : intraday.official_nav.toFixed(4)
              : intraday.iopv === null
                ? "暂无"
                : intraday.iopv.toFixed(4)}
          </div>
        </div>
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="text-xs text-muted-foreground">
            {isEstimate ? "官方净值日期" : "溢价率"}
          </div>
          <div className={`mt-1 text-2xl font-semibold ${trendClass(intraday.premium_rate)}`}>
            {isEstimate
              ? intraday.official_nav_date ?? "暂无"
              : intraday.premium_rate === null
                ? "暂无"
                : `${signed(intraday.premium_rate)}%`}
          </div>
        </div>
      </div>

      {!isEstimate ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">开盘</div>
            <div className="mt-1 font-semibold">
              {intraday.open === null ? "暂无" : intraday.open.toFixed(4)}
            </div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">最高</div>
            <div className="mt-1 font-semibold">
              {intraday.high === null ? "暂无" : intraday.high.toFixed(4)}
            </div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">最低</div>
            <div className="mt-1 font-semibold">
              {intraday.low === null ? "暂无" : intraday.low.toFixed(4)}
            </div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">成交额</div>
            <div className="mt-1 font-semibold">{formatAmount(intraday.amount)}</div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
