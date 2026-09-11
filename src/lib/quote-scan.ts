// 实时行情预警判定：把推送快照转成观测值，复用既有规则引擎做增量判定。
// 只覆盖快照真实携带的指标（股票：最新价/当日涨跌幅；基金：盘中估算净值/涨跌幅），
// 单位净值、区间回撤等需要历史数据的指标仍由 30 分钟定时扫描兜底。
import {
  buildAlertEvent,
  evaluateAlertRule,
  isTradingSession,
  type TradingCalendarLike,
} from "@/lib/alerts";
import type {
  AlertEvent,
  AlertObservation,
  AlertRule,
  QuoteStreamItem,
} from "@/lib/shared/types";

export interface QuoteAlertScanInput {
  items: QuoteStreamItem[];
  rules: AlertRule[];
  now: Date;
  calendar: TradingCalendarLike;
}

export interface QuoteAlertScanResult {
  events: AlertEvent[];
  triggered_rule_ids: string[];
  skipped_reasons: string[];
}

/** 生成本次判定使用的标的键，避免股票与基金代码相同导致串号。 */
export function quoteItemKey(item: Pick<QuoteStreamItem, "target" | "code">): string {
  return `${item.target}:${item.code}`;
}

/**
 * 把单条快照转成观测值。
 * 只返回快照能提供的指标，缺少的指标由判定引擎按「缺少指标观测值」跳过。
 */
export function toQuoteObservations(item: QuoteStreamItem): AlertObservation[] {
  if (item.target === "stock") {
    return [
      {
        metric: "change_pct",
        value: item.change_pct,
        source: item.source,
        observed_at: item.fetched_at,
      },
      { metric: "price", value: item.price, source: item.source, observed_at: item.fetched_at },
    ];
  }

  // 基金盘中口径：估算涨跌幅沿用快照涨跌幅，估算净值取快照价格字段。
  return [
    {
      metric: "estimate_change_pct",
      value: item.change_pct,
      source: item.source,
      observed_at: item.fetched_at,
    },
    {
      metric: "estimate_nav",
      value: item.price,
      source: item.source,
      observed_at: item.fetched_at,
    },
  ];
}

function pushReason(reasons: string[], reason: string): void {
  if (reason && !reasons.includes(reason)) {
    reasons.push(reason);
  }
}

/**
 * 对一批快照执行实时预警判定。
 * 判定顺序与定时扫描保持一致（时段 → 指标 → 降级 → 冷却 → 阈值），冷却由规则引擎负责，
 * 因此同一规则在冷却期内不会因为秒级推送而重复触发。
 */
export function evaluateQuoteAlerts(input: QuoteAlertScanInput): QuoteAlertScanResult {
  const { items, rules, now, calendar } = input;
  const events: AlertEvent[] = [];
  const triggeredRuleIds: string[] = [];
  const skippedReasons: string[] = [];

  const byKey = new Map<string, QuoteStreamItem>();
  for (const item of items) {
    byKey.set(quoteItemKey(item), item);
  }

  const seen = new Set<string>();
  for (const rule of rules) {
    if (!rule.enabled || seen.has(rule.id)) {
      continue;
    }

    const item = byKey.get(`${rule.target}:${rule.code}`);
    if (!item) {
      // 规则标的未被本次订阅覆盖时不参与判定，避免为一条规则额外拉取上游数据。
      continue;
    }
    seen.add(rule.id);

    const session = isTradingSession(rule.target, now, calendar);
    if (!session.active) {
      pushReason(skippedReasons, session.reason);
      continue;
    }

    const observations = toQuoteObservations(item);
    const decision = evaluateAlertRule(rule, observations, now, calendar);
    if (decision.triggered) {
      events.push(buildAlertEvent(rule, decision, observations, now));
      triggeredRuleIds.push(rule.id);
    } else {
      pushReason(skippedReasons, decision.reason);
    }
  }

  return { events, triggered_rule_ids: triggeredRuleIds, skipped_reasons: skippedReasons };
}
