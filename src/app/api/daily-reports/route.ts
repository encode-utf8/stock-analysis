import { apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import { listDailyReports, normalizeDailyReportKind } from "@/lib/daily-report-store";

import type { NextRequest } from "next/server";

// GET /api/daily-reports：按日期倒序返回指定类型的日报摘要列表。
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const kind = normalizeDailyReportKind(request.nextUrl.searchParams.get("kind"));
    if (!kind) {
      return apiFail("VALIDATION_ERROR", "kind 只支持 stock 或 fund。", 400);
    }
    return apiOk(await listDailyReports(kind));
  } catch (error) {
    return apiUnexpected(error);
  }
}