import { apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import { resolveVerifyVerdict } from "@/lib/code-verify";
import { verifyFundCode } from "@/lib/data-service";
import {
  buildFundPosition,
  buildFundPositionSnapshot,
  fundPositionRepository,
  validateFundPositionInput,
  valueFundPositions,
} from "@/lib/fund-position";
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
    return apiUnexpected(error);
  }
}

/** POST /api/fund-positions：新增持有基金（代码 + 当前持有金额 + 累计收益 + 累计收益口径）。 */
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

    const { code, amount, profit, profit_caliber, note } = result.value;
    if (await fundPositionRepository.getByCode(code)) {
      return apiFail("VALIDATION_ERROR", "该基金已在持有列表中，请直接修改持有金额与累计收益。", 409);
    }

    // 与自选池一致：写入前确认代码在上游有数据，上游不可用时放行。
    const verdict = resolveVerifyVerdict(await verifyFundCode(code), "fund", code);
    if (verdict.blocked) {
      return apiFail("CODE_NOT_FOUND", verdict.message, 400);
    }

    const position = buildFundPosition({ code, amount, profit, profit_caliber, note }, verdict.name);
    await fundPositionRepository.add(position);

    const [valuation] = await valueFundPositions([position]);
    return apiOk(valuation, { status: 201 });
  } catch (error) {
    return apiUnexpected(error);
  }
}