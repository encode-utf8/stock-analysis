import { apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import {
  createAlertRuleId,
  parseAlertConditions,
  parseAlertLogic,
  parseAlertTarget,
  parseCooldownHours,
} from "@/lib/alert-input";
import { alertRepository } from "@/lib/alert-store";
import { validateAlertRuleInput } from "@/lib/alerts";
import { fundWatchlistRepository } from "@/lib/fund-watchlist";
import { watchlistRepository } from "@/lib/watchlist";

import type { AlertRule } from "@/lib/shared/types";
import type { NextRequest } from "next/server";

/** 读取 JSON 请求体；非法 JSON 返回 null。 */
async function readJson(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** GET /api/alerts/rules：返回预警规则，可按 target 过滤。 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const targetParam = request.nextUrl.searchParams.get("target");
    const target = targetParam ? parseAlertTarget(targetParam) : null;
    if (targetParam && !target) {
      return apiFail("VALIDATION_ERROR", "target 只支持 stock 或 fund。", 400);
    }

    const rules = await alertRepository.listRules();
    return apiOk(target ? rules.filter((rule) => rule.target === target) : rules);
  } catch (error) {
    return apiUnexpected(error);
  }
}

/** POST /api/alerts/rules：新增预警规则。 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = await readJson(request);
    if (!body) {
      return apiFail("BAD_REQUEST", "请求体不是合法 JSON。", 400);
    }

    const target = parseAlertTarget(body.target);
    if (!target) {
      return apiFail("VALIDATION_ERROR", "target 只支持 stock 或 fund。", 400);
    }

    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!/^\d{6}$/.test(code)) {
      return apiFail("VALIDATION_ERROR", "请输入 6 位标的代码。", 400);
    }

    const logic = parseAlertLogic(body.logic ?? "and");
    if (!logic) {
      return apiFail("VALIDATION_ERROR", "logic 只支持 and 或 or。", 400);
    }

    const parsed = parseAlertConditions(body.conditions);
    if (!parsed.ok) {
      return apiFail("VALIDATION_ERROR", parsed.error, 400);
    }

    const validation = validateAlertRuleInput({ target, logic, conditions: parsed.conditions });
    if (!validation.ok) {
      return apiFail("VALIDATION_ERROR", validation.error, 400);
    }

    // 标的必须已在对应自选池内，名称以自选池为准，避免前后端信息不一致。
    const watchItem =
      target === "stock"
        ? await watchlistRepository.getByCode(code)
        : await fundWatchlistRepository.getByCode(code);
    if (!watchItem) {
      return apiFail(
        "VALIDATION_ERROR",
        target === "stock" ? "请先把该股票加入自选股。" : "请先把该基金加入自选基金。",
        400,
      );
    }

    const rules = await alertRepository.listRules();
    if (rules.some((rule) => rule.target === target && rule.code === code)) {
      return apiFail("VALIDATION_ERROR", "该标的已有预警任务，请直接修改现有规则。", 409);
    }

    const settings = await alertRepository.getSettings();
    const distinctTargets = new Set(rules.map((rule) => `${rule.target}:${rule.code}`));
    if (distinctTargets.size >= settings.max_targets) {
      return apiFail(
        "VALIDATION_ERROR",
        `最多只能为 ${settings.max_targets} 个自选标的配置预警任务，请先删除多余的规则。`,
        400,
      );
    }

    const now = new Date().toISOString();
    const rule: AlertRule = {
      id: createAlertRuleId(),
      target,
      code,
      name: watchItem.name,
      logic,
      conditions: parsed.conditions,
      enabled: body.enabled === undefined ? true : body.enabled !== false,
      cooldown_hours: parseCooldownHours(body.cooldown_hours),
      created_at: now,
      updated_at: now,
      last_triggered_at: null,
    };

    await alertRepository.saveRule(rule);
    return apiOk(rule, { status: 201 });
  } catch (error) {
    return apiUnexpected(error);
  }
}