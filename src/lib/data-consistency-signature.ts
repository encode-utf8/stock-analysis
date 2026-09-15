// 内容指纹：把记录的关键字段归一化后序列化，用于判断本地与数据库是否为「同一数据但存在差异」。
// 单独成文件是为了让判定层与数据库适配层共用同一实现，同时避免二者互相 import 形成循环依赖。

/** 纯数字文本识别：数据库 numeric 列会以字符串返回（"396.47"），必须与本地 number 对齐。 */
const NUMERIC_TEXT = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * 归一化单个字段值：
 * - 数值统一到最多 4 位小数，避免浮点误差导致的假差异；
 * - 纯数字字符串转数字（数据库 numeric 列为字符串）；
 * - 字符串去掉首尾空白，空串等同于 null；
 * - 对象按键排序；所有字段归一化后都为 null 的空对象等同于 null；
 * - 数组逐项归一化。
 */
export function normalizeForSignature(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? Number(value.toFixed(4)) : null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    if (!NUMERIC_TEXT.test(trimmed)) {
      return trimmed;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? Number(parsed.toFixed(4)) : null;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeForSignature);
  }
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    let meaningful = false;
    for (const key of Object.keys(source).sort()) {
      const normalized = normalizeForSignature(source[key]);
      result[key] = normalized;
      if (normalized !== null) {
        meaningful = true;
      }
    }
    return meaningful ? result : null;
  }
  return null;
}

/** 生成内容指纹：参与比对的字段顺序必须与数据库适配层完全一致。 */
export function buildSignature(parts: unknown[]): string {
  return JSON.stringify(parts.map(normalizeForSignature));
}

/** 自选股内容指纹。 */
export function stockWatchlistSignature(
  code: unknown,
  name: unknown,
  exchange: unknown,
  group: unknown,
  sortOrder: unknown,
  note: unknown,
): string {
  return buildSignature([code, name, exchange, group, sortOrder, note]);
}

/** 自选基金内容指纹。 */
export function fundWatchlistSignature(
  code: unknown,
  name: unknown,
  type: unknown,
  tradingMode: unknown,
  group: unknown,
  sortOrder: unknown,
  note: unknown,
): string {
  return buildSignature([code, name, type, tradingMode, group, sortOrder, note]);
}

/** 个股持仓内容指纹。 */
export function stockHoldingSignature(
  code: unknown,
  name: unknown,
  amount: unknown,
  profit: unknown,
  note: unknown,
): string {
  return buildSignature([code, name, amount, profit, note]);
}

/** 持有基金内容指纹（含定投计划、校准基线、手动锚点）。 */
export function fundPositionSignature(
  code: unknown,
  name: unknown,
  amount: unknown,
  profit: unknown,
  profitCaliber: unknown,
  plan: unknown,
  calibration: unknown,
  manualAnchor: unknown,
  note: unknown,
): string {
  return buildSignature([
    code,
    name,
    amount,
    profit,
    profitCaliber,
    plan,
    calibration,
    manualAnchor,
    note,
  ]);
}

/** 预警规则内容指纹。 */
export function alertRuleSignature(
  target: unknown,
  code: unknown,
  name: unknown,
  logic: unknown,
  conditions: unknown,
  enabled: unknown,
  cooldownHours: unknown,
): string {
  return buildSignature([target, code, name, logic, conditions, enabled, cooldownHours]);
}

/** 预警事件内容指纹。 */
export function alertEventSignature(
  ruleId: unknown,
  target: unknown,
  code: unknown,
  name: unknown,
  logic: unknown,
  metrics: unknown,
  hits: unknown,
  dataSource: unknown,
  observedAt: unknown,
  level: unknown,
  message: unknown,
  status: unknown,
): string {
  return buildSignature([
    ruleId,
    target,
    code,
    name,
    logic,
    metrics,
    hits,
    dataSource,
    observedAt,
    level,
    message,
    status,
  ]);
}