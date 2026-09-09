import { apiFail, apiOk } from "@/lib/api-response";
import {
  getFundStyle,
  normalizeFundStyleCode,
  normalizeFundStyleRange,
} from "@/lib/fund-style";

import type { NextRequest } from "next/server";

// GET /api/fund-style?code=510300&range=1y：计算基金持仓风格与风险收益因子。
export async function GET(request: NextRequest) {
  const code = normalizeFundStyleCode(request.nextUrl.searchParams.get("code"));
  if (!code) {
    return apiFail("VALIDATION_ERROR", "请输入 6 位基金代码。", 400);
  }

  const range = normalizeFundStyleRange(request.nextUrl.searchParams.get("range"));
  return apiOk(await getFundStyle(code, range));
}
