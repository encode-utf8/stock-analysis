import { apiFail } from "@/lib/api-response";
import { readBackgroundImage } from "@/lib/ui-background-store";

// 背景图片输出接口：文件名走白名单校验，避免越权读取任意文件。

type RouteContext = { params: Promise<{ file: string }> };

/** GET /api/ui/background/image/[file]：返回图片二进制。 */
export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { file } = await context.params;
  const image = await readBackgroundImage(file);
  if (!image) {
    return apiFail("NOT_FOUND", "背景图片不存在。", 404);
  }

  return new Response(new Uint8Array(image.data), {
    headers: {
      "Content-Type": image.contentType,
      // 文件名随每次上传变化，可安全长缓存。
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
