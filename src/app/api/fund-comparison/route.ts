import { apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import {
  getFundComparison,
  normalizeFundComparisonCodes,
  normalizeFundComparisonRange,
} from "@/lib/fund-comparison";

import type { NextRequest } from "next/server";

// GET /api/fund-comparison?codes=510300,110022&range=1y：对比多只基金的同区间指标。
export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;
  const codes = normalizeFundComparisonCodes(params.get("codes"));
  if (!codes) {
    return apiFail("VALIDATION_ERROR", "请提供 2 至 5 个合法基金代码。", 400);
  }

  const range = normalizeFundComparisonRange(params.get("range"));
  try {
    return apiOk(await getFundComparison(codes, range));
  } catch (error) {
    return apiUnexpected(error);
  }
}
