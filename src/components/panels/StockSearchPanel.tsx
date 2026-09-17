"use client";

import { Button } from "@/components/ui/button";

interface StockSearchPanelProps {
  input: string;
  loading: boolean;
  code: string | null;
  onInputChange: (value: string) => void;
  onSearch: () => void;
  onRefresh: () => void;
  onCleanup: () => void;
}

/** 股票查询与手动任务操作面板。 */
export function StockSearchPanel({
  input,
  loading,
  code,
  onInputChange,
  onSearch,
  onRefresh,
  onCleanup,
}: StockSearchPanelProps) {
  return (
    <div className="flex flex-col gap-3 tech-panel tech-lift p-4 shadow-sm md:flex-row">
      <input
        value={input}
        onChange={(event) => onInputChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onSearch();
          }
        }}
        placeholder="例如：600519"
        className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
        aria-label="股票代码"
      />
      <Button type="button" onClick={onSearch} disabled={loading}>
        {loading ? "查询中..." : "查询股票"}
      </Button>
      <Button type="button" variant="outline" onClick={onRefresh} disabled={!code || loading}>
        强制刷新
      </Button>
      <Button type="button" variant="outline" onClick={onCleanup}>
        清理到期资讯
      </Button>
    </div>
  );
}
