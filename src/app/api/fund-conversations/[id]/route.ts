import { apiFail, apiOk } from "@/lib/api-response";
import { deleteFundConversation, getFundConversationTimeline } from "@/lib/fund-chat";

import type { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/fund-conversations/:id：基金会话与消息时间线。
export async function GET(_request: NextRequest, context: RouteContext): Promise<Response> {
  const id = (await context.params).id;
  const timeline = await getFundConversationTimeline(id);
  if (!timeline) {
    return apiFail("NOT_FOUND", "未找到该基金会话。", 404);
  }
  return apiOk(timeline);
}

// DELETE /api/fund-conversations/:id：删除基金会话及其消息。
export async function DELETE(_request: NextRequest, context: RouteContext): Promise<Response> {
  const id = (await context.params).id;
  if (!(await deleteFundConversation(id))) {
    return apiFail("NOT_FOUND", "未找到该基金会话。", 404);
  }
  return apiOk({ id });
}
