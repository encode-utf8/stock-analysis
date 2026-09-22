import { apiDatasource, apiFail } from "@/lib/api-response";
import { getMarketQuote } from "@/lib/market-data";
import { normalizeStockCode } from "@/lib/market";

import type { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ code: string }> };

// GET /api/stocks/:code/quote：当前行情快照。
export async function GET(request: NextRequest, context: RouteContext) {
  const rawCode = (await context.params).code;
  const code = normalizeStockCode(rawCode);
  if (!code) {
    return apiFail("VALIDATION_ERROR", "请输入 6 位沪深北 A 股代码。", 400);
  }

  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  return apiDatasource(() => getMarketQuote(code, forceRefresh));
}
