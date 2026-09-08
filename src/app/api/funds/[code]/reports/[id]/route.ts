import { apiFail, apiOk } from "@/lib/api-response";
import { deleteFundReport } from "@/lib/fund-analysis";
import { normalizeFundCode } from "@/lib/fund-market";

import type { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ code: string; id: string }> };

// DELETE /api/funds/:code/reports/:id：删除指定基金 AI 报告。
export async function DELETE(_request: NextRequest, context: RouteContext): Promise<Response> {
  const { code: rawCode, id } = await context.params;
  const code = normalizeFundCode(rawCode);
  if (!code) {
    return apiFail("VALIDATION_ERROR", "请输入 6 位基金代码。", 400);
  }

  if (!(await deleteFundReport(code, id))) {
    return apiFail("NOT_FOUND", "未找到该基金分析报告。", 404);
  }

  return apiOk({ id });
}
