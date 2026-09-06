import { apiFail, apiOk } from "@/lib/api-response";
import { deleteReport } from "@/lib/analysis";
import { normalizeStockCode } from "@/lib/market";

import type { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ code: string; id: string }> };

// DELETE /api/stocks/:code/reports/:id：删除指定分析报告。
export async function DELETE(_request: NextRequest, context: RouteContext): Promise<Response> {
  const { code: rawCode, id } = await context.params;
  const code = normalizeStockCode(rawCode);
  if (!code) {
    return apiFail("VALIDATION_ERROR", "请输入 6 位沪深北 A 股代码。", 400);
  }

  if (!(await deleteReport(code, id))) {
    return apiFail("NOT_FOUND", "未找到该分析报告。", 404);
  }

  return apiOk({ id });
}
