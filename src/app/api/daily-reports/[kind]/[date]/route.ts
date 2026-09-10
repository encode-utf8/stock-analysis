import { apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import { getDailyReport, normalizeDailyReportDate, normalizeDailyReportKind } from "@/lib/daily-report-store";

import type { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ kind: string; date: string }> };

// GET /api/daily-reports/:kind/:date：返回某天日报的完整内容。
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: RouteContext): Promise<Response> {
  try {
    const { kind: rawKind, date: rawDate } = await context.params;
    const kind = normalizeDailyReportKind(rawKind);
    if (!kind) {
      return apiFail("VALIDATION_ERROR", "kind 只支持 stock 或 fund。", 400);
    }
    const date = normalizeDailyReportDate(rawDate);
    if (!date) {
      return apiFail("VALIDATION_ERROR", "date 必须为 YYYY-MM-DD 格式。", 400);
    }

    const found = await getDailyReport(kind, date);
    if (!found) {
      return apiFail("NOT_FOUND", `${date} 暂无${kind === "stock" ? "股市" : "基金"}日报。`, 404);
    }
    return apiOk({ ...found.report, storage: found.storage });
  } catch (error) {
    return apiUnexpected(error);
  }
}