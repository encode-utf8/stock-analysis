import { apiFail, apiOk } from "@/lib/api-response";
import {
  getFundNav,
  type FundNavRange,
  type FundNavType,
} from "@/lib/fund-data";
import { normalizeFundCode } from "@/lib/fund-market";

import type { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ code: string }> };

const RANGES: FundNavRange[] = ["1m", "3m", "6m", "1y", "3y", "all"];
const TYPES: FundNavType[] = ["unit", "cumulative"];

// GET /api/funds/:code/nav?range=&type=：历史净值曲线。
export async function GET(request: NextRequest, context: RouteContext) {
  const rawCode = (await context.params).code;
  const code = normalizeFundCode(rawCode);
  if (!code) {
    return apiFail("VALIDATION_ERROR", "请输入 6 位基金代码。", 400);
  }

  const rawRange = request.nextUrl.searchParams.get("range") ?? "1y";
  const rawType = request.nextUrl.searchParams.get("type") ?? "unit";
  const range = RANGES.includes(rawRange as FundNavRange)
    ? (rawRange as FundNavRange)
    : "1y";
  const type = TYPES.includes(rawType as FundNavType)
    ? (rawType as FundNavType)
    : "unit";
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";

  return apiOk(await getFundNav(code, range, type, forceRefresh));
}
