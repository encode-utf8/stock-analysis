"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import type { NewsItem } from "@/lib/shared/types";

interface NewsPanelProps {
  news: NewsItem[];
  loading: boolean;
  analysisLoading: boolean;
  newsRangeDays: number;
  onRangeChange: (days: number) => void;
  onSearch: () => void;
  onGenerateAnalysis: () => void;
}

const PAGE_SIZE = 4;
const RANGE_OPTIONS = [
  { label: "1 周", days: 7 },
  { label: "2 周", days: 14 },
  { label: "1 个月", days: 30 },
  { label: "3 个月", days: 90 },
  { label: "6 个月", days: 180 },
  { label: "1 年", days: 365 },
];

/** 资讯与影响周期面板。 */
export function NewsPanel({
  news,
  loading,
  analysisLoading,
  newsRangeDays,
  onRangeChange,
  onSearch,
  onGenerateAnalysis,
}: NewsPanelProps) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(news.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const visibleNews = news.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  return (
    <div className="flex flex-col rounded-xl border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">资讯与影响周期</h2>
        <Button type="button" variant="outline" size="sm" onClick={onGenerateAnalysis} disabled={analysisLoading}>
          {analysisLoading ? "生成中..." : "生成 AI 分析"}
        </Button>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <select
          value={newsRangeDays}
          onChange={(event) => onRangeChange(Number(event.target.value))}
          className="rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
        >
          {RANGE_OPTIONS.map((option) => (
            <option key={option.days} value={option.days}>
              {option.label}
            </option>
          ))}
        </select>
        <Button type="button" variant="outline" size="sm" onClick={onSearch} disabled={loading}>
          {loading ? "搜索中..." : "搜索资讯"}
        </Button>
      </div>
      <div
        className={
          news.length > 0
            ? "min-h-0 max-h-[560px] space-y-3 overflow-y-auto pr-1"
            : "min-h-0 space-y-3"
        }
      >
        {loading && news.length === 0 ? (
          <p className="text-sm text-muted-foreground">资讯加载中...</p>
        ) : news.length === 0 ? (
          <p className="text-sm text-muted-foreground">无资讯。</p>
        ) : visibleNews.map((item) => (
          <div key={item.id} className="rounded-lg border p-3">
            <div className="flex items-start justify-between gap-2">
              <a href={item.url} target="_blank" rel="noreferrer" className="line-clamp-2 font-medium text-primary hover:underline">
                {item.title}
              </a>
              <span className="shrink-0 text-xs text-muted-foreground">
                {item.sentiment === "positive" ? "利好" : item.sentiment === "negative" ? "利空" : "中性"}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.summary}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>来源：{item.source}</span>
              <span>影响 {item.impact_days} 天</span>
              <span>到期 {formatDateTime(item.expire_at)}</span>
              <span>置信度 {(item.confidence * 100).toFixed(0)}%</span>
              {item.tags.length > 0 ? <span>标签：{item.tags.join("、")}</span> : null}
            </div>
          </div>
        ))}
      </div>
      {news.length > 0 ? (
        <div className="mt-3 flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
          <Button type="button" variant="outline" size="sm" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={currentPage === 0}>
            上一页
          </Button>
          <span>第 {currentPage + 1} / {totalPages} 页 · 共 {news.length} 条</span>
          <Button type="button" variant="outline" size="sm" onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))} disabled={currentPage >= totalPages - 1}>
            下一页
          </Button>
        </div>
      ) : null}
    </div>
  );
}
