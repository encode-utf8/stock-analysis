import { apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import { alertRepository } from "@/lib/alert-store";

import type { AlertEventStatus } from "@/lib/shared/types";
import type { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ id: string }> };

/** 解析事件状态；非法时返回 null。 */
function parseStatus(value: unknown): AlertEventStatus | null {
  return value === "unread" || value === "read" ? value : null;
}

/** PATCH /api/alerts/events/:id：标记事件已读或未读。 */
export async function PATCH(request: NextRequest, context: RouteContext): Promise<Response> {
  try {
    const id = (await context.params).id;
    const body = (await request.json().catch(() => null)) as { status?: unknown } | null;
    const status = parseStatus(body?.status);
    if (!status) {
      return apiFail("VALIDATION_ERROR", "status 只支持 unread 或 read。", 400);
    }

    if (!(await alertRepository.getEvent(id))) {
      return apiFail("NOT_FOUND", "未找到该预警事件。", 404);
    }

    await alertRepository.updateEventStatus(id, status);
    return apiOk({ id, status });
  } catch (error) {
    return apiUnexpected(error);
  }
}

/** DELETE /api/alerts/events/:id：删除预警事件。 */
export async function DELETE(_request: NextRequest, context: RouteContext): Promise<Response> {
  try {
    const id = (await context.params).id;
    if (!(await alertRepository.getEvent(id))) {
      return apiFail("NOT_FOUND", "未找到该预警事件。", 404);
    }
    await alertRepository.removeEvent(id);
    return apiOk({ id });
  } catch (error) {
    return apiUnexpected(error);
  }
}