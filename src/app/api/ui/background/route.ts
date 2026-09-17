import { apiOk, apiUnexpected } from "@/lib/api-response";
import { mergeBackgroundSettings, type BackgroundSettings } from "@/lib/ui-background";
import {
  readBackgroundSettings,
  removeBackgroundImage,
  writeBackgroundSettings,
} from "@/lib/ui-background-store";

import type { NextRequest } from "next/server";

// 背景画布与交互光效设置接口。

/** GET /api/ui/background：读取设置（缺失文件时返回默认值）。 */
export async function GET(): Promise<Response> {
  try {
    return apiOk(await readBackgroundSettings());
  } catch (error) {
    return apiUnexpected(error);
  }
}

/**
 * PUT /api/ui/background：局部更新设置。
 * 只覆盖请求体中显式出现的字段，越界数值会被夹到允许区间。
 */
export async function PUT(request: NextRequest): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as Partial<BackgroundSettings>;
    const current = await readBackgroundSettings();
    return apiOk(await writeBackgroundSettings(mergeBackgroundSettings(current, body)));
  } catch (error) {
    return apiUnexpected(error);
  }
}

/** DELETE /api/ui/background：清除自定义背景图片，其余设置保留。 */
export async function DELETE(): Promise<Response> {
  try {
    return apiOk(await removeBackgroundImage());
  } catch (error) {
    return apiUnexpected(error);
  }
}
