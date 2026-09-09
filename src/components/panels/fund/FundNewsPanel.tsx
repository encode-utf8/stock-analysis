"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import type { FundIndustryNewsSnapshot, FundNewsItem } from "@/lib/shared/types";

interface FundNewsPanelProps {
  snapshot: FundIndustryNewsSnapshot | null;
  loading: boolean;
  onRefresh: () => void;
}

const PAGE_SIZE = 4;

function sentimentLabel(value: FundNewsItem["sentiment"]): string {
  if (value === "positive") {
    return "利好";
  }
  if (value === "negative") {
    return "利空";
  }
  return "中性";
}

/** 基金行业资讯查询面板：展示 AI/持仓识别出的行业，以及真实行业资讯。 */
export function FundNewsPanel({ snapshot, loading, onRefresh }: FundNewsPanelProps) {
  const [page, setPage] = useState(0);
  const news = snapshot?.news ?? [];
  const totalPages = Math.max(1, Math.ceil(news.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const visibleNews = news.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">行业资讯查询</h2>
          <p className="text-xs text-muted-foreground">
            根据持仓识别强相关行业后检索真实资讯；无法获取真实数据时不展示降级内容。
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
          {loading ? "分析中..." : "刷新资讯"}
        </Button>
      </div>

      {snapshot && snapshot.industries.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
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
        <p className="text-sm text-muted-foreground">正在分析持仓并检索行业资讯...</p>
      ) : snapshot && !snapshot.available ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {snapshot.reason ?? "行业资讯暂不可用。"}
        </div>
      ) : news.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无行业资讯。</p>
      ) : (
        <div className="min-h-0 space-y-3">
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
