import { apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import { alertRepository } from "@/lib/alert-store";
import { resolveVerifyVerdict } from "@/lib/code-verify";
import { verifyFundCode } from "@/lib/data-service";
import { repairWatchlistNames } from "@/lib/watchlist-name-repair";
import {
  buildFundWatchlistItem,
  fundWatchlistRepository,
  type FundWatchlistAddInput,
  type FundWatchlistNoteInput,
  type FundWatchlistReorderInput,
} from "@/lib/fund-watchlist";

import type { NextRequest } from "next/server";

/** 读取 JSON 请求体；非法 JSON 返回 null。 */
async function readJson(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** GET /api/fund-watchlist：返回按 sort_order 排序的自选基金列表。 */
export async function GET(): Promise<Response> {
  try {
    const items = await fundWatchlistRepository.list();
    // 历史数据可能存着「基金 xxxxxx」占位名，读取时用上游真实名称自愈。
    const repaired = await repairWatchlistNames(
      items,
      "fund",
      verifyFundCode,
      (code, name) => fundWatchlistRepository.updateName(code, name),
    );
    return apiOk(repaired);
  } catch (error) {
    return apiUnexpected(error);
  }
}

/** POST /api/fund-watchlist：新增自选基金。 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = await readJson(request);
    if (!body || typeof body.code !== "string") {
      return apiFail("BAD_REQUEST", "请求体缺少基金代码。", 400);
    }

    const result = buildFundWatchlistItem(body as unknown as FundWatchlistAddInput);
    if ("error" in result) {
      return apiFail("VALIDATION_ERROR", result.error, 400);
    }

    const item = result.item;
    if (await fundWatchlistRepository.getByCode(item.code)) {
      return apiFail("VALIDATION_ERROR", "该基金已在自选基金中。", 409);
    }

    // 写入前先向上游确认该代码确有数据，避免把无数据的代码加入自选池。
    const verdict = resolveVerifyVerdict(
      await verifyFundCode(item.code),
      "fund",
      item.code,
    );
    if (verdict.blocked) {
      return apiFail("CODE_NOT_FOUND", verdict.message, 400);
    }
    if (verdict.name) {
      // 用上游真实名称回填，避免显示「基金 xxxxxx」这类占位名称。
      item.name = verdict.name;
    }

    const items = await fundWatchlistRepository.list();
    item.sort_order = items.reduce(
      (max, current) => Math.max(max, current.sort_order),
      -1,
    ) + 1;
    await fundWatchlistRepository.add(item);

    return apiOk(item, { status: 201 });
  } catch (error) {
    return apiUnexpected(error);
  }
}

/** PATCH /api/fund-watchlist：更新某只自选基金的备注。 */
export async function PATCH(request: NextRequest): Promise<Response> {
  try {
    const body = await readJson(request);
    if (!body || typeof body.code !== "string") {
      return apiFail("BAD_REQUEST", "请求体缺少基金代码。", 400);
    }

    const input = body as unknown as FundWatchlistNoteInput;
    if (!(await fundWatchlistRepository.getByCode(input.code))) {
      return apiFail("NOT_FOUND", "自选基金不存在。", 404);
    }

    const note =
      typeof input.note === "string" && input.note.trim() ? input.note.trim() : null;
    await fundWatchlistRepository.updateNote(input.code, note);

    return apiOk(await fundWatchlistRepository.getByCode(input.code));
  } catch (error) {
    return apiUnexpected(error);
  }
}

/** PUT /api/fund-watchlist：按给定顺序保存完整自选基金排序。 */
export async function PUT(request: NextRequest): Promise<Response> {
  try {
    const body = await readJson(request);
    const codes = (body as FundWatchlistReorderInput | null)?.codes;

    if (!Array.isArray(codes) || codes.some((code) => typeof code !== "string")) {
      return apiFail("BAD_REQUEST", "请求体缺少合法的 codes 数组。", 400);
    }

    const normalizedCodes = codes.map((code) => code.trim());
    if (normalizedCodes.some((code) => !/^\d{6}$/.test(code))) {
      return apiFail("VALIDATION_ERROR", "排序列表包含非法基金代码。", 400);
    }

    const existing = await fundWatchlistRepository.list();
    const existingCodes = existing.map((item) => item.code).sort();
    const requestedCodes = [...normalizedCodes].sort();
    if (
      existingCodes.length !== requestedCodes.length ||
      existingCodes.some((code, index) => code !== requestedCodes[index])
    ) {
      return apiFail("VALIDATION_ERROR", "排序列表必须包含当前全部自选基金。", 400);
    }

    await fundWatchlistRepository.reorder(normalizedCodes);
    return apiOk(await fundWatchlistRepository.list());
  } catch (error) {
    return apiUnexpected(error);
  }
}

/** DELETE /api/fund-watchlist?code=：删除自选基金。 */
export async function DELETE(request: NextRequest): Promise<Response> {
  try {
    const code = request.nextUrl.searchParams.get("code") ?? "";
    if (!/^\d{6}$/.test(code.trim())) {
      return apiFail("VALIDATION_ERROR", "请输入合法的基金代码。", 400);
    }

    const normalizedCode = code.trim();
    if (!(await fundWatchlistRepository.getByCode(normalizedCode))) {
      return apiFail("NOT_FOUND", "自选基金不存在。", 404);
    }

    await fundWatchlistRepository.remove(normalizedCode);
    // 标的已移出自选池，对应预警规则自动停用，避免扫描无效标的。
    await alertRepository.disableRulesByCode("fund", normalizedCode);
    return apiOk({ code: normalizedCode });
  } catch (error) {
    return apiUnexpected(error);
  }
}
