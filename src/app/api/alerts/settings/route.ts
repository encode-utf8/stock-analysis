import { apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import { alertRepository } from "@/lib/alert-store";

import type { NextRequest } from "next/server";

/** 简单的邮箱格式校验。 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** GET /api/alerts/settings：读取预警设置（含邮件通道状态）。 */
export async function GET(): Promise<Response> {
  try {
    return apiOk(await alertRepository.getSettings());
  } catch (error) {
    return apiUnexpected(error);
  }
}

/** PATCH /api/alerts/settings：更新收件邮箱与邮件推送开关。 */
export async function PATCH(request: NextRequest): Promise<Response> {
  try {
    const body = (await request.json().catch(() => null)) as {
      email_to?: unknown;
      email_enabled?: unknown;
    } | null;
    if (!body) {
      return apiFail("BAD_REQUEST", "请求体不是合法 JSON。", 400);
    }

    const patch: { email_to?: string | null; email_enabled?: boolean } = {};

    if (body.email_to !== undefined) {
      if (body.email_to === null || body.email_to === "") {
        patch.email_to = null;
      } else if (typeof body.email_to === "string") {
        const email = body.email_to.trim();
        if (!EMAIL_PATTERN.test(email)) {
          return apiFail("VALIDATION_ERROR", "请输入有效的收件邮箱。", 400);
        }
        patch.email_to = email;
      } else {
        return apiFail("VALIDATION_ERROR", "email_to 必须是字符串或 null。", 400);
      }
    }

    if (body.email_enabled !== undefined) {
      if (typeof body.email_enabled !== "boolean") {
        return apiFail("VALIDATION_ERROR", "email_enabled 必须是布尔值。", 400);
      }
      patch.email_enabled = body.email_enabled;
    }

    if (Object.keys(patch).length === 0) {
      return apiFail("VALIDATION_ERROR", "没有需要更新的设置项。", 400);
    }

    return apiOk(await alertRepository.updateSettings(patch));
  } catch (error) {
    return apiUnexpected(error);
  }
}