import { isDataSourceUnavailableError } from "@/lib/datasource";
import { apiFail } from "@/lib/api-response";
import { streamAnalysis } from "@/lib/analysis";
import { normalizeStockCode } from "@/lib/market";

import type { NextRequest } from "next/server";
import type { AnalysisStreamEvent } from "@/lib/shared/types";
import type { NewsItem } from "@/lib/shared/types";

type RouteContext = { params: Promise<{ code: string }> };

const encoder = new TextEncoder();

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// POST /api/stocks/:code/analysis/stream：SSE 流式生成 AI 分析报告。
export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const rawCode = (await context.params).code;
  const code = normalizeStockCode(rawCode);
  if (!code) {
    return apiFail("VALIDATION_ERROR", "请输入 6 位沪深北 A 股代码。", 400);
  }

  const body = (await request.json().catch(() => ({}))) as {
    prompt?: string;
    news?: NewsItem[];
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AnalysisStreamEvent) => {
        controller.enqueue(encoder.encode(sse(event)));
      };

      try {
        for await (const event of streamAnalysis(code, body.prompt, body.news ?? [], request.signal)) {
          send(event);
        }
      } catch (error) {
        // 数据源故障时携带错误码与冷却时长，前端据此提示并禁用生成按钮。
        send({
          type: "error",
          data: {
            message: error instanceof Error ? error.message : "分析生成失败。",
            code: isDataSourceUnavailableError(error) ? "SERVICE_UNAVAILABLE" : undefined,
            retryAfterMs: isDataSourceUnavailableError(error) ? error.retryAfterMs : undefined,
          },
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
