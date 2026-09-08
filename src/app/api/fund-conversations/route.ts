import { apiFail, apiOk } from "@/lib/api-response";
import { listFundConversations } from "@/lib/fund-chat";
import { normalizeFundCode } from "@/lib/fund-market";

import type { NextRequest } from "next/server";

// GET /api/fund-conversations?code=：基金历史会话列表。
export async function GET(request: NextRequest): Promise<Response> {
  const rawCode = request.nextUrl.searchParams.get("code") ?? "";
  const code = normalizeFundCode(rawCode);
  if (!code) {
    return apiFail("VALIDATION_ERROR", "请输入 6 位基金代码。", 400);
  }

  return apiOk(await listFundConversations(code));
}
