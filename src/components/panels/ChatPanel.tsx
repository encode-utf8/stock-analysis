"use client";

import { Button } from "@/components/ui/button";
import type { FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** 前端对话消息展示结构。 */
export interface ChatViewMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Array<{ title: string; url: string }>;
  riskNote?: string;
  tools?: Array<{ name: string; summary: string }>;
}

interface ChatPanelProps {
  code: string | null;
  conversationId: string | undefined;
  messages: ChatViewMessage[];
  input: string;
  loading: boolean;
  onInputChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

/** 对话助手面板。 */
export function ChatPanel({
  code,
  conversationId,
  messages,
  input,
  loading,
  onInputChange,
  onSubmit,
}: ChatPanelProps) {
  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">对话助手</h2>
        <span className="text-xs text-muted-foreground">
          {conversationId ? `会话 ${conversationId.slice(0, 12)}...` : "新会话"}
        </span>
      </div>
      <div className="mb-4 max-h-[420px] space-y-3 overflow-y-auto rounded-lg border bg-muted/20 p-3">
        {messages.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            可以追问“当前支撑位怎么看”或“这条政策逻辑是什么”。
          </p>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`max-w-[85%] rounded-lg border px-3 py-2 text-sm ${
                message.role === "user"
                  ? "ml-auto bg-primary text-primary-foreground"
                  : "bg-white"
              }`}
            >
              {message.content ? (
                message.role === "assistant" ? (
                  <div className="markdown-body">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {message.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap break-words font-sans leading-6">
                    {message.content}
                  </pre>
                )
              ) : (
                <span className="text-muted-foreground">思考中...</span>
              )}
              {message.tools?.length ? (
                <div className="mt-2 border-t pt-2 text-xs text-muted-foreground">
                  <p className="font-medium">工具调用</p>
                  <ul className="mt-1 list-disc pl-4">
                    {message.tools.map((tool) => (
                      <li key={`${tool.name}-${tool.summary}`}>
                        <span className="font-medium">{tool.name}</span>：{tool.summary}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {message.sources?.length ? (
                <div className="mt-2 border-t pt-2 text-xs text-muted-foreground">
                  来源：
                  {message.sources.map((source, index) => (
                    <a
                      key={`${source.url}-${index}`}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mr-2 text-primary hover:underline"
                    >
                      {source.title}
                    </a>
                  ))}
                </div>
              ) : null}
              {message.riskNote ? (
                <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                  {message.riskNote}
                </p>
              ) : null}
            </div>
          ))
        )}
      </div>
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          placeholder="围绕当前股票继续追问..."
          className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          disabled={!code || loading}
        />
        <Button type="submit" disabled={!code || loading || !input.trim()}>
          {loading ? "回复中..." : "发送"}
        </Button>
      </form>
    </section>
  );
}
