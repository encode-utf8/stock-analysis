import { apiFail, apiOk } from "@/lib/api-response";
import {
  getFundDcaBacktest,
  normalizeFundDcaAmount,
  normalizeFundDcaCode,
  normalizeFundDcaFrequency,
  normalizeFundDcaRange,
} from "@/lib/fund-dca";

import type { NextRequest } from "next/server";

// GET /api/fund-dca?code=510300&range=1y&frequency=monthly&amount=1000：计算基金定投回测。
export async function GET(request: NextRequest) {
  const code = normalizeFundDcaCode(request.nextUrl.searchParams.get("code"));
  if (!code) {
    return apiFail("VALIDATION_ERROR", "请输入 6 位基金代码。", 400);
  }

  const range = normalizeFundDcaRange(request.nextUrl.searchParams.get("range"));
  const frequency = normalizeFundDcaFrequency(request.nextUrl.searchParams.get("frequency"));
  const amount = normalizeFundDcaAmount(request.nextUrl.searchParams.get("amount"));
  if (amount === null) {
    return apiFail("VALIDATION_ERROR", "每期定投金额需为大于 0 且不超过 1000 万的数字。", 400);
  }

  return apiOk(await getFundDcaBacktest(code, range, frequency, amount));
}
