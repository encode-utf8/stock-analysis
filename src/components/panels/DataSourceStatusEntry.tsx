"use client";

// 数据源状态入口：页面右上角按钮 + 状态弹窗（原个股工作台的「数据源与调度」模块）。
// 弹窗打开时才拉取健康快照，避免每次进页面都触发一轮外部探测。

import { useCallback, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { formatDateTime, freshnessText } from "@/lib/format";
import type { DataSourceHealthSnapshot, SchedulerJobView } from "@/lib/datasource-health";
import type { DataSourceState, JobRun } from "@/lib/shared/types";

/** 只读快照超时：服务端探测有整体预算（约 12 秒），客户端留出余量即可。 */
const SNAPSHOT_TIMEOUT_MS = 20_000;
/** 任务触发超时：基金全量刷新等任务本身可能跑几十秒，不能按请求超时处理。 */
const JOB_TIMEOUT_MS = 180_000;

/** 统一接口响应包装。 */
interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: { message?: string };
}

/** 读取统一响应；超时可自定义文案（任务型请求与只读请求语义不同）。 */
async function apiFetch<T>(
  url: string,
  init?: RequestInit,
  options: { timeoutMs?: number; timeoutMessage?: string } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? SNAPSHOT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
    if (!payload?.success || payload.data === undefined) {
      throw new Error(payload?.error?.message ?? "请求失败");
    }
    return payload.data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(options.timeoutMessage ?? "请求超时，请稍后重试。");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
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
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  }
  if (state === "degraded") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  }
  return "border-red-500/30 bg-red-500/10 text-red-200";
}

/** 数据源状态徽标配色。 */
function badgeTone(state: DataSourceState): string {
  if (state === "online") {
    return "bg-emerald-500/15 text-emerald-300";
  }
  if (state === "degraded") {
    return "bg-amber-500/15 text-amber-300";
  }
  return "bg-red-500/15 text-red-300";
}

/** 入口按钮上的状态点配色：取所有数据源里最差的状态。 */
function worstState(snapshot: DataSourceHealthSnapshot | null): DataSourceState | null {
  if (!snapshot || snapshot.sources.length === 0) {
    return null;
  }
  if (snapshot.sources.some((source) => source.state === "offline")) {
    return "offline";
  }
  if (snapshot.sources.some((source) => source.state === "degraded")) {
    return "degraded";
  }
  return "online";
}

/** 状态点配色。 */
function dotTone(state: DataSourceState): string {
  if (state === "online") {
    return "bg-emerald-400";
  }
  if (state === "degraded") {
    return "bg-amber-400";
  }
  return "bg-red-400";
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
    return "bg-emerald-500/15 text-emerald-300";
  }
  if (status === "failed") {
    return "bg-red-500/15 text-red-300";
  }
  if (status === "running" || status === "pending") {
    return "bg-sky-500/15 text-sky-300";
  }
  return "bg-muted text-muted-foreground";
}

/** 页面右上角的数据源状态入口：按钮 + 健康 / 调度弹窗。 */
export function DataSourceStatusEntry() {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<DataSourceHealthSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [fundRefreshing, setFundRefreshing] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSnapshot = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      setSnapshot(await apiFetch<DataSourceHealthSnapshot>("/api/admin/datasources"));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "数据源状态加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  /** 打开弹窗并立即探测；探测放在事件里触发，避免在 effect 中同步 setState。 */
  const openDialog = useCallback(() => {
    setOpen(true);
    void loadSnapshot();
  }, [loadSnapshot]);

  /**
   * 触发后台任务：任务本身可能耗时数十秒，使用独立超时；
   * 超时只提示「可能仍在执行」，不把任务误判为失败。
   */
  const runJob = useCallback(
    async (
      url: string,
      body: Record<string, unknown>,
      setBusy: (busy: boolean) => void,
      failureMessage: string,
    ) => {
      setBusy(true);
      setError(null);
      try {
        await apiFetch<JobRun>(
          url,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
          { timeoutMs: JOB_TIMEOUT_MS, timeoutMessage: "任务执行超时，请稍后刷新状态确认结果。" },
        );
        await loadSnapshot();
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : failureMessage);
      } finally {
        setBusy(false);
      }
    },
    [loadSnapshot],
  );

  const busiest = refreshing || fundRefreshing || cleaning;
  const state = worstState(snapshot);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={openDialog}
        title="查看数据源健康状态与调度任务"
        data-testid="datasource-status-entry"
        className="gap-1.5"
      >
        <span className="relative flex h-3.5 w-3.5 items-center justify-center" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
          >
            <rect x="3" y="4" width="18" height="7" rx="2" />
            <rect x="3" y="13" width="18" height="7" rx="2" />
            <path d="M7 7.5h.01M7 16.5h.01" />
          </svg>
        </span>
        数据源状态
        {state ? (
          <span
            aria-hidden="true"
            className={`ml-0.5 h-1.5 w-1.5 rounded-full ${dotTone(state)}`}
          />
        ) : null}
      </Button>

      {open ? createPortal(
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="datasource-status-title"
            data-testid="datasource-status-panel"
            className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden tech-panel shadow-2xl ring-1 ring-white/5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
              <div>
                <h2
                  id="datasource-status-title"
                  className="text-base font-semibold tracking-tight text-foreground"
                >
                  数据源状态
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  行情侧车、基金侧车、Tavily、DeepSeek 与 R2 的探测结果与调度任务；上游不可达时按探测超时降级展示，不阻塞页面。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="关闭"
                className="rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-muted-foreground"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
              {error ? (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {error}
                </div>
              ) : null}

              {snapshot ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {snapshot.sources.map((source) => (
                      <div
                        key={source.source}
                        data-testid="datasource-status-card"
                        className={`rounded-lg border p-3 ${stateTone(source.state)}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium">{source.source}</div>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeTone(source.state)}`}
                          >
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
                              {formatDateTime(source.last_checked_at)}（
                              {freshnessText(source.last_checked_at)}）
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
                          <p className="mt-2 rounded-md bg-card/60 px-2 py-1 text-xs leading-5">
                            {source.message}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>

                  <div>
                    <h3 className="mb-2 text-sm font-semibold">调度任务</h3>
                    <div className="grid gap-3">
                      {snapshot.jobs.map((job) => (
                        <div key={job.id} className="rounded-lg border p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium">{job.name}</div>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${jobStatusTone(job.status)}`}
                            >
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
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {loading ? "正在探测数据源..." : "暂无数据源状态。"}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 bg-muted/50 px-5 py-3">
              <p className="text-[11px] text-muted-foreground">
                {loading && snapshot ? "正在重新探测..." : "探测均为只读，任务触发后可在调度任务处查看运行记录。"}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loading || busiest}
                  onClick={() => void loadSnapshot()}
                >
                  刷新状态
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busiest}
                  onClick={() =>
                    void runJob(
                      "/api/admin/refresh",
                      { target: "quote" },
                      setRefreshing,
                      "手动刷新失败",
                    )
                  }
                >
                  {refreshing ? "刷新中..." : "手动刷新"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busiest}
                  onClick={() =>
                    void runJob(
                      "/api/admin/fund-refresh",
                      { target: "all" },
                      setFundRefreshing,
                      "基金数据刷新失败",
                    )
                  }
                >
                  {fundRefreshing ? "基金刷新中..." : "刷新基金数据"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busiest}
                  onClick={() =>
                    void runJob(
                      "/api/admin/cleanup",
                      { dry_run: false },
                      setCleaning,
                      "手动清理失败",
                    )
                  }
                >
                  {cleaning ? "清理中..." : "清理过期资讯"}
                </Button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}