import { apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import {
  deleteDailyReport,
  normalizeDailyReportDate,
  normalizeDailyReportKind,
} from "@/lib/daily-report-store";

import type { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ kind: string; date: string }> };

// DELETE /api/admin/daily-reports/:kind/:date：删除某天日报并同步移除两侧索引。
export const dynamic = "force-dynamic";

export async function DELETE(_request: NextRequest, context: RouteContext): Promise<Response> {
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

    const result = await deleteDailyReport(kind, date);
    return apiOk({ kind, date, ...result });
  } catch (error) {
    return apiUnexpected(error);
  }
}
