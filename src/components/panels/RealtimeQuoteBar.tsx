"use client";

import { useRealtimeQuotes } from "@/lib/realtime-quote-client";
import { formatDateTime } from "@/lib/format";

import type { AlertTarget, QuoteStreamItem } from "@/lib/shared/types";

interface RealtimeQuoteBarProps {
  /** 当前工作台的标的类型：个股工作台传 stock，基金工作台传 fund。 */
  target: AlertTarget;
}

const CONNECTION_LABELS: Record<string, string> = {
  off: "未开启",
  connecting: "连接中",
  connected: "已连接",
  degraded: "降级重连中",
};

const CONNECTION_DOTS: Record<string, string> = {
  off: "bg-slate-300",
  connecting: "bg-amber-400",
  connected: "bg-green-500",
  degraded: "bg-red-500",
};

/** 涨跌颜色：A 股口径红涨绿跌。 */
function changeClass(value: number): string {
  if (value > 0) return "text-red-600";
  if (value < 0) return "text-green-600";
  return "text-muted-foreground";
}

function formatNumber(value: number, digits = 2): string {
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * 实时行情条：展示自选池快照、连接状态与开关。
 * 开关默认关闭；提示音与浏览器通知分别由本组件与预警面板消费同一份状态。
 */
export function RealtimeQuoteBar({ target }: RealtimeQuoteBarProps) {
  const {
    enabled,
    soundEnabled,
    connection,
    items,
    watchlists,
    status,
    lastUpdatedAt,
    missing,
    marketClosed,
    setEnabled,
    setSoundEnabled,
    reconnect,
  } = useRealtimeQuotes();

  const byKey = new Map<string, QuoteStreamItem>();
  for (const item of items) {
    byKey.set(`${item.target}:${item.code}`, item);
  }
  const options = watchlists[target];
  const unitLabel = target === "fund" ? "估算净值" : "最新价";

  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold">实时行情（{target === "stock" ? "个股" : "基金"}自选池）</h2>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`inline-block h-2 w-2 rounded-full ${CONNECTION_DOTS[connection]}`} />
            {CONNECTION_LABELS[connection]}
          </span>
          {enabled ? (
            <span className="text-xs text-muted-foreground">
              更新：{lastUpdatedAt ? formatDateTime(lastUpdatedAt) : "等待首个快照"}
            </span>
          ) : null}
          {enabled && marketClosed ? (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">休市</span>
          ) : null}
          {status?.degraded ? (
            <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">
              上游不可用，已退避重试
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            开启实时
          </label>
          <label className="flex items-center gap-1.5 text-muted-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={soundEnabled}
              disabled={!enabled}
              onChange={(event) => setSoundEnabled(event.target.checked)}
            />
            提示音
          </label>
          <button
            type="button"
            className="rounded border px-2 py-1 hover:bg-accent disabled:opacity-40"
            disabled={!enabled}
            onClick={reconnect}
          >
            重连
          </button>
        </div>
      </div>

      {!enabled ? (
        <p className="mt-3 text-xs text-muted-foreground">
          开启后按秒级推送自选池行情，并让预警在盘中即时提醒；默认关闭以节省上游请求。
        </p>
      ) : options.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          当前自选池为空，先在左侧加入 1-2 只{target === "stock" ? "股票" : "基金"}再开启实时。
        </p>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {options.map((option) => {
            const item = byKey.get(`${target}:${option.code}`);
            const isMissing = missing.includes(option.code);
            return (
              <div
                key={option.code}
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{option.name || option.code}</p>
                  <p className="text-xs text-muted-foreground">
                    {option.code}
                    {item ? " · 实时" : isMissing ? " · 无数据" : " · 等待数据"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-medium">
                    {item ? formatNumber(item.price, target === "fund" ? 4 : 2) : "—"}
                  </p>
                  <p className={`text-xs ${item ? changeClass(item.change_pct) : "text-muted-foreground"}`}>
                    {item ? `${item.change_pct > 0 ? "+" : ""}${formatNumber(item.change_pct)}%` : "—"}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        口径：{unitLabel}来自行情侧车快照（基金为盘中估算），非交易所正式成交价，存在延迟，仅用于学习与观察。
      </p>
    </section>
  );
}
