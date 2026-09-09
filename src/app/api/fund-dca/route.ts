import { apiFail, apiOk } from "@/lib/api-response";
import {
  getFundDcaBacktest,
  getFundDcaPortfolioBacktest,
  normalizeFundDcaAmount,
  normalizeFundDcaAmounts,
  normalizeFundDcaCode,
  normalizeFundDcaCodes,
  normalizeFundDcaFrequency,
  normalizeFundDcaRange,
} from "@/lib/fund-dca";

import type { NextRequest } from "next/server";

// GET /api/fund-dca?code=510300&range=1y&frequency=monthly&amount=1000：计算基金定投回测。
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const range = normalizeFundDcaRange(params.get("range"));
  const frequency = normalizeFundDcaFrequency(params.get("frequency"));

  const codes = normalizeFundDcaCodes(params.get("codes"));
  if (codes) {
    const amounts = normalizeFundDcaAmounts(params.get("amounts"), codes.length);
    if (!amounts) {
      return apiFail("VALIDATION_ERROR", "??????????????????????????? 0?", 400);
    }
    return apiOk(await getFundDcaPortfolioBacktest(codes, range, frequency, amounts));
  }

  const code = normalizeFundDcaCode(params.get("code"));
  if (!code) {
    return apiFail("VALIDATION_ERROR", "??? 6 ??????", 400);
  }
  const amount = normalizeFundDcaAmount(params.get("amount"));
  if (amount === null) {
    return apiFail("VALIDATION_ERROR", "?????????? 0 ???? 1000 ?????", 400);
  }

  return apiOk(await getFundDcaBacktest(code, range, frequency, amount));
}
