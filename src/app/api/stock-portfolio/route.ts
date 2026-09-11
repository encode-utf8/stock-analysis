import { apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import { resolveVerifyVerdict } from "@/lib/code-verify";
import { verifyStockCode } from "@/lib/data-service";
import {
  buildHolding,
  buildPortfolioSnapshot,
  stockPortfolioRepository,
  validateHoldingInput,
  valueHoldings,
} from "@/lib/stock-portfolio";
import type { StockHoldingInput } from "@/lib/shared/types";

import type { NextRequest } from "next/server";

/** 读取 JSON 请求体；非法 JSON 返回 null。 */
async function readJson(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** GET /api/stock-portfolio：返回持仓估值与组合汇总。 */
export async function GET(): Promise<Response> {
  try {
    const holdings = await stockPortfolioRepository.list();
    return apiOk(buildPortfolioSnapshot(await valueHoldings(holdings)));
  } catch (error) {
    return apiUnexpected(error);
  }
}

/** POST /api/stock-portfolio：新增持仓。 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = await readJson(request);
    if (!body) {
      return apiFail("BAD_REQUEST", "请求体不是合法 JSON。", 400);
    }

    const result = validateHoldingInput(body as unknown as StockHoldingInput);
    if ("error" in result) {
      return apiFail("VALIDATION_ERROR", result.error, 400);
    }

    const { code, amount, profit, note } = result.value;
    if (await stockPortfolioRepository.getByCode(code)) {
      return apiFail("VALIDATION_ERROR", "该股票已在持仓中，请直接修改金额与收益。", 409);
    }

    // 与自选池一致：写入前确认代码在上游有数据，上游不可用时放行。
    const verdict = resolveVerifyVerdict(await verifyStockCode(code), "stock", code);
    if (verdict.blocked) {
      return apiFail("CODE_NOT_FOUND", verdict.message, 400);
    }

    const holding = buildHolding({ code, amount, profit, note }, verdict.name);
    await stockPortfolioRepository.add(holding);

    const [valuation] = await valueHoldings([holding]);
    return apiOk(valuation, { status: 201 });
  } catch (error) {
    return apiUnexpected(error);
  }
}