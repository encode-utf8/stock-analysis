import { apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import { listFundReports, runFundAnalysis } from "@/lib/fund-analysis";
import { normalizeFundCode } from "@/lib/fund-market";

import type { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ code: string }> };

// GET /api/funds/:code/analysis：基金历史 AI 报告列表。
export async function GET(_request: NextRequest, context: RouteContext): Promise<Response> {
  const rawCode = (await context.params).code;
  const code = normalizeFundCode(rawCode);
  if (!code) {
    return apiFail("VALIDATION_ERROR", "请输入 6 位基金代码。", 400);
  }

  return apiOk(await listFundReports(code));
}

// POST /api/funds/:code/analysis：触发基金 AI 分析并生成报告。
export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const rawCode = (await context.params).code;
  const code = normalizeFundCode(rawCode);
  if (!code) {
    return apiFail("VALIDATION_ERROR", "请输入 6 位基金代码。", 400);
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { prompt?: string };
    const report = await runFundAnalysis(code, body.prompt);
    return apiOk(report, { status: 202 });
  } catch (error) {
    return apiUnexpected(error);
  }
}
