// 数据源可用性服务端辅助：统一错误类型、降级快照标注与故障响应体。
// 约定：任何面向用户的实时 / 最新数据读取，都不允许把合成演示数据当作正常结果返回。
import {
  DATA_SOURCE_RETRY_AFTER_MS,
  DATA_SOURCE_UNAVAILABLE_MESSAGE,
  isOfficialDataSource,
  type DegradedSnapshotInfo,
} from "@/lib/shared/types";

/** 数据源不可用（侧车不可达、上游不可用或仅有合成数据）时抛出的专用错误。 */
export class DataSourceUnavailableError extends Error {
  /** 出错的功能名称，用于日志与界面提示定位。 */
  readonly feature: string;
  /** 建议的重试冷却时长（毫秒）。 */
  readonly retryAfterMs: number;

  constructor(feature: string, retryAfterMs: number = DATA_SOURCE_RETRY_AFTER_MS) {
    super(DATA_SOURCE_UNAVAILABLE_MESSAGE);
    this.name = "DataSourceUnavailableError";
    this.feature = feature;
    this.retryAfterMs = retryAfterMs;
  }
}

/** 判断错误是否为数据源不可用。 */
export function isDataSourceUnavailableError(
  error: unknown,
): error is DataSourceUnavailableError {
  return error instanceof DataSourceUnavailableError;
}

/** 为官方快照补充降级标注；返回新对象，不修改入参。 */
export function markDegradedSnapshot<T extends object>(
  record: T,
  degradedAt: Date = new Date(),
): T & { degraded_snapshot: DegradedSnapshotInfo } {
  return {
    ...record,
    degraded_snapshot: {
      degraded: true,
      reason: "datasource-unavailable",
      degraded_at: degradedAt.toISOString(),
      message: DATA_SOURCE_UNAVAILABLE_MESSAGE,
    },
  };
}

/** 判断记录自身是否已经带降级标注，避免重复叠加。 */
export function hasDegradedSnapshot(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      "degraded_snapshot" in value &&
      (value as { degraded_snapshot?: DegradedSnapshotInfo }).degraded_snapshot?.degraded,
  );
}

/** 过滤出官方来源记录；用于在侧车不可用时挑选可复用的快照。 */
export function officialRecords<T extends { source?: string | null }>(records: T[]): T[] {
  return records.filter((record) => isOfficialDataSource(record.source));
}

/** 数据源故障的统一响应体（接口层与 SSE 事件共用）。 */
export interface DataSourceFailurePayload {
  code: "SERVICE_UNAVAILABLE";
  message: string;
  details: {
    retry_after_ms: number;
    feature: string;
  };
}

/** 把数据源错误转换为响应体。 */
export function buildDataSourceFailurePayload(
  error: DataSourceUnavailableError,
): DataSourceFailurePayload {
  return {
    code: "SERVICE_UNAVAILABLE",
    message: error.message || DATA_SOURCE_UNAVAILABLE_MESSAGE,
    details: {
      retry_after_ms: error.retryAfterMs,
      feature: error.feature,
    },
  };
}