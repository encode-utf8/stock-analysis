import { apiDatasourceFailure, apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import { runAnalysis } from "@/lib/analysis";
import { normalizeStockCode } from "@/lib/market";

import type { NextRequest } from "next/server";
import type { NewsItem } from "@/lib/shared/types";

type RouteContext = { params: Promise<{ code: string }> };

// POST /api/stocks/:code/analysis：触发 AI 分析并生成报告。
export async function POST(request: NextRequest, context: RouteContext) {
  const rawCode = (await context.params).code;
  const code = normalizeStockCode(rawCode);
  if (!code) {
    return apiFail("VALIDATION_ERROR", "请输入 6 位沪深北 A 股代码。", 400);
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      prompt?: string;
      news?: NewsItem[];
    };
    const report = await runAnalysis(code, body.prompt, body.news ?? []);
    return apiOk(report, { status: 202 });
  } catch (error) {
    // 数据源故障返回 503（含冷却时长），其它异常按 500 处理。
    return apiDatasourceFailure(error) ?? apiUnexpected(error);
  }
}
