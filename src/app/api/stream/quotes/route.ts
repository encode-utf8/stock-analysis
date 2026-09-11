import { apiFail } from "@/lib/api-response";
import { getLastQuoteSnapshot, subscribeQuotes } from "@/lib/quote-bus";

import type { AlertTarget, QuoteStreamEvent } from "@/lib/shared/types";
import type { NextRequest } from "next/server";

// SSE 必须运行在 Node 运行时并禁用静态化，否则会被当成普通 GET 缓存。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

/** 按 SSE 规范拼帧；事件名与 data 负载中的 type 保持一致，便于前端 addEventListener。 */
function sse(event: QuoteStreamEvent): Uint8Array {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

/**
 * GET /api/stream/quotes?codes=600519,000001&target=stock
 * 订阅自选池行情快照。所有连接共享服务端单例轮询器，上游请求不随连接数放大。
 */
export async function GET(request: NextRequest): Promise<Response> {
  const url = new URL(request.url);
  const target: AlertTarget = url.searchParams.get("target") === "fund" ? "fund" : "stock";
  const codes = (url.searchParams.get("codes") ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter((code) => /^\d{6}$/.test(code));
  const uniqueCodes = [...new Set(codes)];

  if (uniqueCodes.length === 0) {
    return apiFail("VALIDATION_ERROR", "请提供至少一个 6 位标的代码。", 400);
  }

  const subscription = { codes: uniqueCodes, target };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: QuoteStreamEvent) => {
        if (closed) {
          return;
        }
        try {
          controller.enqueue(sse(event));
        } catch {
          closed = true;
        }
      };

      // 建连即回放最近一次快照，避免用户开启开关后要等一个完整 tick 才有数据。
      const replay = getLastQuoteSnapshot(subscription);
      if (replay) {
        send(replay);
      }

      const unsubscribe = subscribeQuotes(subscription, send);
      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        unsubscribe();
        try {
          controller.close();
        } catch {
          // 连接已被对端关闭时忽略。
        }
      };
      if (request.signal.aborted) {
        // 建连前就已断开（例如用户瞬间切换页面）时直接清理，避免泄漏订阅。
        close();
      } else {
        request.signal.addEventListener("abort", close);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
