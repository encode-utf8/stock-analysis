import { apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import {
  getFundPortfolio,
  normalizeFundPortfolioCodes,
  normalizeFundPortfolioMode,
  normalizeFundPortfolioRange,
  normalizeFundPortfolioShares,
  normalizeFundPortfolioWeights,
} from "@/lib/fund-portfolio";

import type { NextRequest } from "next/server";

// GET /api/fund-portfolio?codes=510300,110022&mode=weight&weights=60,40&range=1y：按权重合成组合并计算风险指标。
// GET /api/fund-portfolio?codes=510300,110022&mode=shares&shares=30000,10000&range=1y：按持仓份额合成组合并计算风险指标。
export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;
  const codes = normalizeFundPortfolioCodes(params.get("codes"));
  if (!codes) {
    return apiFail("VALIDATION_ERROR", "请提供 2 至 5 个合法基金代码。", 400);
  }

  const mode = normalizeFundPortfolioMode(params.get("mode"));
  const range = normalizeFundPortfolioRange(params.get("range"));
  if (mode === "shares") {
    const shares = normalizeFundPortfolioShares(params.get("shares"), codes.length);
    if (!shares) {
      return apiFail(
        "VALIDATION_ERROR",
        "持仓份额数量需与基金数量一致，且每只基金份额需大于 0。",
        400,
      );
    }
    try {
      return apiOk(await getFundPortfolio(codes, range, { mode, weights: null, shares }));
    } catch (error) {
      return apiUnexpected(error);
    }
  }

  const weights = normalizeFundPortfolioWeights(params.get("weights"), codes.length);
  if (!weights) {
    return apiFail(
      "VALIDATION_ERROR",
      "权重数量需与基金数量一致，且权重合计约等于 100。",
      400,
    );
  }

  try {
    return apiOk(await getFundPortfolio(codes, range, { mode, weights, shares: null }));
  } catch (error) {
    return apiUnexpected(error);
  }
}
