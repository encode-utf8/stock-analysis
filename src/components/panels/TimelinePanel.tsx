"use client";

import { Button } from "@/components/ui/button";
import { formatDateTime, presentableConversationTitle } from "@/lib/format";
import type { Conversation } from "@/lib/shared/types";

interface TimelinePanelProps {
  conversations: Conversation[];
  conversationId: string | undefined;
  onSelectConversation: (id: string) => void;
}

/** 对话时间线回看面板。 */
export function TimelinePanel({
  conversations,
  conversationId,
  onSelectConversation,
}: TimelinePanelProps) {
  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold">对话时间线回看</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        点击历史会话即可加载对应消息，保留原始对话顺序。
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {conversations.length === 0 ? (
          <span className="text-sm text-muted-foreground">暂无历史会话。</span>
        ) : (
          conversations.map((conversation) => (
            <Button
              key={conversation.id}
              type="button"
              variant={conversation.id === conversationId ? "default" : "outline"}
              size="sm"
              title={`${conversation.code} · ${presentableConversationTitle(conversation.title)}`}
              onClick={() => onSelectConversation(conversation.id)}
            >
              {conversation.code} · {presentableConversationTitle(conversation.title)} · {formatDateTime(conversation.created_at)}
            </Button>
          ))
        )}
      </div>
    </section>
  );
}
