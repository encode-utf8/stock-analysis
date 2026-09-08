import { apiFail } from "@/lib/api-response";
import { streamFundAnalysis } from "@/lib/fund-analysis";
import { normalizeFundCode } from "@/lib/fund-market";

import type { NextRequest } from "next/server";
import type { FundAnalysisStreamEvent } from "@/lib/shared/types";

type RouteContext = { params: Promise<{ code: string }> };

const encoder = new TextEncoder();

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// POST /api/funds/:code/analysis/stream：SSE 流式生成基金 AI 分析报告。
export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const rawCode = (await context.params).code;
  const code = normalizeFundCode(rawCode);
  if (!code) {
    return apiFail("VALIDATION_ERROR", "请输入 6 位基金代码。", 400);
  }

  const body = (await request.json().catch(() => ({}))) as { prompt?: string };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: FundAnalysisStreamEvent) => {
        controller.enqueue(encoder.encode(sse(event)));
      };

      try {
        for await (const event of streamFundAnalysis(code, body.prompt, request.signal)) {
          send(event);
        }
      } catch (error) {
        send({
          type: "error",
          data: { message: error instanceof Error ? error.message : "基金分析生成失败。" },
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
