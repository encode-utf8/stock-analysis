import { apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import { normalizeDailyReportDate, normalizeDailyReportKind } from "@/lib/daily-report-store";
import { runDailyReportManual } from "@/lib/scheduler";
import { beijingDateKey, getTradingCalendar } from "@/lib/trading-calendar";

import type { NextRequest } from "next/server";

// POST /api/admin/daily-reports：手动生成日报，支持按指定日期补生成历史日报。
export const dynamic = "force-dynamic";

/** 读取 JSON 请求体；非法 JSON 返回 null。 */
async function readJson(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = await readJson(request);
    const kind = normalizeDailyReportKind(body?.kind);
    if (!kind) {
      return apiFail("VALIDATION_ERROR", "kind 只支持 stock 或 fund。", 400);
    }

    let date: string | undefined;
    const rawDate = body?.date;
    if (rawDate !== undefined && rawDate !== null && rawDate !== "") {
      const parsed = normalizeDailyReportDate(rawDate);
      if (!parsed) {
        return apiFail("VALIDATION_ERROR", "date 必须为 YYYY-MM-DD 格式。", 400);
      }
      if (parsed > beijingDateKey(new Date())) {
        return apiFail("VALIDATION_ERROR", "date 不能晚于今天。", 400);
      }
      const calendar = await getTradingCalendar();
      if (!calendar.isTradingDay(parsed)) {
        return apiFail("VALIDATION_ERROR", `${parsed} 不是交易日，无需生成日报。`, 400);
      }
      date = parsed;
    }

    const result = await runDailyReportManual(kind, {
      date,
      force: body?.force === true,
      source: "manual",
    });
    return apiOk(result);
  } catch (error) {
    return apiUnexpected(error);
  }
}