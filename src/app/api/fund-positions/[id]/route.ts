import { apiDatasourceFailure, apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import {
  fundPositionRepository,
  resolveCalibration,
  resolveEffectiveManualAnchor,
  resolveManualAnchor,
  validateFundPositionUpdate,
  valueFundPositions,
} from "@/lib/fund-position";
import { normalizeFundProfitCaliber } from "@/lib/fund-position-calc";
import type { FundPositionPatch } from "@/lib/fund-position";

import type { FundPositionUpdateInput } from "@/lib/shared/types";

import type { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ id: string }> };

/** PATCH /api/fund-positions/:id：修改持有金额、累计收益、口径、定投计划、手动校准或备注。 */

export async function PATCH(request: NextRequest, context: RouteContext): Promise<Response> {
  try {
    const id = (await context.params).id;
    const existing = await fundPositionRepository.getById(id);
    if (!existing) {
      return apiFail("NOT_FOUND", "未找到该持仓记录。", 404);
    }

    const body = (await request.json().catch(() => null)) as FundPositionUpdateInput | null;
    if (!body) {
      return apiFail("BAD_REQUEST", "请求体不是合法 JSON。", 400);
    }

    const result = validateFundPositionUpdate(body, existing);
    if ("error" in result) {
      return apiFail("VALIDATION_ERROR", result.error, 400);
    }

    // 校准入参需要结合当前净值折算成「份额 + 本金」基线后才能落库。
    const { calibration_input, ...rest } = result.value;
    const patch: FundPositionPatch = { ...rest };
    if (calibration_input !== undefined) {
      if (calibration_input === null) {
        patch.calibration = null;
      } else {
        const calibration = await resolveCalibration(existing.code, calibration_input);
        if (!calibration) {
          return apiFail("VALIDATION_ERROR", "暂时取不到该基金的净值，无法完成校准，请稍后重试。", 400);
        }
        patch.calibration = calibration;
      }
    }

    // 手动快照（金额 / 累计收益 / 口径）被改写时重算净值锚点：新值按今天的口径层级重新钉住。
    // 只改备注等字段时保留原锚点，避免把已结算的记录按今天重新解释。
    const snapshotChanged =
      (patch.amount !== undefined && patch.amount !== existing.amount) ||
      (patch.profit !== undefined && patch.profit !== existing.profit) ||
      (patch.profit_caliber !== undefined &&
        patch.profit_caliber !== normalizeFundProfitCaliber(existing.profit_caliber));
    if (existing.plan === null || patch.plan === null) {
      patch.manual_anchor = snapshotChanged
        ? await resolveManualAnchor(
            existing.code,
            patch.profit_caliber ?? normalizeFundProfitCaliber(existing.profit_caliber),
          )
        : // 快照没变：把当前生效的锚点固化下来，避免 updated_at 变化后按新日期重新推断
          await resolveEffectiveManualAnchor(existing);
    }

    await fundPositionRepository.update(id, patch);

    const updated = await fundPositionRepository.getById(id);
    if (!updated) {
      return apiFail("NOT_FOUND", "未找到该持仓记录。", 404);
    }

    const [valuation] = await valueFundPositions([updated]);
    return apiOk(valuation);
  } catch (error) {
    return apiDatasourceFailure(error) ?? apiUnexpected(error);
  }
}

/** DELETE /api/fund-positions/:id：删除持有基金。 */
export async function DELETE(_request: NextRequest, context: RouteContext): Promise<Response> {
  try {
    const id = (await context.params).id;
    if (!(await fundPositionRepository.getById(id))) {
      return apiFail("NOT_FOUND", "未找到该持仓记录。", 404);
    }
    await fundPositionRepository.remove(id);
    return apiOk({ id });
  } catch (error) {
    return apiDatasourceFailure(error) ?? apiUnexpected(error);
  }
}