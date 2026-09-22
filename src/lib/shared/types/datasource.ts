// 数据源可用性契约：官方来源判定、降级快照标注与统一提示文案。
// 该模块同时被服务端与浏览器端引用，因此只放纯常量与纯函数。

/** 数据源故障时面向用户的统一提示。 */
export const DATA_SOURCE_UNAVAILABLE_MESSAGE = "当前数据源故障，请稍后再试。";

/** 数据源故障后触发按钮的冷却时长（毫秒）。 */
export const DATA_SOURCE_RETRY_AFTER_MS = 10_000;

/** 官方可靠来源标识：真实上游数据，可作为降级快照复用。 */
export const OFFICIAL_DATA_SOURCES = [
  "akshare",
  "tencent",
  "sina",
  "legulegu",
  "ths",
  "eastmoney",
  "xueqiu",
  "cninfo",
] as const;

/** 合成演示数据标识：一律按数据源故障处理，不作为快照复用。 */
export const SYNTHETIC_DATA_SOURCE = "deterministic-fallback";

/** 降级快照标注：侧车不可用时回退到本地官方快照的附加信息。 */
export interface DegradedSnapshotInfo {
  /** 固定为 true，便于前端判定。 */
  degraded: true;
  /** 降级原因，当前仅数据源不可用。 */
  reason: "datasource-unavailable";
  /** 本次降级判定时刻。 */
  degraded_at: string;
  /** 提示文案，供界面直接展示。 */
  message: string;
}

/** 判断来源标识是否为官方可靠来源。 */
export function isOfficialDataSource(source: string | null | undefined): boolean {
  if (typeof source !== "string") {
    return false;
  }
  const normalized = source.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }
  return (OFFICIAL_DATA_SOURCES as readonly string[]).includes(normalized);
}

/** 判断来源标识是否为合成演示数据（确定性降级或演示资讯）。 */
export function isSyntheticDataSource(source: string | null | undefined): boolean {
  if (typeof source !== "string") {
    return false;
  }
  const trimmed = source.trim();
  const normalized = trimmed.toLowerCase();
  return (
    normalized === SYNTHETIC_DATA_SOURCE ||
    normalized.startsWith("demo") ||
    trimmed.startsWith("演示")
  );
}

/** 判断单条记录是否可作为官方快照复用。 */
export function isUsableSnapshotRecord(
  record: { source?: string | null } | null | undefined,
): boolean {
  return Boolean(record && isOfficialDataSource(record.source));
}