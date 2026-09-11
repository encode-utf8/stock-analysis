// 实时行情推送共享契约：只新增，不修改既有字段语义。
// 数据流为「服务端单例轮询器 → SSE → 浏览器」，非交易时段降频只推快照与心跳。

import type { AlertEvent, AlertTarget } from "./alerts";

/** 推送中的单条行情快照（只保留盯盘必需字段，减小推送体积）。 */
export interface QuoteStreamItem {
  code: string;
  /** 标的类型：股票与基金的观察指标口径不同，前端据此选择展示字段。 */
  target: AlertTarget;
  price: number;
  change_pct: number;
  prev_close: number;
  source: string;
  fetched_at: string;
}

/** 单个 SSE 连接订阅的标的集合；同一连接内标的类型一致。 */
export interface QuoteSubscription {
  codes: string[];
  target: AlertTarget;
}

/** 推送连接与轮询器状态。 */
export interface QuoteStreamStatus {
  connected_clients: number;
  subscribing_codes: number;
  interval_ms: number;
  market_closed: boolean;
  last_fetch_at: string | null;
  last_fetch_ok: boolean;
  upstream_source: string | null;
  consecutive_failures: number;
  degraded: boolean;
}

/** 服务端推送事件。 */
export type QuoteStreamEvent =
  | {
      type: "snapshot";
      server_time: string;
      target: AlertTarget;
      items: QuoteStreamItem[];
      market_closed: boolean;
      source: string;
      fetched_at: string;
      missing: string[];
    }
  | { type: "alert"; server_time: string; events: AlertEvent[] }
  | { type: "status"; server_time: string; status: QuoteStreamStatus }
  | { type: "heartbeat"; server_time: string };
