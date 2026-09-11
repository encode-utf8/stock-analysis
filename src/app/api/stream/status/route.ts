import { apiOk, apiUnexpected } from "@/lib/api-response";
import { getQuoteBusStatus } from "@/lib/quote-bus";

// 状态接口与 SSE 共享同一进程内单例，必须走 Node 运行时且不做静态缓存。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/stream/status：返回轮询器连接数、最近拉取时间与上游状态。 */
export async function GET(): Promise<Response> {
  try {
    return apiOk(getQuoteBusStatus());
  } catch (error) {
    return apiUnexpected(error);
  }
}
