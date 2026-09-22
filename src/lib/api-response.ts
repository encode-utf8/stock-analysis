import { NextResponse } from "next/server";

import { buildDataSourceFailurePayload, isDataSourceUnavailableError } from "@/lib/datasource";
import type {
  ApiErrorCode,
  ApiError,
  ApiResponse,
  ApiSuccess,
} from "@/lib/shared/types";

/** 构造统一成功响应。 */
export function apiOk<T>(data: T, init?: ResponseInit): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ success: true, data }, init);
}

/** 构造统一错误响应。 */
export function apiFail(
  code: ApiErrorCode,
  message: string,
  status = 500,
  details?: unknown,
): NextResponse<ApiError> {
  return NextResponse.json(
    { success: false, error: { code, message, details } },
    { status },
  );
}

/** 统一处理未捕获异常。 */
export function apiUnexpected(error: unknown): NextResponse<ApiError> {
  const message = error instanceof Error ? error.message : "未知错误";
  return apiFail("INTERNAL_ERROR", message, 500);
}

/**
 * 数据源故障统一映射为 503，并携带前端冷却所需的 retry_after_ms；
 * 其它异常返回 null，由调用方按自身语义处理。
 */
export function apiDatasourceFailure(error: unknown): NextResponse<ApiError> | null {
  if (!isDataSourceUnavailableError(error)) {
    return null;
  }
  const payload = buildDataSourceFailurePayload(error);
  return apiFail(payload.code, payload.message, 503, payload.details);
}

/**
 * 包裹实时 / 最新数据读取：数据源故障返回 503，其它异常返回 500。
 * 约定：数据源不可用时绝不返回合成演示数据。
 */
export async function apiDatasource<T>(
  run: () => Promise<T>,
): Promise<NextResponse<ApiSuccess<T>> | NextResponse<ApiError>> {
  try {
    return apiOk(await run());
  } catch (error) {
    const failure = apiDatasourceFailure(error);
    if (failure) {
      return failure;
    }
    return apiUnexpected(error);
  }
}

/** 供 async 路由统一包裹处理结果的辅助类型。 */
export type ApiResult<T> = ApiResponse<T>;
