import { apiFail, apiOk } from "@/lib/api-response";
import { normalizeFundCode } from "@/lib/fund-market";
import { getFundIndustryNews } from "@/lib/fund-news";

import type { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ code: string }> };

// GET /api/funds/:code/news：根据基金持仓识别强相关行业，并返回真实行业资讯。
export async function GET(request: NextRequest, context: RouteContext) {
  const rawCode = (await context.params).code;
  const code = normalizeFundCode(rawCode);
  if (!code) {
    return apiFail("VALIDATION_ERROR", "请输入 6 位基金代码。", 400);
  }

  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  return apiOk(await getFundIndustryNews(code, forceRefresh));
}
