"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Toast } from "@/components/ui/toast";
import { FUND_TRADING_MODE_LABELS, FUND_TYPE_LABELS, normalizeFundCode } from "@/lib/fund-market";
import type { FundWatchlistItem } from "@/lib/shared/types";

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { message?: string };
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
    if (!payload?.success || payload.data === undefined) {
      throw new Error(payload?.error?.message ?? "自选基金请求失败。");
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
  const [pendingDeleteCode, setPendingDeleteCode] = useState<string | null>(null);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);

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
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "添加自选基金失败。");
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

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">自选基金</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            添加常看的基金，点击即可切换全链路上下文。
          </p>
        </div>
        <form onSubmit={handleAdd} className="flex flex-wrap items-center gap-2">
          <input
            value={codeInput}
            onChange={(event) => setCodeInput(event.target.value)}
            placeholder="基金代码"
            maxLength={6}
            inputMode="numeric"
            className="w-28 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
          <input
            value={noteInput}
            onChange={(event) => setNoteInput(event.target.value)}
            placeholder="备注（可选）"
            className="w-40 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
          <Button type="submit" disabled={saving}>
            {saving ? "保存中" : "添加"}
          </Button>
        </form>
      </div>

      {error ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {loading ? (
          <span className="text-sm text-muted-foreground">正在加载自选基金...</span>
        ) : null}
        {!loading && items.length === 0 ? (
          <span className="text-sm text-muted-foreground">暂无自选基金，可添加基金代码。</span>
        ) : null}
        {items.map((item) => (
          <div
            key={item.code}
            className={
              "min-w-[220px] rounded-lg border p-3 transition-colors " +
              (activeCode === item.code
                ? "border-primary bg-primary/5"
                : "border-slate-200 bg-slate-50")
            }
          >
            <div className="flex items-start justify-between gap-2">
              <button
                type="button"
                onClick={() => onSelect(item.code)}
                className="min-w-0 text-left"
              >
                <div className="truncate text-sm font-medium">{item.name}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {item.code} · {FUND_TYPE_LABELS[item.type] ?? item.type} ·{" "}
                  {FUND_TRADING_MODE_LABELS[item.trading_mode] ?? item.trading_mode}
                </div>
                {item.note ? (
                  <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    备注：{item.note}
                  </div>
                ) : null}
              </button>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => startEdit(item)}
                  className="rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-slate-200"
                >
                  备注
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDeleteCode(item.code)}
                  className="rounded px-1.5 py-1 text-xs text-red-600 hover:bg-red-50"
                >
                  删除
                </button>
              </div>
            </div>

            {editingCode === item.code ? (
              <div className="mt-2 flex gap-2">
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
        ))}
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
      {toast ? <Toast key={toast.id} message={toast.message} /> : null}
    </section>
  );
}
