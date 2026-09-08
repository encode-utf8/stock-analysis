import { apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import {
  normalizeFundRefreshCode,
  runFundRefreshJob,
  startScheduler,
  type FundRefreshTarget,
} from "@/lib/scheduler";
import { SAMPLE_FUND_CODES } from "@/lib/fund-market";

import type { NextRequest } from "next/server";

const TARGETS: FundRefreshTarget[] = [
  "profile",
  "intraday",
  "nav",
  "holdings",
  "metrics",
  "all",
];

// POST /api/admin/fund-refresh：手动刷新基金档案、净值、持仓与风险指标。
export async function POST(request: NextRequest): Promise<Response> {
  startScheduler();
  const body = (await request.json().catch(() => ({}))) as {
    code?: string;
    target?: FundRefreshTarget;
  };

  let codes: string[];
  if (body.code) {
    const normalized = normalizeFundRefreshCode(body.code);
    if (!normalized) {
      return apiFail("VALIDATION_ERROR", "请输入 6 位基金代码。", 400);
    }
    codes = [normalized];
  } else {
    codes = [...SAMPLE_FUND_CODES];
  }

  const target = TARGETS.includes(body.target as FundRefreshTarget)
    ? (body.target as FundRefreshTarget)
    : "all";

  try {
    const run = await runFundRefreshJob({
      codes,
      target,
      source: "manual",
    });
    return apiOk(run, { status: 202 });
  } catch (error) {
    return apiUnexpected(error);
  }
}
