"use client";

import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import type { JobRun } from "@/lib/shared/types";

/** 可观测性聚合数据。 */
export interface ObservabilityData {
  metrics: {
    externalCalls: number;
    externalFailures: number;
    cacheHits: number;
    cacheMisses: number;
    analysisRuns: number;
    chatRuns: number;
    cleanupRuns: number;
    refreshRuns: number;
    lastEventAt: string | null;
    externalFailureRate: number;
    cacheHitRate: number;
  };
  recentJobs: JobRun[];
}

interface ObservabilityPanelProps {
  observability: ObservabilityData | null;
  onRefresh: () => void;
}

/** 可观测性指标面板。 */
export function ObservabilityPanel({
  observability,
  onRefresh,
}: ObservabilityPanelProps) {
  return (
    <section className="tech-panel tech-lift p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">可观测性</h2>
        <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
          刷新指标
        </Button>
      </div>
      {observability ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">外部调用次数</div>
              <div className="mt-1 text-xl font-semibold">{observability.metrics.externalCalls}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">外部失败率</div>
              <div className="mt-1 text-xl font-semibold">{observability.metrics.externalFailureRate}%</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">缓存复用命中率</div>
              <div className="mt-1 text-xl font-semibold">{observability.metrics.cacheHitRate}%</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">分析 / 对话 / 清理 / 刷新</div>
              <div className="mt-1 text-xl font-semibold">
                {observability.metrics.analysisRuns} / {observability.metrics.chatRuns} / {observability.metrics.cleanupRuns} / {observability.metrics.refreshRuns}
              </div>
            </div>
          </div>
          <div className="mt-4 text-xs text-muted-foreground">
            最近任务：
            {observability.recentJobs.length === 0
              ? "暂无"
              : observability.recentJobs.slice(0, 5).map((job) => (
                  <span key={job.id} className="ml-2">
                    {job.job_name}（{job.status}）{job.finished_at ? formatDateTime(job.finished_at) : "运行中"}
                  </span>
                ))}
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">可观测性指标加载中...</p>
      )}
    </section>
  );
}
