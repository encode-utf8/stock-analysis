import { apiFail, apiOk } from "@/lib/api-response";
import {
  getFundMetrics,
  type FundMetricsRange,
} from "@/lib/fund-metrics";
import { normalizeFundCode } from "@/lib/fund-market";

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

  const metrics = await getFundMetrics(code, range, forceRefresh);
  if (!metrics) {
    return apiFail("NOT_FOUND", "暂无可计算的基金风险指标。", 404);
  }
  return apiOk(metrics);
}
