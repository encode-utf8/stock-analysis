"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { NoticeDialog } from "@/components/ui/notice-dialog";
import { Toast } from "@/components/ui/toast";
import { CodeNotFoundError } from "@/lib/code-verify";
import { FUND_TYPE_LABELS, normalizeFundCode } from "@/lib/fund-market";
import { useRealtimeQuotes } from "@/lib/realtime-quote-client";
import { emitWatchlistChange } from "@/lib/watchlist-bus";
import { matchesWatchlistKeyword } from "@/lib/watchlist-filter";
import type { FundWatchlistItem } from "@/lib/shared/types";

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
    if (!payload?.success || payload.data === undefined) {
      const message = payload?.error?.message ?? "自选基金请求失败。";
      // 代码在上游查不到数据时抛出专用错误，交由界面弹窗提示。
      if (payload?.error?.code === "CODE_NOT_FOUND") {
        throw new CodeNotFoundError(message);
      }
      throw new Error(message);
    }
    return payload.data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("请求超时，请稍后重试。");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

interface FundWatchlistPanelProps {
  activeCode: string | null;
  onSelect: (code: string) => void;
  onClearActive?: () => void;
}

/** 基金工作台自选基金面板：新增、删除、备注与切换。 */
export function FundWatchlistPanel({
  activeCode,
  onSelect,
  onClearActive,
}: FundWatchlistPanelProps) {
  const [items, setItems] = useState<FundWatchlistItem[]>([]);
  const [codeInput, setCodeInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 自选基金可能很多：添加表单默认收起，列表支持关键字过滤与内部滚动，避免侧栏被撑长。
  const [filterInput, setFilterInput] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [pendingDeleteCode, setPendingDeleteCode] = useState<string | null>(null);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  // 上游查不到代码时的提示弹窗文案。
  const [notice, setNotice] = useState<string | null>(null);
  // 实时行情由全局单例统一建连，这里只读取基金快照用于列表展示。
  const { items: realtimeItems } = useRealtimeQuotes();
  const realtimeByCode = new Map(
    realtimeItems
      .filter((quote) => quote.target === "fund")
      .map((quote) => [quote.code, quote] as const),
  );

  const showToast = (message: string) => {
    setToast({ id: Date.now(), message });
  };

  const loadFundWatchlist = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<FundWatchlistItem[]>("/api/fund-watchlist");
      setItems(data);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "自选基金加载失败。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadFundWatchlist();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadFundWatchlist]);

  const handleAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = normalizeFundCode(codeInput);
    if (!code) {
      showToast("请输入合法的 6 位基金代码。");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await apiFetch<FundWatchlistItem>("/api/fund-watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, note: noteInput }),
      });
      setCodeInput("");
      setNoteInput("");
      await loadFundWatchlist();
      // 通知预警面板等订阅方：自选基金已变化，立即刷新可选标的。
      emitWatchlistChange("fund");
    } catch (nextError) {
      if (nextError instanceof CodeNotFoundError) {
        // 无数据类错误用弹窗告知，避免只显示为一行小字被忽略。
        setNotice(nextError.message);
      } else {
        setError(nextError instanceof Error ? nextError.message : "添加自选基金失败。");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (code: string) => {
    setPendingDeleteCode(null);
    setSaving(true);
    setError(null);
    try {
      await apiFetch<{ code: string }>(`/api/fund-watchlist?code=${encodeURIComponent(code)}`, {
        method: "DELETE",
      });
      if (activeCode === code) {
        onClearActive?.();
      }
      await loadFundWatchlist();
      emitWatchlistChange("fund");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "删除自选基金失败。");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (item: FundWatchlistItem) => {
    setEditingCode(item.code);
    setEditingNote(item.note ?? "");
  };

  const saveNote = async (code: string) => {
    setSaving(true);
    setError(null);
    try {
      await apiFetch<FundWatchlistItem>("/api/fund-watchlist", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, note: editingNote }),
      });
      setEditingCode(null);
      setEditingNote("");
      await loadFundWatchlist();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "更新备注失败。");
    } finally {
      setSaving(false);
    }
  };

  // 自选为空时（首次使用或删空）添加表单保持展开，避免还要多点一次。
  const addFormOpen = showAddForm || items.length === 0;
  // 关键字同时匹配代码、名称与备注，便于自选很多时快速定位。
  const visibleItems = items.filter((item) =>
    matchesWatchlistKeyword([item.code, item.name, item.note], filterInput),
  );

  return (
    <section className="space-y-3" data-testid="fund-watchlist-panel">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-baseline gap-1.5 text-sm font-semibold">
          自选基金
          <span className="text-xs font-normal text-muted-foreground">
            共 {items.length} 只
          </span>
        </h3>
        {/* 自选为空时添加表单保持常开，此时无需收起按钮。 */}
        {items.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowAddForm((previous) => !previous)}
            aria-expanded={addFormOpen}
            className="rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {addFormOpen ? "收起" : "＋ 添加"}
          </button>
        ) : null}
      </div>

      {addFormOpen ? (
      <form onSubmit={handleAdd} className="space-y-2">
        <input
          value={codeInput}
          onChange={(event) => setCodeInput(event.target.value)}
          placeholder="基金代码"
          maxLength={6}
          inputMode="numeric"
          className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
        />
        <input
          value={noteInput}
          onChange={(event) => setNoteInput(event.target.value)}
          placeholder="备注（可选）"
          className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
        />
        <Button type="submit" className="w-full" disabled={saving}>
          {saving ? "保存中" : "添加"}
        </Button>
      </form>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      <div className="space-y-2">
        {loading ? (
          <span className="text-sm text-muted-foreground">正在加载自选基金...</span>
        ) : null}
        {!loading && items.length === 0 ? (
          <span className="text-sm text-muted-foreground">暂无自选基金。</span>
        ) : null}
        {items.length > 0 ? (
          <input
            value={filterInput}
            onChange={(event) => setFilterInput(event.target.value)}
            placeholder="搜索代码 / 名称 / 备注"
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            aria-label="筛选自选基金"
          />
        ) : null}
        {!loading && items.length > 0 && visibleItems.length === 0 ? (
          <span className="text-sm text-muted-foreground">没有匹配的自选基金。</span>
        ) : null}
        {/* 列表内部滚动：自选再多也不会把侧栏撑长。 */}
        <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
        {visibleItems.map((item) => {
          const quote = realtimeByCode.get(item.code);
          // 涨跌按 A 股口径红涨绿跌，与个股自选保持一致。
          const quoteClass = !quote
            ? ""
            : quote.change_pct > 0
              ? "text-red-400"
              : quote.change_pct < 0
                ? "text-emerald-400"
                : "text-muted-foreground";
          return (
            <div
            key={item.code}
            className={
              "rounded-lg border p-2.5 transition-colors " +
              (activeCode === item.code
                ? "border-primary bg-primary/5"
                : "border-border bg-muted/50")
            }
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onSelect(item.code)}
                className="min-w-0 flex-1 rounded px-1 py-1 text-left hover:bg-accent"
              >
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{item.name}</span>
                  <span className="text-xs text-muted-foreground">{item.code}</span>
                </div>
                <div className={"mt-0.5 truncate text-xs " + (quoteClass || "text-muted-foreground")}>
                  {FUND_TYPE_LABELS[item.type] ?? item.type}
                  {quote
                    ? ` · 实时 ${quote.price.toFixed(4)} (${quote.change_pct > 0 ? "+" : ""}${quote.change_pct.toFixed(2)}%)`
                    : ""}
                </div>
                {item.note ? (
                  <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                    备注：{item.note}
                  </div>
                ) : null}
              </button>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => startEdit(item)}
                  className="rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted"
                >
                  备注
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDeleteCode(item.code)}
                  className="rounded px-1.5 py-1 text-xs text-red-400 hover:bg-red-500/10"
                >
                  删除
                </button>
              </div>
            </div>

            {editingCode === item.code ? (
              <div className="mt-2 flex gap-1.5">
                <input
                  value={editingNote}
                  onChange={(event) => setEditingNote(event.target.value)}
                  placeholder="输入备注"
                  className="min-w-0 flex-1 rounded-md border px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={saving}
                  onClick={() => void saveNote(item.code)}
                >
                  保存
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={saving}
                  onClick={() => {
                    setEditingCode(null);
                    setEditingNote("");
                  }}
                >
                  取消
                </Button>
              </div>
            ) : null}
          </div>
          );
        })}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(pendingDeleteCode)}
        title="删除自选基金"
        description={
          pendingDeleteCode
            ? `确认删除自选基金 ${pendingDeleteCode} 吗？`
            : ""
        }
        loading={saving}
        onCancel={() => setPendingDeleteCode(null)}
        onConfirm={() => {
          if (pendingDeleteCode) {
            void handleDelete(pendingDeleteCode);
          }
        }}
      />
      <NoticeDialog
        open={Boolean(notice)}
        title="当前无数据"
        description={notice ?? ""}
        onClose={() => setNotice(null)}
      />
      {toast ? <Toast key={toast.id} message={toast.message} /> : null}
    </section>
  );
}
