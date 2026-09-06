"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatDateTime } from "@/lib/format";
import type { AnalysisReport } from "@/lib/shared/types";

interface AnalysisPanelProps {
  reports: AnalysisReport[];
  loading: boolean;
  onDelete: (reportId: string) => void;
}

/** Markdown 渲染容器。 */
function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

/** 周期内 AI 分析面板：只展示当前最新结果，无结果时自适应缩小。 */
export function AnalysisPanel({
  reports,
  loading,
  onDelete,
}: AnalysisPanelProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const latestReport = reports[0] ?? null;
  const hasReport = Boolean(latestReport);

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">周期内 AI 分析</h2>
        {latestReport ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setConfirmOpen(true)}
          >
            删除当前结果
          </Button>
        ) : null}
      </div>

      <div className={hasReport ? "mt-3 max-h-[560px] overflow-y-auto pr-1" : "mt-3"}>
        {loading && !hasReport ? (
          <p className="text-sm text-muted-foreground">历史报告加载中...</p>
        ) : !latestReport ? (
          <p className="text-sm text-muted-foreground">暂无分析结果，点击“生成 AI 分析”开始。</p>
        ) : (
          <div className="rounded-lg border p-3">
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="font-medium">{formatDateTime(latestReport.created_at)}</span>
              <span className="text-xs text-muted-foreground">
                {latestReport.news_refs.length} 条引用
              </span>
            </div>
            <MarkdownContent content={latestReport.content} />
            <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {latestReport.risk_note}
            </p>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="确认删除当前分析结果"
        description="删除后无法恢复，是否继续？"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          if (latestReport) {
            onDelete(latestReport.id);
          }
          setConfirmOpen(false);
        }}
      />
    </div>
  );
}
