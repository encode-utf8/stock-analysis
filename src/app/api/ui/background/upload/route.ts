import { apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import {
  BACKGROUND_IMAGE_TYPES,
  MAX_BACKGROUND_IMAGE_BYTES,
  resolveBackgroundExtension,
} from "@/lib/ui-background";
import { saveBackgroundImage } from "@/lib/ui-background-store";

import type { NextRequest } from "next/server";

// 背景图片上传接口：只接受常见位图格式，且限制单张体积。

/** 允许的图片格式说明文字，用于错误提示。 */
const SUPPORTED_TYPES_TEXT = Object.keys(BACKGROUND_IMAGE_TYPES).join("、");

/** POST /api/ui/background/upload：上传图片并设为自定义背景。 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return apiFail("VALIDATION_ERROR", "请选择要上传的背景图片。", 400);
    }

    const extension = resolveBackgroundExtension(file.type);
    if (!extension) {
      return apiFail(
        "VALIDATION_ERROR",
        "仅支持 " + SUPPORTED_TYPES_TEXT + " 格式的图片。",
        400,
      );
    }

    if (file.size <= 0) {
      return apiFail("VALIDATION_ERROR", "图片内容为空，请重新选择。", 400);
    }

    if (file.size > MAX_BACKGROUND_IMAGE_BYTES) {
      const limit = Math.round(MAX_BACKGROUND_IMAGE_BYTES / 1024 / 1024);
      return apiFail("VALIDATION_ERROR", "图片体积需小于 " + limit + "MB。", 400);
    }

    const data = Buffer.from(await file.arrayBuffer());
    const settings = await saveBackgroundImage({
      data,
      extension,
      originalName: file.name,
    });
    return apiOk(settings);
  } catch (error) {
    return apiUnexpected(error);
  }
}
