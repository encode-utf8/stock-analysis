import { apiFail, apiOk } from "@/lib/api-response";
import { deleteConversation, getConversationTimeline } from "@/lib/chat";

import type { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/conversations/:id：会话与消息时间线。
export async function GET(_request: NextRequest, context: RouteContext): Promise<Response> {
  const id = (await context.params).id;
  const timeline = await getConversationTimeline(id);
  if (!timeline) {
    return apiFail("NOT_FOUND", "未找到该会话。", 404);
  }

  return apiOk(timeline);
}

// DELETE /api/conversations/:id：删除会话及其消息。
export async function DELETE(_request: NextRequest, context: RouteContext): Promise<Response> {
  const id = (await context.params).id;
  if (!(await deleteConversation(id))) {
    return apiFail("NOT_FOUND", "未找到该会话。", 404);
  }

  return apiOk({ id });
}
