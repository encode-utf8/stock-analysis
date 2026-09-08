import { apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import {
  getFundPortfolio,
  normalizeFundPortfolioCodes,
  normalizeFundPortfolioRange,
  normalizeFundPortfolioWeights,
} from "@/lib/fund-portfolio";

import type { NextRequest } from "next/server";

// GET /api/fund-portfolio?codes=510300,110022&weights=60,40&range=1y：按权重合成组合并计算风险指标。
export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;
  const codes = normalizeFundPortfolioCodes(params.get("codes"));
  if (!codes) {
    return apiFail("VALIDATION_ERROR", "请提供 2 至 5 个合法基金代码。", 400);
  }

  const weights = normalizeFundPortfolioWeights(params.get("weights"), codes.length);
  if (!weights) {
    return apiFail(
      "VALIDATION_ERROR",
      "权重数量需与基金数量一致，且权重合计约等于 100。",
      400,
    );
  }

  const range = normalizeFundPortfolioRange(params.get("range"));
  try {
    return apiOk(await getFundPortfolio(codes, weights, range));
  } catch (error) {
    return apiUnexpected(error);
  }
}
