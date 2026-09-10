// 预警判定引擎：交易日历、有效时段、条件组合、冷却期与降级过滤。
// 本模块只包含纯函数，便于单测覆盖各种边界口径。

import { beijingDateKey, type TradingCalendar } from "@/lib/trading-calendar";
import {
  ALERT_DEFAULT_COOLDOWN_HOURS,
  ALERT_MAX_CONDITIONS,
  ALERT_METRIC_LABELS,
  ALERT_MIN_CONDITIONS,
  ALERT_TARGET_METRICS,
  formatAlertRuleLabel,
} from "@/lib/shared/types";
import type {
  AlertCondition,
  AlertConditionHit,
  AlertEvent,
  AlertLogic,
  AlertMetric,
  AlertObservation,
  AlertRule,
  AlertTarget,
} from "@/lib/shared/types";

/** 北京时间相对 UTC 的固定偏移（无夏令时）。 */
const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 确定性降级数据来源标识：不参与预警判定。 */
export const FALLBACK_SOURCE = "deterministic-fallback";

/** 股票交易时段（自当日 00:00 起算的分钟数）。 */
const STOCK_SESSIONS: Array<[number, number]> = [
  [9 * 60 + 30, 11 * 60 + 30],
  [13 * 60, 15 * 60],
];

/** 判定引擎只依赖 isTradingDay，便于单测注入假日历。 */
export type TradingCalendarLike = Pick<TradingCalendar, "isTradingDay">;

/** 有效时段判定结果。 */
export interface TradingSessionState {
  active: boolean;
  reason: string;
}

/** 判定结果。 */
export interface AlertDecision {
  triggered: boolean;
  reason: string;
  matched: "all" | "any" | null;
  hits: AlertConditionHit[];
}

/**
 * 按北京时间判断当前是否处于该标的的有效评估时段。
 * 传入交易日历时按日历判定交易日（可识别法定节假日）；未传入时退回工作日近似。
 * 基金只盯盘中：场外估算与场内实时价都只在交易时段更新，盘后触发没有盯盘意义。
 */
export function isTradingSession(
  target: AlertTarget,
  now: Date,
  calendar?: TradingCalendarLike,
): TradingSessionState {
  const shifted = new Date(now.getTime() + CHINA_OFFSET_MS);
  const weekday = shifted.getUTCDay();
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();

  const isTradingDay = calendar
    ? calendar.isTradingDay(beijingDateKey(now))
    : weekday >= 1 && weekday <= 5;
  if (!isTradingDay) {
    return { active: false, reason: "非交易日，不触发预警" };
  }

  const inStockSession = STOCK_SESSIONS.some(
    ([start, end]) => minutes >= start && minutes <= end,
  );

  if (target === "stock") {
    return inStockSession
      ? { active: true, reason: "股票交易时段" }
      : { active: false, reason: "非股票交易时段（09:30-11:30、13:00-15:00）" };
  }

  return inStockSession
    ? { active: true, reason: "基金盘中估算时段" }
    : { active: false, reason: "非盘中时段（09:30-11:30、13:00-15:00）" };
}

/** 判断冷却期是否已过；默认 12 小时。 */
export function isCooldownPassed(rule: AlertRule, now: Date): boolean {
  if (!rule.last_triggered_at) {
    return true;
  }
  const last = new Date(rule.last_triggered_at).getTime();
  if (!Number.isFinite(last)) {
    return true;
  }
  const hours =
    Number.isFinite(rule.cooldown_hours) && rule.cooldown_hours > 0
      ? rule.cooldown_hours
      : ALERT_DEFAULT_COOLDOWN_HOURS;
  return now.getTime() - last >= hours * 60 * 60 * 1000;
}

/** 比较单个条件是否命中（含等于阈值的边界）。 */
export function compareAlertCondition(condition: AlertCondition, value: number): boolean {
  return condition.operator === "gte" ? value >= condition.threshold : value <= condition.threshold;
}

/** 校验规则条件配置；合法时返回 ok。 */
export function validateAlertRuleInput(input: {
  target: AlertTarget;
  logic: AlertLogic;
  conditions: AlertCondition[];
}): { ok: true } | { ok: false; error: string } {
  if (input.logic !== "and" && input.logic !== "or") {
    return { ok: false, error: "条件组合方式只支持全部满足或任一满足。" };
  }
  if (
    input.conditions.length < ALERT_MIN_CONDITIONS ||
    input.conditions.length > ALERT_MAX_CONDITIONS
  ) {
    return {
      ok: false,
      error: `每个预警任务需要 ${ALERT_MIN_CONDITIONS}-${ALERT_MAX_CONDITIONS} 个条件。`,
    };
  }
  const allowed = ALERT_TARGET_METRICS[input.target];
  for (const condition of input.conditions) {
    if (!allowed.includes(condition.metric)) {
      return { ok: false, error: `${ALERT_METRIC_LABELS[condition.metric]} 不支持该自选标的类型。` };
    }
    if (condition.operator !== "gte" && condition.operator !== "lte") {
      return { ok: false, error: "比较方向只支持大于等于或小于等于。" };
    }
    if (!Number.isFinite(condition.threshold)) {
      return { ok: false, error: "阈值必须是有效数字。" };
    }
  }
  return { ok: true };
}

/**
 * 判定规则是否触发。
 * 判定顺序：停用 → 缺条件 → 非有效时段 → 指标缺失 → 降级数据 → 冷却期 → 阈值比较。
 */
export function evaluateAlertRule(
  rule: AlertRule,
  observations: AlertObservation[],
  now: Date = new Date(),
  calendar?: TradingCalendarLike,
): AlertDecision {
  if (!rule.enabled) {
    return { triggered: false, reason: "规则已停用", matched: null, hits: [] };
  }
  if (rule.conditions.length === 0) {
    return { triggered: false, reason: "规则未配置条件", matched: null, hits: [] };
  }

  const session = isTradingSession(rule.target, now, calendar);
  if (!session.active) {
    return { triggered: false, reason: session.reason, matched: null, hits: [] };
  }

  const byMetric = new Map<AlertMetric, AlertObservation>();
  for (const observation of observations) {
    byMetric.set(observation.metric, observation);
  }

  const missing = rule.conditions.filter((condition) => !byMetric.has(condition.metric));
  if (missing.length > 0) {
    const names = missing.map((condition) => ALERT_METRIC_LABELS[condition.metric]).join("、");
    return { triggered: false, reason: `缺少指标观测值：${names}`, matched: null, hits: [] };
  }

  // 只检查条件实际引用的指标：未引用的降级数据不应影响本次判定。
  const usedObservations = rule.conditions.map((condition) => byMetric.get(condition.metric)!);
  if (usedObservations.some((observation) => observation.source === FALLBACK_SOURCE)) {
    return { triggered: false, reason: "观测值来自确定性降级数据，已跳过", matched: null, hits: [] };
  }

  if (!isCooldownPassed(rule, now)) {
    const hours =
      Number.isFinite(rule.cooldown_hours) && rule.cooldown_hours > 0
        ? rule.cooldown_hours
        : ALERT_DEFAULT_COOLDOWN_HOURS;
    return { triggered: false, reason: `处于 ${hours} 小时冷却期内`, matched: null, hits: [] };
  }

  const hits: AlertConditionHit[] = rule.conditions.map((condition) => {
    const observation = byMetric.get(condition.metric)!;
    return {
      metric: condition.metric,
      operator: condition.operator,
      threshold: condition.threshold,
      value: observation.value,
      matched: compareAlertCondition(condition, observation.value),
    };
  });

  const matched =
    rule.logic === "and"
      ? hits.every((hit) => hit.matched)
      : hits.some((hit) => hit.matched);

  if (!matched) {
    return { triggered: false, reason: "未达到触发条件", matched: null, hits };
  }

  return { triggered: true, reason: "触发", matched: rule.logic === "and" ? "all" : "any", hits };
}

/** 生成触发文案，用于事件列表与邮件。 */
export function buildAlertMessage(rule: AlertRule, decision: AlertDecision): string {
  const values = decision.hits
    .map((hit) => `${ALERT_METRIC_LABELS[hit.metric]} ${hit.value}`)
    .join("、");
  return `${rule.code} ${rule.name} 触发预警：${formatAlertRuleLabel(rule)}（当前 ${values}）`;
}

/** 由判定结果构造事件记录。 */
export function buildAlertEvent(
  rule: AlertRule,
  decision: AlertDecision,
  observations: AlertObservation[],
  now: Date = new Date(),
): AlertEvent {
  const observedAt = observations[0]?.observed_at ?? now.toISOString();
  const source = observations[0]?.source ?? "unknown";
  return {
    id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    rule_id: rule.id,
    rule_label: formatAlertRuleLabel(rule),
    target: rule.target,
    code: rule.code,
    name: rule.name,
    logic: rule.logic,
    metrics: rule.conditions.map((condition) => condition.metric),
    hits: decision.hits,
    data_source: source,
    observed_at: observedAt,
    level: "warn",
    message: buildAlertMessage(rule, decision),
    email_status: "skipped",
    email_reason: "未配置邮件推送",
    status: "unread",
    created_at: now.toISOString(),
  };
}