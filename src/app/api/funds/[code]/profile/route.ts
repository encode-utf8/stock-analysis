import { apiFail, apiOk } from "@/lib/api-response";
import { getFundProfile } from "@/lib/fund-data";
import { normalizeFundCode } from "@/lib/fund-market";

import type { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ code: string }> };

// GET /api/funds/:code/profile：基金档案与类型识别。
export async function GET(request: NextRequest, context: RouteContext) {
  const rawCode = (await context.params).code;
  const code = normalizeFundCode(rawCode);
  if (!code) {
    return apiFail("VALIDATION_ERROR", "请输入 6 位基金代码。", 400);
  }

  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  return apiOk(await getFundProfile(code, forceRefresh));
}
