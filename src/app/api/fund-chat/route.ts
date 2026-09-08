import { apiFail } from "@/lib/api-response";
import { streamFundChat } from "@/lib/fund-chat";
import { normalizeFundCode } from "@/lib/fund-market";
import { recordTaskRun } from "@/lib/observability";

import type { NextRequest } from "next/server";
import type { ChatStreamEvent } from "@/lib/shared/types";

const encoder = new TextEncoder();

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// POST /api/fund-chat：SSE 流式基金对话。
export async function POST(request: NextRequest): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    code?: string;
    conversationId?: string;
    message?: string;
  } | null;

  const code = body?.code ? normalizeFundCode(body.code) : null;
  const message = body?.message?.trim();
  if (!code || !message) {
    return apiFail("VALIDATION_ERROR", "请提供基金代码与对话内容。", 400);
  }

  recordTaskRun("chat");

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => {
        controller.enqueue(encoder.encode(sse(event)));
      };

      try {
        for await (const event of streamFundChat(
          { code, conversationId: body?.conversationId, message },
          request.signal,
        )) {
          send(event);
        }
      } catch (error) {
        send({
          type: "error",
          data: { message: error instanceof Error ? error.message : "基金对话生成失败。" },
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
