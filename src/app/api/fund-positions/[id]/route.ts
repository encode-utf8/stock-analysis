import { apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import {
  fundPositionRepository,
  validateFundPositionUpdate,
  valueFundPositions,
} from "@/lib/fund-position";
import type { FundPositionUpdateInput } from "@/lib/shared/types";

import type { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ id: string }> };

/** PATCH /api/fund-positions/:id：修改当前持有金额、累计收益、累计收益口径或备注。 */
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

    const result = validateFundPositionUpdate(body);
    if ("error" in result) {
      return apiFail("VALIDATION_ERROR", result.error, 400);
    }

    await fundPositionRepository.update(id, result.value);
    const updated = await fundPositionRepository.getById(id);
    if (!updated) {
      return apiFail("NOT_FOUND", "未找到该持仓记录。", 404);
    }

    const [valuation] = await valueFundPositions([updated]);
    return apiOk(valuation);
  } catch (error) {
    return apiUnexpected(error);
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
    return apiUnexpected(error);
  }
}