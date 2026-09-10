import { apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import { parseAlertConditions, parseAlertLogic, parseCooldownHours } from "@/lib/alert-input";
import { alertRepository } from "@/lib/alert-store";
import { validateAlertRuleInput } from "@/lib/alerts";

import type { AlertRule } from "@/lib/shared/types";
import type { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ id: string }> };

/** 读取 JSON 请求体；非法 JSON 返回 null。 */
async function readJson(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** PATCH /api/alerts/rules/:id：修改条件、组合方式、启停或冷却期。 */
export async function PATCH(request: NextRequest, context: RouteContext): Promise<Response> {
  try {
    const id = (await context.params).id;
    const rule = await alertRepository.getRule(id);
    if (!rule) {
      return apiFail("NOT_FOUND", "未找到该预警规则。", 404);
    }

    const body = await readJson(request);
    if (!body) {
      return apiFail("BAD_REQUEST", "请求体不是合法 JSON。", 400);
    }

    const next: AlertRule = { ...rule };

    if (body.logic !== undefined) {
      const logic = parseAlertLogic(body.logic);
      if (!logic) {
        return apiFail("VALIDATION_ERROR", "logic 只支持 and 或 or。", 400);
      }
      next.logic = logic;
    }

    if (body.conditions !== undefined) {
      const parsed = parseAlertConditions(body.conditions);
      if (!parsed.ok) {
        return apiFail("VALIDATION_ERROR", parsed.error, 400);
      }
      next.conditions = parsed.conditions;
    }

    const validation = validateAlertRuleInput({
      target: next.target,
      logic: next.logic,
      conditions: next.conditions,
    });
    if (!validation.ok) {
      return apiFail("VALIDATION_ERROR", validation.error, 400);
    }

    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") {
        return apiFail("VALIDATION_ERROR", "enabled 必须是布尔值。", 400);
      }
      next.enabled = body.enabled;
    }

    if (body.cooldown_hours !== undefined) {
      next.cooldown_hours = parseCooldownHours(body.cooldown_hours);
    }

    next.updated_at = new Date().toISOString();
    await alertRepository.saveRule(next);
    return apiOk(next);
  } catch (error) {
    return apiUnexpected(error);
  }
}

/** DELETE /api/alerts/rules/:id：删除预警规则。 */
export async function DELETE(_request: NextRequest, context: RouteContext): Promise<Response> {
  try {
    const id = (await context.params).id;
    if (!(await alertRepository.getRule(id))) {
      return apiFail("NOT_FOUND", "未找到该预警规则。", 404);
    }
    await alertRepository.removeRule(id);
    return apiOk({ id });
  } catch (error) {
    return apiUnexpected(error);
  }
}