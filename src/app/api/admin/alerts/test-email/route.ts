import { apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import { sendTestEmail } from "@/lib/alert-email";
import { alertRepository } from "@/lib/alert-store";

import type { NextRequest } from "next/server";

/** POST /api/admin/alerts/test-email：向预留邮箱发送测试邮件。 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = (await request.json().catch(() => null)) as { email_to?: unknown } | null;
    const settings = await alertRepository.getSettings();

    // 请求体可临时覆盖收件邮箱，便于发送前先验证通道。
    const to =
      typeof body?.email_to === "string" && body.email_to.trim()
        ? body.email_to.trim()
        : settings.email_to;

    if (!to) {
      return apiFail("VALIDATION_ERROR", "请先填写收件邮箱后再发送测试邮件。", 400);
    }

    const result = await sendTestEmail(to);
    if (result.status === "failed") {
      return apiFail("INTERNAL_ERROR", result.reason ?? "测试邮件发送失败。", 502);
    }
    return apiOk({ ...result, email_to: to });
  } catch (error) {
    return apiUnexpected(error);
  }
}