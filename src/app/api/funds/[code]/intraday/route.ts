import { apiFail, apiOk } from "@/lib/api-response";
import { getFundIntraday } from "@/lib/fund-intraday";
import { normalizeFundCode } from "@/lib/fund-market";

import type { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ code: string }> };

// GET /api/funds/:code/intraday：场内实时行情或场外盘中估算。
export async function GET(request: NextRequest, context: RouteContext) {
  const rawCode = (await context.params).code;
  const code = normalizeFundCode(rawCode);
  if (!code) {
    return apiFail("VALIDATION_ERROR", "请输入 6 位基金代码。", 400);
  }

  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  return apiOk(await getFundIntraday(code, forceRefresh));
}
