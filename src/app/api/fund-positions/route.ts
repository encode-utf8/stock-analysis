import { apiDatasourceFailure, apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import { resolveVerifyVerdict } from "@/lib/code-verify";
import { verifyFundCode } from "@/lib/data-service";
import {
  buildFundPosition,
  buildFundPositionSnapshot,
  fundPositionRepository,
  resolveCalibration,
  resolveFundPositionUpsert,
  resolveManualAnchor,
  resolveManualMergeBase,
  validateFundPositionInput,
  valueFundPositions,
} from "@/lib/fund-position";
import type { FundPositionPatch } from "@/lib/fund-position";
import type { FundPositionInput } from "@/lib/shared/types";

import type { NextRequest } from "next/server";

/** 读取 JSON 请求体；非法 JSON 返回 null。 */
async function readJson(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** GET /api/fund-positions：返回持有基金估值明细与组合汇总。 */
export async function GET(): Promise<Response> {
  try {
    const positions = await fundPositionRepository.list();
    return apiOk(buildFundPositionSnapshot(await valueFundPositions(positions)));
  } catch (error) {
    return apiDatasourceFailure(error) ?? apiUnexpected(error);
  }
}

/**
 * POST /api/fund-positions：新增持有基金（手动持有或启用定投计划）。
 * 持有列表里一个基金代码只保留一条记录：已存在时按既有条目自动合并。
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = await readJson(request);
    if (!body) {
      return apiFail("BAD_REQUEST", "请求体不是合法 JSON。", 400);
    }

    const result = validateFundPositionInput(body as unknown as FundPositionInput);
    if ("error" in result) {
      return apiFail("VALIDATION_ERROR", result.error, 400);
    }

    const { code, amount, profit, profit_caliber, plan, note } = result.value;

    // 与自选池一致：写入前确认代码在上游有数据，上游不可用时放行。
    const verdict = resolveVerifyVerdict(await verifyFundCode(code), "fund", code);
    if (verdict.blocked) {
      return apiFail("CODE_NOT_FOUND", verdict.message, 400);
    }

    const existing = await fundPositionRepository.getByCode(code);

    // 手动持仓录入时要记下「这组值对应哪一天的收盘口径」，之后每个交易日才能把收益自动推进（R6）。
    const freshAnchor = plan === null ? await resolveManualAnchor(code, profit_caliber) : null;

    if (!existing) {
      const position = buildFundPosition(
        { code, amount, profit, profit_caliber, plan, note, manual_anchor: freshAnchor },
        verdict.name,
      );
      await fundPositionRepository.add(position);
      const [valuation] = await valueFundPositions([position]);
      return apiOk(valuation, { status: 201 });
    }

    // 已存在同一代码：按既有条目是手动还是定投自动合并（叠加 / 换用计划 / 更新计划）。
    // 叠加手动值前，先把既有记录推进到同一个口径层级，否则两组金额不在同一天口径上。
    const base =
      plan === null ? await resolveManualMergeBase(existing, freshAnchor) : null;
    const merged = resolveFundPositionUpsert(
      base ? { ...existing, amount: base.amount, profit: base.profit } : existing,
      { amount, profit, profit_caliber, plan, note },
      { manualAnchor: base?.anchor ?? null },
    );
    if ("error" in merged) {
      return apiFail("VALIDATION_ERROR", merged.error, 409);
    }

    const patch: FundPositionPatch = { ...merged.patch };
    if (merged.action === "attach_plan") {
      // 用既有手动持仓折算校准基线，避免启用计划后已录入的持有凭空消失。
      const calibration = await resolveCalibration(code, merged.calibrationFrom);
      if (!calibration) {
        return apiFail(
          "VALIDATION_ERROR",
          "暂时取不到该基金的净值，无法沿用既有持仓作为定投基线，请稍后重试。",
          400,
        );
      }
      patch.calibration = calibration;
    }

    await fundPositionRepository.update(existing.id, patch);

    const updated = await fundPositionRepository.getById(existing.id);
    if (!updated) {
      return apiFail("NOT_FOUND", "未找到该持仓记录。", 404);
    }

    const [valuation] = await valueFundPositions([updated]);
    return apiOk(valuation);
  } catch (error) {
    return apiDatasourceFailure(error) ?? apiUnexpected(error);
  }
}