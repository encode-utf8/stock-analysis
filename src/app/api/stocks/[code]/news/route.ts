import { apiDatasource, apiFail } from "@/lib/api-response";
import { normalizeStockCode } from "@/lib/market";
import { searchNews } from "@/lib/news";

import type { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ code: string }> };

// GET /api/stocks/:code/news：按时间范围搜索资讯。
export async function GET(request: NextRequest, context: RouteContext) {
  const rawCode = (await context.params).code;
  const code = normalizeStockCode(rawCode);
  if (!code) {
    return apiFail("VALIDATION_ERROR", "请输入 6 位沪深北 A 股代码。", 400);
  }

  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  const rawDays = Number(request.nextUrl.searchParams.get("days") ?? 30);
  const allowedDays = [7, 14, 30, 90, 180, 365];
  const days = allowedDays.includes(rawDays) ? rawDays : 30;
  return apiDatasource(() => searchNews(code, days, forceRefresh));
}
