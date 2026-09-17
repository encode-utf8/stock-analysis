"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { NoticeDialog } from "@/components/ui/notice-dialog";
import { Toast } from "@/components/ui/toast";
import { CodeNotFoundError } from "@/lib/code-verify";
import { normalizeStockCode } from "@/lib/market";
import { useRealtimeQuotes } from "@/lib/realtime-quote-client";
import { emitWatchlistChange } from "@/lib/watchlist-bus";
import { matchesWatchlistKeyword } from "@/lib/watchlist-filter";
import type { WatchlistItem } from "@/lib/shared/types";

const DEFAULT_GROUP = "默认";

/** 统一响应包装结构。 */
interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

/** 读取统一 JSON 响应并抛出可展示错误。 */
async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
    if (!payload?.success || payload.data === undefined) {
      const message = payload?.error?.message ?? "自选股请求失败。";
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

/** 将交易所代码转换为中文标签。 */
function exchangeLabel(exchange: string): string {
  if (exchange === "SH") return "上海";
  if (exchange === "SZ") return "深圳";
  if (exchange === "BJ") return "北京";
  return exchange;
}

/** 空分组或旧数据缺省分组统一归入默认分组。 */
function normalizeGroup(group: string | null | undefined): string {
  return group?.trim() || DEFAULT_GROUP;
}

interface WatchlistSidebarProps {
  activeCode: string | null;
  onSelect: (code: string) => void;
  onClearActive?: () => void;
}

/** 左侧自选股组件：新增、删除、排序、备注，并按分组展开收起。 */
export function WatchlistSidebar({
  activeCode,
  onSelect,
  onClearActive,
}: WatchlistSidebarProps) {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [codeInput, setCodeInput] = useState("");
  const [groupInput, setGroupInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  // 自选股可能很多：添加表单默认收起，列表支持关键字过滤与内部滚动，避免侧栏被撑长。
  const [filterInput, setFilterInput] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDeleteCode, setPendingDeleteCode] = useState<string | null>(null);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  // 上游查不到代码时的提示弹窗文案。
  const [notice, setNotice] = useState<string | null>(null);
  // 实时行情由全局单例统一建连，这里只读取快照用于列表展示。
  const { items: realtimeItems } = useRealtimeQuotes();
  const realtimeByCode = new Map(
    realtimeItems
      .filter((quote) => quote.target === "stock")
      .map((quote) => [quote.code, quote] as const),
  );

  const showToast = (message: string) => {
    setToast({ id: Date.now(), message });
  };

  const loadWatchlist = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<WatchlistItem[]>("/api/watchlist");
      setItems(
        data.map((item) => ({
          ...item,
          group: normalizeGroup(item.group),
        })),
      );
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "自选股加载失败。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadWatchlist();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadWatchlist]);

  const handleAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = codeInput.trim();
    if (!code) {
      setError("请输入要添加的股票代码。");
      return;
    }

    const normalizedCode = normalizeStockCode(code);
    if (!normalizedCode) {
      showToast("请输入合法的沪深北 A 股代码（6 位数字）。");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await apiFetch<WatchlistItem>("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: normalizedCode,
          note: noteInput,
          group: groupInput,
        }),
      });
      setCodeInput("");
      setGroupInput("");
      setNoteInput("");
      await loadWatchlist();
      // 通知预警面板等订阅方：自选股已变化，立即刷新可选标的。
      emitWatchlistChange("stock");
    } catch (nextError) {
      if (nextError instanceof CodeNotFoundError) {
        // 无数据类错误用弹窗告知，避免只显示为一行小字被忽略。
        setNotice(nextError.message);
      } else {
        setError(nextError instanceof Error ? nextError.message : "添加自选股失败。");
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
      await apiFetch<{ code: string }>(`/api/watchlist?code=${encodeURIComponent(code)}`, {
        method: "DELETE",
      });
      if (activeCode === code) {
        onClearActive?.();
      }
      await loadWatchlist();
      emitWatchlistChange("stock");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "删除自选股失败。");
    } finally {
      setSaving(false);
    }
  };

  const requestDelete = (code: string) => {
    setPendingDeleteCode(code);
  };

  const handleMove = async (code: string, offset: -1 | 1) => {
    const index = items.findIndex((item) => item.code === code);
    const targetIndex = index + offset;
    if (index < 0 || targetIndex < 0 || targetIndex >= items.length) {
      return;
    }

    const nextItems = [...items];
    [nextItems[index], nextItems[targetIndex]] = [
      nextItems[targetIndex],
      nextItems[index],
    ];
    setItems(nextItems);
    setError(null);

    try {
      const ordered = await apiFetch<WatchlistItem[]>("/api/watchlist", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes: nextItems.map((item) => item.code) }),
      });
      setItems(
        ordered.map((item) => ({
          ...item,
          group: normalizeGroup(item.group),
        })),
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "排序保存失败。");
      await loadWatchlist();
    }
  };

  const startEdit = (item: WatchlistItem) => {
    setEditingCode(item.code);
    setEditingNote(item.note ?? "");
  };

  const cancelEdit = () => {
    setEditingCode(null);
    setEditingNote("");
  };

  const saveNote = async () => {
    if (!editingCode) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await apiFetch<WatchlistItem>("/api/watchlist", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: editingCode, note: editingNote }),
      });
      await loadWatchlist();
      cancelEdit();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "备注保存失败。");
    } finally {
      setSaving(false);
    }
  };

  const handleSelect = (code: string) => {
    setError(null);
    onSelect(code);
  };

  // 自选为空时（首次使用或删空）添加表单保持展开，避免还要多点一次。
  const addFormOpen = showAddForm || items.length === 0;
  // 关键字同时匹配代码、名称、备注与分组，便于自选很多时快速定位。
  const visibleItems = items.filter((item) =>
    matchesWatchlistKeyword(
      [item.code, item.name, item.note, normalizeGroup(item.group)],
      filterInput,
    ),
  );

  const groups = Array.from(
    new Set(visibleItems.map((item) => normalizeGroup(item.group))),
  ).sort((a, b) => {
    if (a === DEFAULT_GROUP) return -1;
    if (b === DEFAULT_GROUP) return 1;
    return a.localeCompare(b);
  });

  const toggleGroup = (group: string) => {
    setCollapsedGroups((previous) => ({
      ...previous,
      [group]: !previous[group],
    }));
  };

  return (
    <section className="space-y-2" data-testid="watchlist-sidebar">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-baseline gap-1.5 text-sm font-semibold">
          自选股
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

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
          <button
            type="button"
            className="ml-2 text-red-400 hover:text-red-400"
            onClick={() => setError(null)}
            aria-label="关闭错误提示"
          >
            ×
          </button>
        </div>
      ) : null}

      {addFormOpen ? (
      <form onSubmit={handleAdd} className="space-y-2">
        <input
          value={codeInput}
          onChange={(event) => setCodeInput(event.target.value)}
          placeholder="输入 6 位代码，如 600519"
          className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          aria-label="自选股代码"
        />
        <input
          value={groupInput}
          onChange={(event) => setGroupInput(event.target.value)}
          placeholder="分组（默认）"
          className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          aria-label="自选股分组"
        />
        <input
          value={noteInput}
          onChange={(event) => setNoteInput(event.target.value)}
          placeholder="备注（可选）"
          className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          aria-label="自选股备注"
        />
        <Button type="submit" className="w-full" disabled={saving || !codeInput.trim()}>
          {saving ? "保存中..." : "添加自选股"}
        </Button>
      </form>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">自选股加载中...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无自选股，先添加一只试试。</p>
      ) : (
        <div className="space-y-2">
          <input
            value={filterInput}
            onChange={(event) => setFilterInput(event.target.value)}
            placeholder="搜索代码 / 名称 / 备注 / 分组"
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            aria-label="筛选自选股"
          />
          {visibleItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">没有匹配的自选股。</p>
          ) : null}
          {/* 列表内部滚动：自选再多也不会把侧栏撑长。 */}
          <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
          {groups.map((group) => {
            const groupItems = visibleItems.filter(
              (item) => normalizeGroup(item.group) === group,
            );
            const collapsed = collapsedGroups[group] ?? false;

            return (
              <div key={group} className="rounded-lg border">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-t-lg px-3 py-2 text-left hover:bg-muted/40"
                  onClick={() => toggleGroup(group)}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {group}
                    <span className="text-xs text-muted-foreground">
                      {groupItems.length}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {collapsed ? "展开" : "收起"}
                  </span>
                </button>

                {!collapsed ? (
                  <ul className="space-y-2 border-t p-2">
                    {groupItems.map((item) => {
                      const isActive = activeCode === item.code;
                      const isEditing = editingCode === item.code;
                      const quote = realtimeByCode.get(item.code);
                      const quoteClass = !quote
                        ? ""
                        : quote.change_pct > 0
                          ? "text-red-400"
                          : quote.change_pct < 0
                            ? "text-emerald-400"
                            : "text-muted-foreground";
                      const index = items.findIndex(
                        (candidate) => candidate.code === item.code,
                      );

                      return (
                        <li
                          key={item.code}
                          className={`rounded-md border p-2 ${
                            isActive
                              ? "border-primary bg-primary/5 ring-1 ring-primary"
                              : "border-border bg-background"
                          }`}
                        >
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              className="min-w-0 flex-1 rounded px-1 py-1 text-left hover:bg-accent"
                              onClick={() => handleSelect(item.code)}
                            >
                              <div className="flex items-center gap-1.5">
                                <span className="truncate text-sm font-medium">
                                  {item.name}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {item.code}
                                </span>
                                <span className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                                  {exchangeLabel(item.exchange)}
                                </span>
                              </div>
                              {quote ? (
                                <p className="mt-0.5 flex items-center gap-1.5 text-xs">
                                  <span className={quoteClass}>{quote.price.toFixed(2)}</span>
                                  <span className={quoteClass}>
                                    {quote.change_pct > 0 ? "+" : ""}
                                    {quote.change_pct.toFixed(2)}%
                                  </span>
                                  <span className="rounded bg-emerald-500/10 px-1 text-[10px] text-emerald-300">
                                    实时
                                  </span>
                                </p>
                              ) : null}
                              {item.note ? (
                                <p className="mt-1 truncate text-xs text-muted-foreground">
                                  {item.note}
                                </p>
                              ) : null}
                            </button>
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                type="button"
                                className="rounded border px-1.5 py-1 text-xs hover:bg-accent disabled:opacity-40"
                                disabled={index === 0}
                                onClick={() => void handleMove(item.code, -1)}
                                aria-label={`上移 ${item.code}`}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className="rounded border px-1.5 py-1 text-xs hover:bg-accent disabled:opacity-40"
                                disabled={index === items.length - 1}
                                onClick={() => void handleMove(item.code, 1)}
                                aria-label={`下移 ${item.code}`}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                className="rounded border px-1.5 py-1 text-xs hover:bg-accent"
                                onClick={() => startEdit(item)}
                              >
                                备注
                              </button>
                              <button
                                type="button"
                                className="rounded border px-1.5 py-1 text-xs text-red-400 hover:bg-red-500/10"
                                disabled={saving}
                                onClick={() => requestDelete(item.code)}
                              >
                                删除
                              </button>
                            </div>
                          </div>
                          {isEditing ? (
                            <div className="mt-2 flex gap-1">
                              <input
                                value={editingNote}
                                onChange={(event) => setEditingNote(event.target.value)}
                                className="min-w-0 flex-1 rounded-md border px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-primary"
                                aria-label={`编辑 ${item.code} 备注`}
                              />
                              <button
                                type="button"
                                className="rounded border px-1.5 py-1 text-xs hover:bg-accent"
                                disabled={saving}
                                onClick={() => void saveNote()}
                              >
                                保存
                              </button>
                              <button
                                type="button"
                                className="rounded border px-1.5 py-1 text-xs hover:bg-accent"
                                onClick={cancelEdit}
                              >
                                取消
                              </button>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            );
          })}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(pendingDeleteCode)}
        title="确认删除自选股"
        description={pendingDeleteCode ? `确认删除自选股 ${pendingDeleteCode} 吗？` : ""}
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
