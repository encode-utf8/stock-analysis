import { apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import { normalizeDailyReportKind } from "@/lib/daily-report-store";
import {
  DAILY_REPORT_BACKFILL_MAX_DAYS,
  runDailyReportBackfill,
} from "@/lib/scheduler";

import type { NextRequest } from "next/server";

// POST /api/admin/daily-reports/backfill：按最近 N 个交易日批量回补日报。
export const dynamic = "force-dynamic";
// 批量回补可能连续生成多篇日报（含模型调用），放宽函数执行时长。
export const maxDuration = 300;

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

    let days = 5;
    const rawDays = body?.days;
    if (rawDays !== undefined && rawDays !== null && rawDays !== "") {
      const parsed = typeof rawDays === "number" ? rawDays : Number(rawDays);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > DAILY_REPORT_BACKFILL_MAX_DAYS) {
        return apiFail(
          "VALIDATION_ERROR",
          `days 需为 1-${DAILY_REPORT_BACKFILL_MAX_DAYS} 的整数。`,
          400,
        );
      }
      days = parsed;
    }

    const result = await runDailyReportBackfill(kind, {
      days,
      force: body?.force === true,
      source: "manual",
    });
    return apiOk(result);
  } catch (error) {
    return apiUnexpected(error);
  }
}
