import { apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import { normalizeFundCode } from "@/lib/fund-market";
import { getFundReplayTimeline, normalizeFundReplayDays } from "@/lib/fund-replay";

import type { NextRequest } from "next/server";

// GET /api/fund-replay/timeline?code=510300&days=30：基金历史分析与对话时间线。
export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;
  const code = normalizeFundCode(params.get("code") ?? "");
  if (!code) {
    return apiFail("VALIDATION_ERROR", "请输入 6 位基金代码。", 400);
  }

  try {
    const days = normalizeFundReplayDays(params.get("days"));
    return apiOk(await getFundReplayTimeline(code, days));
  } catch (error) {
    return apiUnexpected(error);
  }
}
