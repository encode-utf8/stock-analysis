"use client";

import { useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import type { FundIndustryNewsSnapshot, FundNewsItem } from "@/lib/shared/types";

const PAGE_SIZE = 4;
const DEFAULT_CODE = "510300";

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: { message?: string };
}

async function apiFetch<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
    if (!payload?.success || payload.data === undefined) {
      throw new Error(payload?.error?.message ?? "行业资讯查询失败。");
    }
    return payload.data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("行业资讯查询超时，请稍后重试。");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function sentimentLabel(value: FundNewsItem["sentiment"]): string {
  if (value === "positive") {
    return "利好";
  }
  if (value === "negative") {
    return "利空";
  }
  return "中性";
}

/** 基金行业资讯查询面板：独立输入基金代码，按需查询 AI/持仓识别出的行业与真实资讯。 */
export function FundNewsPanel() {
  const [input, setInput] = useState(DEFAULT_CODE);
  const [snapshot, setSnapshot] = useState<FundIndustryNewsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const news = snapshot?.news ?? [];
  const totalPages = Math.max(1, Math.ceil(news.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const visibleNews = news.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const loadNews = async (nextCode: string, refresh: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<FundIndustryNewsSnapshot>(
        `/api/funds/${encodeURIComponent(nextCode)}/news${refresh ? "?refresh=1" : ""}`,
      );
      setSnapshot(data);
      setPage(0);
    } catch (nextError) {
      setSnapshot(null);
      setError(nextError instanceof Error ? nextError.message : "行业资讯查询失败。");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedCode = input.trim();
    if (!/^\d{6}$/.test(normalizedCode)) {
      setError("请输入 6 位基金代码。");
      return;
    }
    void loadNews(normalizedCode, false);
  };

  const handleRefresh = () => {
    if (snapshot?.code) {
      void loadNews(snapshot.code, true);
    }
  };

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">行业资讯查询</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              根据持仓识别强相关行业后检索真实资讯；无法获取真实数据时不展示降级内容。
            </p>
          </div>
          {snapshot?.code ? (
            <Button type="button" variant="outline" size="sm" onClick={handleRefresh} disabled={loading}>
              {loading ? "分析中..." : "刷新资讯"}
            </Button>
          ) : null}
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex flex-wrap items-end gap-2 rounded-lg border bg-slate-50 p-3"
        >
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            基金代码
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="如 510300"
              maxLength={6}
              inputMode="numeric"
              className="w-36 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </label>
          <Button type="submit" disabled={loading}>
            {loading ? "查询中..." : "查询行业资讯"}
          </Button>
        </form>
      </div>

      {error ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {snapshot && snapshot.industries.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium text-muted-foreground">关联行业：</span>
          {snapshot.industries.map((industry) => (
            <span key={industry} className="rounded bg-primary/10 px-2 py-0.5 text-primary">
              {industry}
            </span>
          ))}
          <span className="text-muted-foreground">
            {snapshot.industry_analysis_source === "ai" ? "AI 识别" : "持仓推导"}
          </span>
        </div>
      ) : null}

      {loading && !snapshot ? (
        <p className="mt-3 text-sm text-muted-foreground">正在分析持仓并检索行业资讯...</p>
      ) : snapshot && !snapshot.available ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {snapshot.reason ?? "行业资讯暂不可用。"}
        </div>
      ) : news.length > 0 ? (
        <div className="mt-3 min-h-0 space-y-3">
          {visibleNews.map((item) => (
            <div key={item.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="mr-2 rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    {item.industry ?? item.tags[0] ?? "行业资讯"}
                  </span>
                  {item.url ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-primary hover:underline"
                    >
                      {item.title}
                    </a>
                  ) : (
                    <span className="font-medium">{item.title}</span>
                  )}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {sentimentLabel(item.sentiment)}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">{item.summary}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>来源：{item.source}</span>
                <span>发布时间：{formatDateTime(item.published_at)}</span>
                <span>置信度 {(item.confidence * 100).toFixed(0)}%</span>
                {item.tags.length > 0 ? <span>标签：{item.tags.join("、")}</span> : null}
              </div>
            </div>
          ))}
        </div>
      ) : snapshot ? (
        <p className="mt-3 text-sm text-muted-foreground">暂无行业资讯。</p>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          输入 6 位基金代码后点击“查询行业资讯”。
        </p>
      )}

      {news.length > 0 ? (
        <div className="mt-3 flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPage((value) => Math.max(0, value - 1))}
            disabled={currentPage === 0}
          >
            上一页
          </Button>
          <span>
            第 {currentPage + 1} / {totalPages} 页 · 共 {news.length} 条
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}
            disabled={currentPage >= totalPages - 1}
          >
            下一页
          </Button>
        </div>
      ) : null}
    </section>
  );
}
