import { apiDatasource, apiFail } from "@/lib/api-response";
import { getKlines } from "@/lib/market-data";
import { normalizeStockCode } from "@/lib/market";
import type { AdjustType, KlinePeriod } from "@/lib/shared/types";

import type { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ code: string }> };

const PERIODS: KlinePeriod[] = ["day", "week", "month", "minute"];
const ADJUSTS: AdjustType[] = ["qfq", "hfq", "none"];

// GET /api/stocks/:code/kline?period=&adjust=&limit=：K 线。
export async function GET(request: NextRequest, context: RouteContext) {
  const rawCode = (await context.params).code;
  const code = normalizeStockCode(rawCode);
  if (!code) {
    return apiFail("VALIDATION_ERROR", "请输入 6 位沪深北 A 股代码。", 400);
  }

  const rawPeriod = request.nextUrl.searchParams.get("period") ?? "day";
  const rawAdjust = request.nextUrl.searchParams.get("adjust") ?? "qfq";
  const rawLimit = request.nextUrl.searchParams.get("limit");
  const period = PERIODS.includes(rawPeriod as KlinePeriod)
    ? (rawPeriod as KlinePeriod)
    : "day";
  const adjust = ADJUSTS.includes(rawAdjust as AdjustType)
    ? (rawAdjust as AdjustType)
    : "qfq";
  const limit = Math.min(Math.max(Number(rawLimit) || 30, 10), 240);
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";

  return apiDatasource(() => getKlines(code, period, adjust, limit, forceRefresh));
}
