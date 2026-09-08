import { apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import { normalizeFundCode } from "@/lib/fund-market";
import { getFundReplaySummary, normalizeFundReplayDays } from "@/lib/fund-replay";

import type { NextRequest } from "next/server";

// GET /api/fund-replay/stats?code=510300&days=30：汇总基金历史复盘统计。
export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;
  const code = normalizeFundCode(params.get("code") ?? "");
  if (!code) {
    return apiFail("VALIDATION_ERROR", "请输入 6 位基金代码。", 400);
  }

  try {
    const days = normalizeFundReplayDays(params.get("days"));
    return apiOk(await getFundReplaySummary(code, days));
  } catch (error) {
    return apiUnexpected(error);
  }
}
