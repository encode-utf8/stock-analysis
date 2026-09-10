// 预警中心共享契约：只新增，供规则、事件、设置与判定引擎引用。
// 后续分支如需扩展，先在本文件新增字段并保持向后兼容。

/** 预警标的类型。 */
export type AlertTarget = "stock" | "fund";

/** 可配置的观测指标，均为初学者可直接理解的数值。 */
export type AlertMetric =
  | "change_pct"
  | "price"
  | "estimate_nav"
  | "estimate_change_pct"
  | "unit_nav"
  | "nav_change_pct"
  | "drawdown_pct"
  | "current_drawdown_pct";

/** 比较方向：大于等于 / 小于等于。 */
export type AlertOperator = "gte" | "lte";

/** 条件组合方式：全部满足 / 任一满足。 */
export type AlertLogic = "and" | "or";

export type AlertEventStatus = "unread" | "read";
export type AlertEmailStatus = "sent" | "skipped" | "failed";

/** 单个预警条件。 */
export interface AlertCondition {
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
}

/** 一个预警任务对应一个自选标的，支持 1-4 个条件的组合。 */
export interface AlertRule {
  id: string;
  target: AlertTarget;
  code: string;
  name: string;
  logic: AlertLogic;
  conditions: AlertCondition[];
  enabled: boolean;
  cooldown_hours: number;
  created_at: string;
  updated_at: string;
  last_triggered_at: string | null;
}

/** 某个标的某个指标在某一时刻的观测值。 */
export interface AlertObservation {
  metric: AlertMetric;
  value: number;
  source: string;
  observed_at: string;
}

/** 条件命中明细，用于事件回看与邮件摘要。 */
export interface AlertConditionHit {
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  value: number;
  matched: boolean;
}

/** 触发事件：固化当时的口径、观测值与推送结果。 */
export interface AlertEvent {
  id: string;
  rule_id: string;
  rule_label: string;
  target: AlertTarget;
  code: string;
  name: string;
  logic: AlertLogic;
  metrics: AlertMetric[];
  hits: AlertConditionHit[];
  data_source: string;
  observed_at: string;
  level: "info" | "warn";
  message: string;
  email_status: AlertEmailStatus;
  email_reason: string | null;
  status: AlertEventStatus;
  created_at: string;
}

/** 本地预警设置（单例）。 */
export interface AlertSettings {
  /** 本地预留的收件邮箱；为空表示未配置。 */
  email_to: string | null;
  /** 邮件推送开关。 */
  email_enabled: boolean;
  /** 由服务端根据 SMTP 环境变量判断，只读。 */
  email_configured: boolean;
  /** 可配置预警任务的标的数量上限。 */
  max_targets: number;
  updated_at: string;
}

/** 一次扫描的结果摘要，写入 job_runs 详情。 */
export interface AlertScanResult {
  scanned_targets: number;
  scanned_rules: number;
  triggered_count: number;
  skipped_count: number;
  skipped_reasons: string[];
  email_status: AlertEmailStatus;
  email_reason: string | null;
  /** 本次扫描使用的交易日历来源：akshare 或 weekday-fallback。 */
  trading_day_source: string;
  duration_ms: number;
}

/** 指标中文文案。 */
export const ALERT_METRIC_LABELS: Record<AlertMetric, string> = {
  change_pct: "当日涨跌幅",
  price: "最新价",
  estimate_nav: "盘中估算净值",
  estimate_change_pct: "盘中估算涨跌幅",
  unit_nav: "公布单位净值",
  nav_change_pct: "公布净值单日涨跌",
  drawdown_pct: "区间最大回撤",
  current_drawdown_pct: "当前回撤",
};

/** 指标单位后缀，用于拼接展示文案。 */
export const ALERT_METRIC_UNITS: Record<AlertMetric, string> = {
  change_pct: "%",
  price: "元",
  estimate_nav: "",
  estimate_change_pct: "%",
  unit_nav: "",
  nav_change_pct: "%",
  drawdown_pct: "%",
  current_drawdown_pct: "%",
};

/** 各标的类型可用的指标。 */
export const ALERT_TARGET_METRICS: Record<AlertTarget, AlertMetric[]> = {
  stock: ["change_pct", "price"],
  // 基金以盘中估算为主（盘中监控），公布净值与回撤作为辅助口径。
  fund: [
    "estimate_change_pct",
    "estimate_nav",
    "unit_nav",
    "nav_change_pct",
    "drawdown_pct",
    "current_drawdown_pct",
  ],
};

/** 比较方向中文文案。 */
export const ALERT_OPERATOR_LABELS: Record<AlertOperator, string> = {
  gte: "≥",
  lte: "≤",
};

/** 规则默认冷却小时数。 */
export const ALERT_DEFAULT_COOLDOWN_HOURS = 12;

/** 单个规则允许的条件数量范围。 */
export const ALERT_MIN_CONDITIONS = 1;
export const ALERT_MAX_CONDITIONS = 4;

/** 生成条件展示文案，例如“当日涨跌幅 ≤ -3%”。 */
export function formatAlertCondition(condition: AlertCondition): string {
  const unit = ALERT_METRIC_UNITS[condition.metric];
  return `${ALERT_METRIC_LABELS[condition.metric]} ${ALERT_OPERATOR_LABELS[condition.operator]} ${condition.threshold}${unit}`;
}

/** 生成规则展示文案，例如“当日涨跌幅 ≤ -3% 或 最新价 ≤ 10元”。 */
export function formatAlertRuleLabel(rule: Pick<AlertRule, "conditions" | "logic">): string {
  const joiner = rule.logic === "and" ? " 且 " : " 或 ";
  return rule.conditions.map(formatAlertCondition).join(joiner);
}