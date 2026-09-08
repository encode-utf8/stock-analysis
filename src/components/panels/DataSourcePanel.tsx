"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatDateTime, freshnessText } from "@/lib/format";
import type { DataSourceHealthSnapshot, SchedulerJobView } from "@/lib/datasource-health";
import type { DataSourceState, JobRun } from "@/lib/shared/types";

/** 统一接口响应包装。 */
interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: { message?: string };
}

/** 数据源状态文案。 */
function stateLabel(state: DataSourceState): string {
  if (state === "online") {
    return "在线";
  }
  if (state === "degraded") {
    return "降级";
  }
  return "离线";
}

/** 数据源状态对应的卡片配色。 */
function stateTone(state: DataSourceState): string {
  if (state === "online") {
    return "border-green-200 bg-green-50 text-green-900";
  }
  if (state === "degraded") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }
  return "border-red-200 bg-red-50 text-red-900";
}

/** 数据源状态徽标配色。 */
function badgeTone(state: DataSourceState): string {
  if (state === "online") {
    return "bg-green-100 text-green-700";
  }
  if (state === "degraded") {
    return "bg-amber-100 text-amber-700";
  }
  return "bg-red-100 text-red-700";
}

/** 调度任务状态文案。 */
function jobStatusLabel(status: SchedulerJobView["status"]): string {
  const labels: Record<SchedulerJobView["status"], string> = {
    idle: "待运行",
    pending: "等待中",
    running: "运行中",
    success: "成功",
    failed: "失败",
  };
  return labels[status];
}

/** 调度任务状态徽标配色。 */
function jobStatusTone(status: SchedulerJobView["status"]): string {
  if (status === "success") {
    return "bg-green-100 text-green-700";
  }
  if (status === "failed") {
    return "bg-red-100 text-red-700";
  }
  if (status === "running" || status === "pending") {
    return "bg-blue-100 text-blue-700";
  }
  return "bg-slate-100 text-slate-600";
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
    if (!payload?.success || payload.data === undefined) {
      throw new Error(payload?.error?.message ?? "请求失败");
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

/** 数据源健康与调度面板：自取数并支持手动刷新/清理。 */
export function DataSourcePanel() {
  const [snapshot, setSnapshot] = useState<DataSourceHealthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fundRefreshing, setFundRefreshing] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    apiFetch<DataSourceHealthSnapshot>("/api/admin/datasources")
      .then((data) => {
        if (!cancelled) {
          setSnapshot(data);
        }
      })
      .catch((nextError: unknown) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "数据源状态加载失败");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const loadSnapshot = useCallback(async () => {
    setError(null);
    try {
      const data = await apiFetch<DataSourceHealthSnapshot>("/api/admin/datasources");
      setSnapshot(data);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "数据源状态加载失败");
    }
  }, []);

  const triggerRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await apiFetch<JobRun>("/api/admin/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "quote" }),
      });
      await loadSnapshot();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "手动刷新失败");
    } finally {
      setRefreshing(false);
    }
  };

  const triggerFundRefresh = async () => {
    setFundRefreshing(true);
    setError(null);
    try {
      await apiFetch<JobRun>("/api/admin/fund-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "all" }),
      });
      await loadSnapshot();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "基金数据刷新失败");
    } finally {
      setFundRefreshing(false);
    }
  };

  const triggerCleanup = async () => {
    setCleaning(true);
    setError(null);
    try {
      await apiFetch<JobRun>("/api/admin/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dry_run: false }),
      });
      await loadSnapshot();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "手动清理失败");
    } finally {
      setCleaning(false);
    }
  };

  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">数据源状态</h2>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void loadSnapshot()}>
            刷新状态
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={refreshing} onClick={() => void triggerRefresh()}>
            {refreshing ? "刷新中..." : "手动刷新"}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={fundRefreshing} onClick={() => void triggerFundRefresh()}>
            {fundRefreshing ? "基金刷新中..." : "刷新基金数据"}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={cleaning} onClick={() => void triggerCleanup()}>
            {cleaning ? "清理中..." : "清理过期资讯"}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">数据源状态加载中...</p>
      ) : snapshot ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {snapshot.sources.map((source) => (
              <div key={source.source} className={`rounded-lg border p-3 ${stateTone(source.state)}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium">{source.source}</div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeTone(source.state)}`}>
                    {stateLabel(source.state)}
                  </span>
                </div>
                <dl className="mt-2 space-y-1 text-xs">
                  <div className="flex justify-between gap-3">
                    <dt>延迟</dt>
                    <dd>{source.latency_ms === null ? "—" : `${source.latency_ms} ms`}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>最近检查</dt>
                    <dd>
                      {formatDateTime(source.last_checked_at)}（{freshnessText(source.last_checked_at)}）
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>最近成功</dt>
                    <dd>
                      {source.last_success_at
                        ? `${formatDateTime(source.last_success_at)}（${freshnessText(source.last_success_at)}）`
                        : "暂无"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>连续失败</dt>
                    <dd>{source.consecutive_failures}</dd>
                  </div>
                </dl>
                {source.message ? (
                  <p className="mt-2 rounded-md bg-white/60 px-2 py-1 text-xs leading-5">
                    {source.message}
                  </p>
                ) : null}
              </div>
            ))}
          </div>

          <div className="mt-5">
            <h3 className="mb-2 text-sm font-semibold">调度任务</h3>
            <div className="grid gap-3">
              {snapshot.jobs.map((job) => (
                <div key={job.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">{job.name}</div>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${jobStatusTone(job.status)}`}>
                      {jobStatusLabel(job.status)}
                    </span>
                  </div>
                  <dl className="mt-2 space-y-1 text-xs">
                    <div className="flex justify-between gap-3">
                      <dt>Cron</dt>
                      <dd className="font-mono">{job.cron}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>最近运行</dt>
                      <dd>{job.last_run_at ? formatDateTime(job.last_run_at) : "暂无"}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>是否启用</dt>
                      <dd>{job.enabled ? "是" : "否"}</dd>
                    </div>
                  </dl>
                  <div className="mt-3 text-xs text-muted-foreground">
                    {job.runs.length === 0 ? (
                      "暂无运行记录"
                    ) : (
                      <ul className="space-y-1">
                        {job.runs.slice(0, 5).map((run) => (
                          <li key={run.id} className="flex items-center justify-between gap-3">
                            <span>{run.status}</span>
                            <span>{formatDateTime(run.started_at)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
