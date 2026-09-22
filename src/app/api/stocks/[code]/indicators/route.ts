import { apiDatasource, apiFail } from "@/lib/api-response";
import { getIndicators } from "@/lib/market-data";
import { normalizeStockCode } from "@/lib/market";
import type { KlinePeriod } from "@/lib/shared/types";

import type { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ code: string }> };

const PERIODS: KlinePeriod[] = ["day", "week", "month", "minute"];

// GET /api/stocks/:code/indicators：本地计算的技术指标。
export async function GET(request: NextRequest, context: RouteContext) {
  const rawCode = (await context.params).code;
  const code = normalizeStockCode(rawCode);
  if (!code) {
    return apiFail("VALIDATION_ERROR", "请输入 6 位沪深北 A 股代码。", 400);
  }

  const rawPeriod = request.nextUrl.searchParams.get("period") ?? "day";
  const period = PERIODS.includes(rawPeriod as KlinePeriod)
    ? (rawPeriod as KlinePeriod)
    : "day";

  return apiDatasource(() => getIndicators(code, period));
}
