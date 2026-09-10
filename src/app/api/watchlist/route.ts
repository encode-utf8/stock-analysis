import { apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import { alertRepository } from "@/lib/alert-store";
import {
  buildWatchlistItem,
  watchlistRepository,
  type WatchlistAddInput,
  type WatchlistNoteInput,
  type WatchlistReorderInput,
} from "@/lib/watchlist";

import type { NextRequest } from "next/server";

/** 读取 JSON 请求体；非法 JSON 返回 null。 */
async function readJson(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** GET /api/watchlist：返回按 sort_order 排序的自选股列表。 */
export async function GET(): Promise<Response> {
  try {
    return apiOk(await watchlistRepository.list());
  } catch (error) {
    return apiUnexpected(error);
  }
}

/** POST /api/watchlist：新增自选股。 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = await readJson(request);
    if (!body || typeof body.code !== "string") {
      return apiFail("BAD_REQUEST", "请求体缺少股票代码。", 400);
    }

    const result = buildWatchlistItem(body as unknown as WatchlistAddInput);
    if ("error" in result) {
      return apiFail("VALIDATION_ERROR", result.error, 400);
    }

    const item = result.item;
    if (await watchlistRepository.getByCode(item.code)) {
      return apiFail("VALIDATION_ERROR", "该股票已在自选股中。", 409);
    }

    const items = await watchlistRepository.list();
    item.sort_order = items.reduce(
      (max, current) => Math.max(max, current.sort_order),
      -1,
    ) + 1;
    await watchlistRepository.add(item);

    return apiOk(item, { status: 201 });
  } catch (error) {
    return apiUnexpected(error);
  }
}

/** PATCH /api/watchlist：更新某只自选股的备注。 */
export async function PATCH(request: NextRequest): Promise<Response> {
  try {
    const body = await readJson(request);
    if (!body || typeof body.code !== "string") {
      return apiFail("BAD_REQUEST", "请求体缺少股票代码。", 400);
    }

    const input = body as unknown as WatchlistNoteInput;
    if (!(await watchlistRepository.getByCode(input.code))) {
      return apiFail("NOT_FOUND", "自选股不存在。", 404);
    }

    const note =
      typeof input.note === "string" && input.note.trim() ? input.note.trim() : null;
    await watchlistRepository.updateNote(input.code, note);

    return apiOk(await watchlistRepository.getByCode(input.code));
  } catch (error) {
    return apiUnexpected(error);
  }
}

/** PUT /api/watchlist：按给定顺序保存完整自选股排序。 */
export async function PUT(request: NextRequest): Promise<Response> {
  try {
    const body = await readJson(request);
    const codes = (body as WatchlistReorderInput | null)?.codes;

    if (!Array.isArray(codes) || codes.some((code) => typeof code !== "string")) {
      return apiFail("BAD_REQUEST", "请求体缺少合法的 codes 数组。", 400);
    }

    const normalizedCodes = codes.map((code) => code.trim());
    if (normalizedCodes.some((code) => !/^\d{6}$/.test(code))) {
      return apiFail("VALIDATION_ERROR", "排序列表包含非法股票代码。", 400);
    }

    const existing = await watchlistRepository.list();
    const existingCodes = existing.map((item) => item.code).sort();
    const requestedCodes = [...normalizedCodes].sort();
    if (
      existingCodes.length !== requestedCodes.length ||
      existingCodes.some((code, index) => code !== requestedCodes[index])
    ) {
      return apiFail("VALIDATION_ERROR", "排序列表必须包含当前全部自选股。", 400);
    }

    await watchlistRepository.reorder(normalizedCodes);
    return apiOk(await watchlistRepository.list());
  } catch (error) {
    return apiUnexpected(error);
  }
}

/** DELETE /api/watchlist?code=：删除自选股。 */
export async function DELETE(request: NextRequest): Promise<Response> {
  try {
    const code = request.nextUrl.searchParams.get("code") ?? "";
    if (!/^\d{6}$/.test(code.trim())) {
      return apiFail("VALIDATION_ERROR", "请输入合法的股票代码。", 400);
    }

    const normalizedCode = code.trim();
    if (!(await watchlistRepository.getByCode(normalizedCode))) {
      return apiFail("NOT_FOUND", "自选股不存在。", 404);
    }

    await watchlistRepository.remove(normalizedCode);
    // 标的已移出自选池，对应预警规则自动停用，避免扫描无效标的。
    await alertRepository.disableRulesByCode("stock", normalizedCode);
    return apiOk({ code: normalizedCode });
  } catch (error) {
    return apiUnexpected(error);
  }
}
