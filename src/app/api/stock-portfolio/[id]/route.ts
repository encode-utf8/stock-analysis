import { apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import { stockPortfolioRepository, validateHoldingUpdate, valueHoldings } from "@/lib/stock-portfolio";
import type { StockHoldingUpdateInput } from "@/lib/shared/types";

import type { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ id: string }> };

/** PATCH /api/stock-portfolio/:id：修改投入金额、持仓收益或备注。 */
export async function PATCH(request: NextRequest, context: RouteContext): Promise<Response> {
  try {
    const id = (await context.params).id;
    const existing = await stockPortfolioRepository.getById(id);
    if (!existing) {
      return apiFail("NOT_FOUND", "未找到该持仓记录。", 404);
    }

    const body = (await request.json().catch(() => null)) as StockHoldingUpdateInput | null;
    if (!body) {
      return apiFail("BAD_REQUEST", "请求体不是合法 JSON。", 400);
    }

    const result = validateHoldingUpdate(body);
    if ("error" in result) {
      return apiFail("VALIDATION_ERROR", result.error, 400);
    }

    await stockPortfolioRepository.update(id, result.value);
    const updated = await stockPortfolioRepository.getById(id);
    if (!updated) {
      return apiFail("NOT_FOUND", "未找到该持仓记录。", 404);
    }

    const [valuation] = await valueHoldings([updated]);
    return apiOk(valuation);
  } catch (error) {
    return apiUnexpected(error);
  }
}

/** DELETE /api/stock-portfolio/:id：删除持仓。 */
export async function DELETE(_request: NextRequest, context: RouteContext): Promise<Response> {
  try {
    const id = (await context.params).id;
    if (!(await stockPortfolioRepository.getById(id))) {
      return apiFail("NOT_FOUND", "未找到该持仓记录。", 404);
    }
    await stockPortfolioRepository.remove(id);
    return apiOk({ id });
  } catch (error) {
    return apiUnexpected(error);
  }
}