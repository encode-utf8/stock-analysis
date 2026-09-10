// 预警请求体解析：把不可信 JSON 归一化为可判定的输入。
// 只做结构与类型校验；自选池校验与数量上限属于路由层业务规则。
import {
  ALERT_DEFAULT_COOLDOWN_HOURS,
  ALERT_MAX_CONDITIONS,
  ALERT_METRIC_LABELS,
  ALERT_MIN_CONDITIONS,
} from "@/lib/shared/types";
import type {
  AlertCondition,
  AlertLogic,
  AlertMetric,
  AlertOperator,
  AlertTarget,
} from "@/lib/shared/types";

/** 解析标的类型；非法时返回 null。 */
export function parseAlertTarget(value: unknown): AlertTarget | null {
  return value === "stock" || value === "fund" ? value : null;
}

/** 解析条件组合方式；非法时返回 null。 */
export function parseAlertLogic(value: unknown): AlertLogic | null {
  return value === "and" || value === "or" ? value : null;
}

/** 条件数组解析结果。 */
export type AlertConditionParseResult =
  | { ok: true; conditions: AlertCondition[] }
  | { ok: false; error: string };

/** 解析条件数组：校验数量、指标、比较方向与阈值。 */
export function parseAlertConditions(value: unknown): AlertConditionParseResult {
  if (!Array.isArray(value)) {
    return { ok: false, error: "conditions 必须是数组。" };
  }
  if (value.length < ALERT_MIN_CONDITIONS || value.length > ALERT_MAX_CONDITIONS) {
    return {
      ok: false,
      error: `每个预警任务需要 ${ALERT_MIN_CONDITIONS}-${ALERT_MAX_CONDITIONS} 个条件。`,
    };
  }

  const conditions: AlertCondition[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      return { ok: false, error: "每个条件必须是对象。" };
    }
    const record = item as Record<string, unknown>;
    const metric = record.metric;
    const operator = record.operator;
    const threshold = record.threshold;

    if (typeof metric !== "string" || !(metric in ALERT_METRIC_LABELS)) {
      return { ok: false, error: "条件指标不受支持。" };
    }
    if (operator !== "gte" && operator !== "lte") {
      return { ok: false, error: "比较方向只支持大于等于或小于等于。" };
    }
    if (typeof threshold !== "number" && typeof threshold !== "string") {
      return { ok: false, error: "阈值必须是有效数字。" };
    }
    const numeric = typeof threshold === "number" ? threshold : Number(threshold.trim());
    if (!Number.isFinite(numeric)) {
      return { ok: false, error: "阈值必须是有效数字。" };
    }

    conditions.push({
      metric: metric as AlertMetric,
      operator: operator as AlertOperator,
      threshold: numeric,
    });
  }

  return { ok: true, conditions };
}

/** 解析冷却小时数；缺省或非法时回落默认 12 小时。 */
export function parseCooldownHours(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return ALERT_DEFAULT_COOLDOWN_HOURS;
  }
  const numeric = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(numeric) && numeric > 0 ? numeric : ALERT_DEFAULT_COOLDOWN_HOURS;
}

/** 生成预警规则 ID。 */
export function createAlertRuleId(): string {
  return `alert-rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}