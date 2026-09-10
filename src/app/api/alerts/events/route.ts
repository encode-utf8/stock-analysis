import { apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import { parseAlertTarget } from "@/lib/alert-input";
import { alertRepository, type AlertEventQuery } from "@/lib/alert-store";

import type { AlertEventStatus } from "@/lib/shared/types";
import type { NextRequest } from "next/server";

/** 解析事件状态过滤条件。 */
function parseStatus(value: string | null): AlertEventStatus | null {
  return value === "unread" || value === "read" ? value : null;
}

/** GET /api/alerts/events：返回预警事件，支持按状态、标的与代码过滤。 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const params = request.nextUrl.searchParams;
    const query: AlertEventQuery = {};

    const statusParam = params.get("status");
    if (statusParam) {
      const status = parseStatus(statusParam);
      if (!status) {
        return apiFail("VALIDATION_ERROR", "status 只支持 unread 或 read。", 400);
      }
      query.status = status;
    }

    const targetParam = params.get("target");
    if (targetParam) {
      const target = parseAlertTarget(targetParam);
      if (!target) {
        return apiFail("VALIDATION_ERROR", "target 只支持 stock 或 fund。", 400);
      }
      query.target = target;
    }

    const code = params.get("code")?.trim();
    if (code) {
      if (!/^\d{6}$/.test(code)) {
        return apiFail("VALIDATION_ERROR", "code 必须是 6 位数字。", 400);
      }
      query.code = code;
    }

    const limitParam = params.get("limit");
    if (limitParam) {
      const limit = Number(limitParam);
      if (!Number.isFinite(limit) || limit <= 0) {
        return apiFail("VALIDATION_ERROR", "limit 必须是正整数。", 400);
      }
      query.limit = Math.floor(limit);
    }

    return apiOk(await alertRepository.listEvents(query));
  } catch (error) {
    return apiUnexpected(error);
  }
}