"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  formatDateTime,
  presentableConversationTitle,
  sanitizeChatText,
} from "@/lib/format";
import { normalizeFundCode } from "@/lib/fund-market";
import type {
  FundReplaySummary,
} from "@/lib/shared/types";
import type {
  FundReplayTimeline,
  FundReplayTimelineEvent,
} from "@/lib/fund-replay";

const DAY_OPTIONS = [7, 30, 90] as const;

interface ReplayApiPayload<T> {
  success?: boolean;
  data?: T;
  error?: { message?: string };
}

async function apiFetch<T>(url: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  const abortFromParent = () => controller.abort();
  signal?.addEventListener("abort", abortFromParent);
  try {
    const response = await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
    const payload = (await response.json().catch(() => null)) as ReplayApiPayload<T> | null;
    if (!payload?.success || payload.data === undefined) {
      throw new Error(payload?.error?.message ?? "基金复盘请求失败。");
    }
    return payload.data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("请求超时，请稍后重试。");
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromParent);
  }
}

/** 将 Markdown 或消息内容转为适合摘要卡片的纯文本。 */
function toPreviewText(content: string): string {
  return sanitizeChatText(content)
    .replace(/[#>*_`\[\]()~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

function FundTimelineEventCard({
  event,
  onDelete,
  deleting,
}: {
  event: FundReplayTimelineEvent;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [open, setOpen] = useState(false);
  const roleLabel: Record<string, string> = {
    user: "用户",
    assistant: "助手",
    system: "系统",
  };
  const previewText =
    event.type === "analysis"
      ? event.report.content
      : event.messages[0]?.content ?? "";
  const metaText =
    event.type === "analysis"
      ? `引用 ${event.report.source_refs.length} 项数据来源`
      : presentableConversationTitle(event.conversation.title);

  return (
    <>
      <div className="rounded-lg border p-3 transition hover:bg-muted/30">
        <button type="button" onClick={() => setOpen(true)} className="w-full text-left">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {event.type === "analysis" ? "AI 分析" : "对话"}
            </span>
            <span className="font-medium">{formatDateTime(event.occurred_at)}</span>
            <span className="text-xs text-muted-foreground">{metaText}</span>
          </div>
          <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">
            {toPreviewText(previewText) || "无内容"}
          </p>
        </button>
        <div className="mt-2 flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={onDelete} disabled={deleting}>
            {deleting ? "删除中..." : "删除记录"}
          </Button>
        </div>
      </div>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl"
            onClick={(nextEvent) => nextEvent.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
              <div>
                <h3 className="font-semibold">
                  {event.type === "analysis" ? "AI 分析详情" : "对话详情"}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDateTime(event.occurred_at)} · {metaText}
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                关闭
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {event.type === "analysis" ? (
                <MarkdownContent content={event.report.content} />
              ) : (
                <div className="space-y-3">
                  {event.messages.length === 0 ? (
                    <p className="text-sm text-muted-foreground">该会话暂无消息。</p>
                  ) : null}
                  {event.messages.map((message) => (
                    <div
                      key={message.id}
                      className={
                        "rounded-lg border p-3 " +
                        (message.role === "user" ? "bg-primary/5" : "bg-muted/20")
                      }
                    >
                      <div className="mb-1 text-xs font-medium text-muted-foreground">
                        {roleLabel[message.role] ?? message.role} · {formatDateTime(message.created_at)}
                      </div>
                      <div className="text-sm leading-6">
                        <MarkdownContent content={sanitizeChatText(message.content)} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

interface FundReplayPanelProps {
  code: string | null;
  refreshToken?: number;
  deletedReportId?: string | null;
}

/** 基金历史复盘面板：展示基金 AI 分析与对话时间线，仅用于学习。 */
export function FundReplayPanel({ code, refreshToken = 0, deletedReportId = null }: FundReplayPanelProps) {
  const [codeInput, setCodeInput] = useState(code ?? "");
  const [queryCode, setQueryCode] = useState<string | null>(code);
  const [days, setDays] = useState<number>(30);
  const [queryDays, setQueryDays] = useState<number>(30);
  const [queryNonce, setQueryNonce] = useState(0);
  const [stats, setStats] = useState<FundReplaySummary | null>(null);
  const [timeline, setTimeline] = useState<FundReplayTimeline | null>(null);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDeleteEvent, setPendingDeleteEvent] = useState<FundReplayTimelineEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visibleTimeline = deletedReportId && timeline
    ? {
        ...timeline,
        events: timeline.events.filter(
          (event) => !(event.type === 'analysis' && event.report.id === deletedReportId),
        ),
      }
    : timeline;

  const loadReplay = useCallback(
    async (nextCode: string, nextDays: number, isActive: () => boolean, signal?: AbortSignal) => {
      let lastError: string | null = null;
      const loadStats = async () => {
        try {
          const data = await apiFetch<FundReplaySummary>(
            `/api/fund-replay/stats?code=${encodeURIComponent(nextCode)}&days=${nextDays}`,
            undefined,
            signal,
          );
          if (isActive()) {
            setStats(data);
          }
        } catch (nextError) {
          if (isActive()) {
            setStats(null);
            lastError = nextError instanceof Error ? nextError.message : "基金复盘统计加载失败。";
          }
        }
      };
      const loadTimeline = async () => {
        try {
          const data = await apiFetch<FundReplayTimeline>(
            `/api/fund-replay/timeline?code=${encodeURIComponent(nextCode)}&days=${nextDays}`,
            undefined,
            signal,
          );
          if (isActive()) {
            setTimeline(data);
          }
        } catch (nextError) {
          if (isActive()) {
            setTimeline(null);
            lastError = nextError instanceof Error ? nextError.message : "基金复盘时间线加载失败。";
          }
        }
      };

      await Promise.all([loadStats(), loadTimeline()]);
      if (isActive()) {
        setError(lastError);
      }
    },
    [],
  );

  useEffect(() => {
    if (!queryCode) {
      return;
    }
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void loadReplay(queryCode, queryDays, () => active, controller.signal).finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    }, 0);
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [loadReplay, queryCode, queryDays, queryNonce, refreshToken]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextCode = normalizeFundCode(codeInput);
    if (!nextCode) {
      setError("请输入 6 位基金代码。");
      return;
    }
    setLoading(true);
    setError(null);
    setQueryDays(days);
    setQueryCode(nextCode);
    setQueryNonce((value) => value + 1);
  }

  const requestDeleteEvent = (event: FundReplayTimelineEvent) => {
    setPendingDeleteEvent(event);
  };

  const handleDeleteEvent = async (event: FundReplayTimelineEvent) => {
    const isAnalysis = event.type === "analysis";
    setPendingDeleteEvent(null);
    setDeletingId(event.id);
    setError(null);
    try {
      const url = isAnalysis
        ? `/api/funds/${encodeURIComponent(event.code)}/reports/${encodeURIComponent(event.report.id)}`
        : `/api/fund-conversations/${encodeURIComponent(event.conversation.id)}`;
      await apiFetch<{ id: string }>(url, { method: "DELETE" });
      await loadReplay(queryCode ?? event.code, queryDays, () => true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "基金记录删除失败。");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">基金历史复盘</h2>
          <p className="text-xs text-muted-foreground">
            展示当前基金的历史 AI 分析与对话时间线，仅用于学习，不构成投资建议。
          </p>
        </div>
        <span className="rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
          仅供学习
        </span>
      </div>

      <form onSubmit={handleSubmit} className="mb-4 flex flex-wrap gap-2">
        <input
          value={codeInput}
          onChange={(event) => setCodeInput(event.target.value)}
          placeholder="输入 6 位基金代码"
          maxLength={6}
          inputMode="numeric"
          className="w-40 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
        />
        <select
          value={days}
          onChange={(event) => {
            setError(null);
            setDays(Number(event.target.value));
          }}
          className="rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
        >
          {DAY_OPTIONS.map((option) => (
            <option key={option} value={option}>
              最近 {option} 天
            </option>
          ))}
        </select>
        <Button type="submit" disabled={loading}>
          {loading ? "加载中..." : "查询复盘"}
        </Button>
      </form>

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading && !stats && !timeline ? (
        <div className="mb-4 flex items-center gap-2 rounded-lg border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          正在加载基金复盘数据...
        </div>
      ) : null}

      {stats ? (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">分析次数</p>
              <p className="mt-1 text-2xl font-semibold">{stats.total_analysis}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">对话次数</p>
              <p className="mt-1 text-2xl font-semibold">{stats.total_chats}</p>
            </div>
          </div>
          <div className="mb-4 space-y-1 rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
            <p>
              统计范围：{formatDateTime(stats.period_start)} 至 {formatDateTime(stats.period_end)}
            </p>
            <p>分析次数 = 时间段内创建的基金 AI 报告数；对话次数 = 时间段内创建的基金会话数。</p>
            <p>统计结果仅供学习参考，不构成投资建议，不代表未来收益。</p>
          </div>
        </>
      ) : null}

      {visibleTimeline ? (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-medium">历史分析与对话时间线</h3>
            <span className="text-xs text-muted-foreground">{visibleTimeline.events.length} 个事件</span>
          </div>
          <div className="space-y-3">
            {visibleTimeline.events.length === 0 ? (
              <p className="text-sm text-muted-foreground">该时间段内暂无分析与对话记录。</p>
            ) : (
              visibleTimeline.events.map((event) => (
                <FundTimelineEventCard
                  key={`${event.type}-${event.id}`}
                  event={event}
                  onDelete={() => requestDeleteEvent(event)}
                  deleting={deletingId === event.id}
                />
              ))
            )}
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDeleteEvent)}
        title="确认删除基金复盘记录"
        description={
          pendingDeleteEvent
            ? `确认删除${pendingDeleteEvent.type === "analysis" ? "该 AI 分析记录" : "该对话记录"}吗？`
            : ""
        }
        loading={Boolean(deletingId)}
        onCancel={() => setPendingDeleteEvent(null)}
        onConfirm={() => {
          if (pendingDeleteEvent) {
            void handleDeleteEvent(pendingDeleteEvent);
          }
        }}
      />
    </section>
  );
}
