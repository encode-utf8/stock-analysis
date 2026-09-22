import { apiDatasourceFailure, apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import {
  getFundMetrics,
  type FundMetricsRange,
} from "@/lib/fund-metrics";
import { normalizeFundCode } from "@/lib/fund-market";
import type { FundRiskMetrics } from "@/lib/shared/types";

import type { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ code: string }> };

const RANGES: FundMetricsRange[] = ["1m", "3m", "6m", "1y", "3y", "all"];

// GET /api/funds/:code/metrics?range=：基金回撤与风险收益指标。
export async function GET(request: NextRequest, context: RouteContext) {
  const rawCode = (await context.params).code;
  const code = normalizeFundCode(rawCode);
  if (!code) {
    return apiFail("VALIDATION_ERROR", "请输入 6 位基金代码。", 400);
  }

  const rawRange = request.nextUrl.searchParams.get("range") ?? "1y";
  const range = RANGES.includes(rawRange as FundMetricsRange)
    ? (rawRange as FundMetricsRange)
    : "1y";
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";

  let metrics: FundRiskMetrics | null;
  try {
    metrics = await getFundMetrics(code, range, forceRefresh);
  } catch (error) {
    // 数据源故障返回 503（含冷却时长），其它异常按 500 处理。
    return apiDatasourceFailure(error) ?? apiUnexpected(error);
  }
  // 返回 null 表示区间内样本不足，与数据源故障区分开。
  if (!metrics) {
    return apiFail("NOT_FOUND", "暂无可计算的基金风险指标。", 404);
  }
  return apiOk(metrics);
}
