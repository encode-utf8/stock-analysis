import { apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import { applyDataConsistency, scanDataConsistency } from "@/lib/data-consistency";

import type { NextRequest } from "next/server";

// 数据一致性清理接口：GET 只读扫描，POST 执行回填与清除。

/** GET /api/admin/data-consistency：扫描本地降级数据与数据库的差异，返回清理计划。 */
export async function GET(): Promise<Response> {
  try {
    return apiOk(await scanDataConsistency());
  } catch (error) {
    return apiUnexpected(error);
  }
}

/**
 * POST /api/admin/data-consistency：执行清理。
 * body 传 `{ dry_run: true }` 时只返回扫描计划；数据库未就绪时返回 503 且不产生任何写入。
 */
export async function POST(request: NextRequest): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { dry_run?: boolean };

  try {
    if (body.dry_run) {
      return apiOk(await scanDataConsistency());
    }

    const result = await applyDataConsistency();
    if (result.blocked) {
      return apiFail("SERVICE_UNAVAILABLE", result.blocked, 503);
    }
    return apiOk(result);
  } catch (error) {
    return apiUnexpected(error);
  }
}