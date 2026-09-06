import { apiFail, apiOk } from "@/lib/api-response";
import { requestStopAnalysis } from "@/lib/analysis";
import { normalizeStockCode } from "@/lib/market";

import type { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ code: string }> };

// POST /api/stocks/:code/analysis/stop：停止正在生成的 AI 分析并保存已生成内容。
export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const rawCode = (await context.params).code;
  const code = normalizeStockCode(rawCode);
  if (!code) {
    return apiFail("VALIDATION_ERROR", "请输入 6 位沪深北 A 股代码。", 400);
  }

  const body = (await request.json().catch(() => ({}))) as {
    reportId?: string;
  };
  const reportId = body.reportId?.trim();
  if (!reportId) {
    return apiFail("VALIDATION_ERROR", "缺少待停止的分析报告编号。", 400);
  }

  const stopped = requestStopAnalysis(reportId);
  if (!stopped) {
    return apiFail("NOT_FOUND", "未找到正在生成的分析任务，可能已经结束。", 404);
  }

  return apiOk({ id: reportId, stopped: true });
}
