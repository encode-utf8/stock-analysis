// 行情推送总线：进程内单例轮询器，合并所有 SSE 订阅者的代码后统一拉取并广播。
// 设计要点：
// 1. 订阅者共享一份拉取结果，上游请求数不随连接数放大；
// 2. 交易时段按 QUOTE_STREAM_INTERVAL_MS 推送，非交易时段降频并标注休市；
// 3. 连续失败指数退避，连接不中断，状态里标注降级；
// 4. 状态挂在 globalThis 上，避免 Next.js 开发模式热更新重复启动轮询。
import { FALLBACK_SOURCE, isTradingSession } from "@/lib/alerts";
import { persistAndNotifyAlertEvents } from "@/lib/alert-scan";
import { alertRepository } from "@/lib/alert-store";
import { fetchQuotesFromSidecar } from "@/lib/data-service";
import { getFundIntraday } from "@/lib/fund-intraday";
import { evaluateQuoteAlerts } from "@/lib/quote-scan";
import { getTradingCalendar } from "@/lib/trading-calendar";
import type {
  AlertEvent,
  AlertTarget,
  QuoteStreamEvent,
  QuoteStreamItem,
  QuoteStreamStatus,
  QuoteSubscription,
} from "@/lib/shared/types";

const DEFAULT_INTERVAL_MS = 5_000;
const MIN_INTERVAL_MS = 3_000;
const DEFAULT_IDLE_INTERVAL_MS = 60_000;
const MIN_IDLE_INTERVAL_MS = 10_000;
const DEFAULT_MAX_CODES = 50;
const MAX_BACKOFF_MS = 120_000;

/** 单个 SSE 连接的订阅记录。 */
interface QuoteBusSubscriber {
  id: number;
  subscription: QuoteSubscription;
  listener: (event: QuoteStreamEvent) => void;
  codes: Set<string>;
}

/** 轮询器的进程内状态。 */
interface QuoteBusState {
  subscribers: Map<number, QuoteBusSubscriber>;
  nextId: number;
  timer: ReturnType<typeof setTimeout> | null;
  ticking: boolean;
  lastItems: QuoteStreamItem[];
  lastSnapshotMeta: {
    fetched_at: string;
    source: string;
    missing: string[];
    market_closed: boolean;
  } | null;
  lastFetchAt: string | null;
  lastFetchOk: boolean;
  upstreamSource: string | null;
  consecutiveFailures: number;
  marketClosed: boolean;
}

/** 按类型合并后的订阅代码（已去重、已截断）。 */
export interface MergedSubscriptions {
  stock: string[];
  fund: string[];
}

interface SnapshotFetchResult {
  items: QuoteStreamItem[];
  missing: string[];
  source: string;
  fetched_at: string;
  ok: boolean;
}

const globalForQuoteBus = globalThis as typeof globalThis & {
  __stockAnalysisQuoteBus?: QuoteBusState;
};

function createState(): QuoteBusState {
  return {
    subscribers: new Map(),
    nextId: 1,
    timer: null,
    ticking: false,
    lastItems: [],
    lastSnapshotMeta: null,
    lastFetchAt: null,
    lastFetchOk: false,
    upstreamSource: null,
    consecutiveFailures: 0,
    marketClosed: false,
  };
}

function busState(): QuoteBusState {
  globalForQuoteBus.__stockAnalysisQuoteBus ??= createState();
  return globalForQuoteBus.__stockAnalysisQuoteBus;
}

/** 读取正整数环境变量，非法或过小时退回默认值并按下限收敛。 */
function envNumber(name: string, fallback: number, min: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(min, Math.floor(parsed));
}

/** 交易时段推送间隔（毫秒）。 */
export function activeIntervalMs(): number {
  return envNumber("QUOTE_STREAM_INTERVAL_MS", DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS);
}

/** 非交易时段保活间隔（毫秒）。 */
export function idleIntervalMs(): number {
  return envNumber("QUOTE_STREAM_IDLE_INTERVAL_MS", DEFAULT_IDLE_INTERVAL_MS, MIN_IDLE_INTERVAL_MS);
}

/** 单次批量拉取的代码上限。 */
export function maxStreamCodes(): number {
  return envNumber("QUOTE_STREAM_MAX_CODES", DEFAULT_MAX_CODES, 1);
}

/** 归一化代码列表：只保留 6 位数字、去重并截断。 */
export function normalizeCodes(codes: string[], maxCodes: number = maxStreamCodes()): string[] {
  const unique = new Set<string>();
  for (const code of codes) {
    const trimmed = code.trim();
    if (/^\d{6}$/.test(trimmed)) {
      unique.add(trimmed);
    }
    if (unique.size >= maxCodes) {
      break;
    }
  }
  return [...unique];
}

/**
 * 合并所有订阅者的代码集合（纯函数，便于单测）。
 * 同名代码按类型分别去重，保证「多订阅者只拉一次」。
 */
export function mergeSubscriptions(
  subscriptions: QuoteSubscription[],
  maxCodes: number = maxStreamCodes(),
): MergedSubscriptions {
  const stock = new Set<string>();
  const fund = new Set<string>();
  for (const subscription of subscriptions) {
    const bucket = subscription.target === "fund" ? fund : stock;
    for (const code of subscription.codes) {
      if (bucket.size >= maxCodes) {
        break;
      }
      if (/^\d{6}$/.test(code)) {
        bucket.add(code);
      }
    }
  }
  return { stock: [...stock], fund: [...fund] };
}

/** 计算下一次拉取间隔：休市降频，连续失败指数退避（纯函数，便于单测）。 */
export function computeNextIntervalMs(input: {
  marketClosed: boolean;
  consecutiveFailures: number;
}): number {
  const base = input.marketClosed ? idleIntervalMs() : activeIntervalMs();
  if (input.consecutiveFailures <= 0) {
    return base;
  }
  const factor = 2 ** Math.min(input.consecutiveFailures, 4);
  return Math.max(base, Math.min(base * factor, MAX_BACKOFF_MS));
}

/** 把基金盘中估算转成推送快照；降级数据与缺失价格返回 null。 */
async function loadFundItem(code: string): Promise<QuoteStreamItem | null> {
  try {
    const intraday = await getFundIntraday(code, false);
    if (intraday.source === FALLBACK_SOURCE) {
      return null;
    }
    const price = intraday.estimated_nav ?? intraday.price;
    const changePct = intraday.change_pct;
    if (price === null || changePct === null) {
      return null;
    }
    const prevClose = changePct === -100 ? price : price / (1 + changePct / 100);
    return {
      code,
      target: "fund",
      price: Number(price.toFixed(4)),
      change_pct: Number(changePct.toFixed(4)),
      prev_close: Number(prevClose.toFixed(4)),
      source: intraday.source,
      fetched_at: intraday.fetched_at,
    };
  } catch {
    return null;
  }
}

/** 按合并结果拉取一次快照：股票走侧车批量接口，基金走盘中估算。 */
async function fetchSnapshot(merged: MergedSubscriptions): Promise<SnapshotFetchResult> {
  const items: QuoteStreamItem[] = [];
  const missing: string[] = [];
  let source = "unknown";
  let fetchedAt = new Date().toISOString();
  let ok = false;

  if (merged.stock.length > 0) {
    const batch = await fetchQuotesFromSidecar(merged.stock);
    if (batch) {
      ok = true;
      source = batch.source;
      fetchedAt = batch.fetched_at;
      items.push(...batch.items);
      missing.push(...batch.missing);
    } else {
      missing.push(...merged.stock);
    }
  }

  if (merged.fund.length > 0) {
    const fundItems = await Promise.all(merged.fund.map((code) => loadFundItem(code)));
    fundItems.forEach((item, index) => {
      if (item) {
        ok = true;
        source = item.source;
        items.push(item);
      } else {
        missing.push(merged.fund[index]);
      }
    });
  }

  return { items, missing: [...new Set(missing)], source, fetched_at: fetchedAt, ok };
}

/** 按单个订阅者过滤快照；没有可推送内容时返回 null。 */
function snapshotFor(
  state: QuoteBusState,
  target: AlertTarget,
  codes: Set<string>,
): QuoteStreamEvent | null {
  const meta = state.lastSnapshotMeta;
  if (!meta || state.lastItems.length === 0) {
    return null;
  }
  const items = state.lastItems.filter((item) => item.target === target && codes.has(item.code));
  if (items.length === 0) {
    return null;
  }
  return {
    type: "snapshot",
    server_time: new Date().toISOString(),
    target,
    items,
    market_closed: meta.market_closed,
    source: meta.source,
    fetched_at: meta.fetched_at,
    missing: meta.missing.filter((code) => codes.has(code)),
  };
}

function buildStatus(state: QuoteBusState): QuoteStreamStatus {
  const merged = mergeSubscriptions(
    [...state.subscribers.values()].map((subscriber) => subscriber.subscription),
    maxStreamCodes(),
  );
  return {
    connected_clients: state.subscribers.size,
    subscribing_codes: merged.stock.length + merged.fund.length,
    interval_ms: computeNextIntervalMs({
      marketClosed: state.marketClosed,
      consecutiveFailures: state.consecutiveFailures,
    }),
    market_closed: state.marketClosed,
    last_fetch_at: state.lastFetchAt,
    last_fetch_ok: state.lastFetchOk,
    upstream_source: state.upstreamSource,
    consecutive_failures: state.consecutiveFailures,
    degraded: state.consecutiveFailures > 0,
  };
}

function safeSend(subscriber: QuoteBusSubscriber, event: QuoteStreamEvent): void {
  try {
    subscriber.listener(event);
  } catch (error) {
    console.warn("[quote-bus] 订阅者回调失败：", error);
  }
}

function broadcast(
  state: QuoteBusState,
  build: (subscriber: QuoteBusSubscriber) => QuoteStreamEvent | null,
): void {
  for (const subscriber of state.subscribers.values()) {
    const event = build(subscriber);
    if (event) {
      safeSend(subscriber, event);
    }
  }
}

/** 执行一次「拉取 → 广播 → 判定预警」，返回下一次调度间隔。 */
async function executeTick(state: QuoteBusState): Promise<number> {
  const merged = mergeSubscriptions(
    [...state.subscribers.values()].map((subscriber) => subscriber.subscription),
    maxStreamCodes(),
  );
  const now = new Date();
  const calendar = await getTradingCalendar();
  const session = isTradingSession("stock", now, calendar);
  state.marketClosed = !session.active;

  let result: SnapshotFetchResult;
  if (state.marketClosed && state.lastItems.length > 0 && state.lastSnapshotMeta) {
    // 休市不重复打上游：回放最近一次快照并标注休市，减少上游压力。
    result = {
      items: state.lastItems,
      missing: state.lastSnapshotMeta.missing,
      source: state.lastSnapshotMeta.source,
      fetched_at: state.lastSnapshotMeta.fetched_at,
      ok: state.lastFetchOk,
    };
  } else {
    result = await fetchSnapshot(merged);
  }

  state.lastItems = result.items;
  state.lastFetchAt = result.fetched_at;
  state.lastFetchOk = result.ok;
  state.upstreamSource = result.source;
  state.lastSnapshotMeta = {
    fetched_at: result.fetched_at,
    source: result.source,
    missing: result.missing,
    market_closed: state.marketClosed,
  };
  state.consecutiveFailures = result.ok ? 0 : state.consecutiveFailures + 1;

  broadcast(state, (subscriber) =>
    snapshotFor(state, subscriber.subscription.target, subscriber.codes),
  );

  const status = buildStatus(state);
  broadcast(state, () => ({ type: "status", server_time: now.toISOString(), status }));

  if (!result.ok) {
    // 拉取失败也要给连接一个保活信号，前端据此显示降级并继续等待恢复。
    broadcast(state, () => ({ type: "heartbeat", server_time: now.toISOString() }));
  } else if (session.active && result.items.length > 0) {
    await evaluateAndPushAlerts(state, result.items, now, calendar);
  }

  return computeNextIntervalMs({
    marketClosed: state.marketClosed,
    consecutiveFailures: state.consecutiveFailures,
  });
}

/** 对本次快照做实时预警判定，命中即刻落库、发邮件并推给相关订阅者。 */
async function evaluateAndPushAlerts(
  state: QuoteBusState,
  items: QuoteStreamItem[],
  now: Date,
  calendar: Awaited<ReturnType<typeof getTradingCalendar>>,
): Promise<void> {
  try {
    const rules = await alertRepository.listRules();
    const scan = evaluateQuoteAlerts({ items, rules, now, calendar });
    if (scan.events.length === 0) {
      return;
    }
    await persistAndNotifyAlertEvents(scan.events, scan.triggered_rule_ids, now);
    broadcast(state, (subscriber) => {
      const relevant = scan.events.filter(
        (event) =>
          event.target === subscriber.subscription.target && subscriber.codes.has(event.code),
      );
      if (relevant.length === 0) {
        return null;
      }
      return { type: "alert", server_time: now.toISOString(), events: relevant as AlertEvent[] };
    });
  } catch (error) {
    console.warn("[quote-bus] 实时预警判定失败：", error);
  }
}

function schedule(state: QuoteBusState, delayMs: number): void {
  if (state.timer) {
    clearTimeout(state.timer);
  }
  state.timer = setTimeout(() => {
    state.timer = null;
    void runTick();
  }, delayMs);
}

async function runTick(): Promise<void> {
  const state = busState();
  if (state.subscribers.size === 0 || state.ticking) {
    return;
  }
  state.ticking = true;
  let delay = activeIntervalMs();
  try {
    delay = await executeTick(state);
  } catch (error) {
    console.warn("[quote-bus] 轮询异常：", error);
    state.consecutiveFailures += 1;
    delay = computeNextIntervalMs({
      marketClosed: state.marketClosed,
      consecutiveFailures: state.consecutiveFailures,
    });
  } finally {
    state.ticking = false;
  }
  if (state.subscribers.size > 0) {
    schedule(state, delay);
  }
}

function ensureRunning(state: QuoteBusState): void {
  if (state.timer || state.ticking) {
    return;
  }
  schedule(state, 0);
}

/**
 * 注册一个行情订阅者，返回取消订阅函数。
 * 注册时立即回放最近一次快照，前端无需等待下一个 tick。
 */
export function subscribeQuotes(
  subscription: QuoteSubscription,
  listener: (event: QuoteStreamEvent) => void,
): () => void {
  const state = busState();
  const codes = normalizeCodes(subscription.codes);
  if (codes.length === 0) {
    return () => {};
  }
  const subscriber: QuoteBusSubscriber = {
    id: state.nextId++,
    subscription: { codes, target: subscription.target },
    listener,
    codes: new Set(codes),
  };
  state.subscribers.set(subscriber.id, subscriber);

  const replay = snapshotFor(state, subscriber.subscription.target, subscriber.codes);
  if (replay) {
    safeSend(subscriber, replay);
  }
  ensureRunning(state);

  return () => {
    state.subscribers.delete(subscriber.id);
    if (state.subscribers.size === 0 && state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  };
}

/** 读取轮询器状态，供 /api/stream/status 与前端指示灯使用。 */
export function getQuoteBusStatus(): QuoteStreamStatus {
  return buildStatus(busState());
}

/** 回放最近一次快照，供 SSE 建连时立即出数。 */
export function getLastQuoteSnapshot(subscription: QuoteSubscription): QuoteStreamEvent | null {
  const state = busState();
  return snapshotFor(state, subscription.target, new Set(normalizeCodes(subscription.codes)));
}

/** 仅测试使用：清空订阅与定时器，避免用例之间互相污染。 */
export function __resetQuoteBusForTests(): void {
  const state = busState();
  if (state.timer) {
    clearTimeout(state.timer);
  }
  globalForQuoteBus.__stockAnalysisQuoteBus = createState();
}
