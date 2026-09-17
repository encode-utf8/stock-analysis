"use client";

import { useCallback, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import type {
  ConsistencyPlan,
  ConsistencyResult,
  DatabaseHealth,
  DumpAction,
  DumpFileReport,
  EntryDecisionKind,
} from "@/lib/data-consistency";

/** 统一响应包装结构。 */
interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

/** 读取统一 JSON 响应并抛出可展示错误。 */
async function apiFetch<T>(
  url: string,
  init?: RequestInit,
  timeoutMs = 60_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
    if (!payload?.success || payload.data === undefined) {
      throw new Error(payload?.error?.message ?? "数据一致性请求失败。");
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

/** 文件级动作的展示文案。 */
const ACTION_META: Record<DumpAction, { label: string; className: string }> = {
  restore: { label: "回填数据库", className: "bg-emerald-500/15 text-emerald-300" },
  clean: { label: "清除垃圾", className: "bg-amber-500/15 text-amber-300" },
  archive: { label: "归档冗余副本", className: "bg-muted text-muted-foreground" },
  keep: { label: "保持不动", className: "bg-muted text-muted-foreground" },
  pending: { label: "等待数据库", className: "bg-muted text-muted-foreground" },
  "report-only": { label: "仅报告", className: "bg-sky-500/15 text-sky-300" },
  none: { label: "无需处理", className: "bg-muted text-muted-foreground" },
};

/** 条目级判定的展示文案。 */
const DECISION_META: Record<EntryDecisionKind, { label: string; className: string }> = {
  insert: { label: "回填", className: "bg-emerald-500/15 text-emerald-300" },
  update: { label: "覆盖", className: "bg-emerald-500/15 text-emerald-300" },
  redundant: { label: "冗余", className: "bg-muted text-muted-foreground" },
  invalid: { label: "垃圾", className: "bg-amber-500/15 text-amber-300" },
  template: { label: "模板垃圾", className: "bg-amber-500/15 text-amber-300" },
  pending: { label: "待比对", className: "bg-muted text-muted-foreground" },
};

/** 数据库状态横幅样式。 */
function healthMeta(status: DatabaseHealth["status"]): { label: string; className: string } {
  if (status === "ready") {
    return { label: "数据库就绪", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" };
  }
  if (status === "schema_behind") {
    return { label: "数据库结构落后", className: "border-amber-500/30 bg-amber-500/10 text-amber-300" };
  }
  return { label: "数据库不可用", className: "border-red-500/30 bg-red-500/10 text-red-300" };
}

/** 单个降级文件的扫描结果卡片。 */
function FileCard({ file }: { file: DumpFileReport }) {
  const [expanded, setExpanded] = useState(false);
  const action = ACTION_META[file.action];
  const visible = expanded ? file.entries : file.entries.slice(0, 5);

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-foreground/85">{file.path}</p>
          <p className="mt-1 text-xs text-muted-foreground">{file.summary}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${action.className}`}>
          {action.label}
        </span>
      </div>

      {file.entries.length > 0 ? (
        <ul className="mt-2 space-y-1 border-t border-border/60 pt-2">
          {visible.map((entry) => {
            const decision = DECISION_META[entry.decision];
            return (
              <li key={`${entry.key}-${entry.decision}`} className="flex items-start gap-2 text-xs">
                <span className={`mt-px shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${decision.className}`}>
                  {decision.label}
                </span>
                <span className="shrink-0 font-mono text-foreground/85">{entry.key}</span>
                <span className="min-w-0 flex-1 text-muted-foreground">
                  {entry.label ? `${entry.label} · ` : ""}
                  {entry.reason}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {file.entries.length > 5 ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-2 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground/85 hover:underline"
        >
          {expanded ? "收起明细" : `展开其余 ${file.entries.length - 5} 条`}
        </button>
      ) : null}
    </div>
  );
}

/** 工作台右上角的数据一致性入口：按钮 + 清理弹窗。 */
export function DataConsistencyEntry() {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<ConsistencyPlan | null>(null);
  const [result, setResult] = useState<ConsistencyResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = useCallback(async () => {
    setScanning(true);
    setError(null);
    setResult(null);
    try {
      setPlan(await apiFetch<ConsistencyPlan>("/api/admin/data-consistency", undefined, 45_000));
    } catch (scanError) {
      setPlan(null);
      setError(scanError instanceof Error ? scanError.message : "扫描失败。");
    } finally {
      setScanning(false);
    }
  }, []);

  const apply = useCallback(async () => {
    setApplying(true);
    setError(null);
    try {
      const applied = await apiFetch<ConsistencyResult>(
        "/api/admin/data-consistency",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
        120_000,
      );
      setResult(applied);
      setPlan(applied.plan);
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "执行清理失败。");
    } finally {
      setApplying(false);
    }
  }, []);

  /** 打开弹窗并立即扫描；扫描放在事件里触发，避免在 effect 中同步 setState。 */
  const openDialog = useCallback(() => {
    setOpen(true);
    void scan();
  }, [scan]);

  const ready = plan?.database.status === "ready";
  const busy = scanning || applying;
  const health = plan ? healthMeta(plan.database.status) : null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={openDialog}
        title="检查并清理本地降级数据"
        className="gap-1.5"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5"
          aria-hidden="true"
        >
          <ellipse cx="12" cy="5" rx="8" ry="3" />
          <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
          <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
        </svg>
        数据一致性
      </Button>

      {open ? createPortal(
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="data-consistency-title"
            className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden tech-panel shadow-2xl ring-1 ring-white/5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
              <div>
                <h2 id="data-consistency-title" className="text-base font-semibold tracking-tight text-foreground">
                  数据一致性清理
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  数据库恢复可用后按「数据更新时间」判定：数据库缺少的条目回填入库；内容一致、或数据库最后改动不早于本地文件的条目视为冗余；数据库最后改动早于本地文件时以本地为准覆盖。断连期间产生的模板垃圾则被清除。
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

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {health ? (
                <div className={`rounded-lg border px-3 py-2 text-xs ${health.className}`}>
                  <span className="font-medium">{health.label}</span>
                  <span className="ml-2">{plan?.database.message}</span>
                  {plan?.cloudReady === false ? (
                    <span className="ml-2">云端日报存储未配置，日报仅做本地扫描。</span>
                  ) : null}
                </div>
              ) : null}

              {error ? (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {error}
                </div>
              ) : null}

              {scanning && !plan ? (
                <p className="py-6 text-center text-sm text-muted-foreground">正在扫描本地降级数据...</p>
              ) : null}

              {plan ? (
                <>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span className="rounded-full bg-muted px-2 py-0.5">
                      待回填 {plan.totals.toRestore} 条
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5">
                      待覆盖 {plan.totals.toUpdate} 条
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5">
                      数据库已存在 {plan.totals.skipped} 条
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5">
                      垃圾 {plan.totals.toClean} 条
                    </span>
                  </div>

                  <div className="space-y-2">
                    {plan.files.map((file) => (
                      <FileCard key={file.path} file={file} />
                    ))}
                  </div>
                </>
              ) : null}

              {result ? (
                <div className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-foreground/85">
                  <p className="font-medium text-foreground">
                    清理完成：回填 {result.applied.restored} 条 / 覆盖 {result.applied.updated} 条 /
                    清除 {result.applied.dropped} 条 / 跳过 {result.applied.skipped} 条
                  </p>
                  {result.applied.quarantined.length > 0 ? (
                    <p className="mt-1">
                      已隔离：{result.applied.quarantined.join("、")}（可回滚）
                    </p>
                  ) : null}
                  {result.errors.length > 0 ? (
                    <p className="mt-1 text-amber-300">
                      部分失败：{result.errors.slice(0, 3).join("；")}
                      {result.errors.length > 3 ? ` 等 ${result.errors.length} 项` : ""}
                    </p>
                  ) : null}
                  <p className="mt-1 text-muted-foreground">
                    若界面仍显示旧数据，请刷新页面；处于降级状态的进程需重启后才会切回数据库。
                  </p>
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border/60 bg-muted/50 px-5 py-3">
              <p className="text-[11px] text-muted-foreground">
                判定基准：数据库该数据域的最后改动时间 vs 本地文件修改时间。执行前先回填事实数据，再把处理完毕的降级文件移入 .data/quarantine/。
              </p>
              <div className="flex shrink-0 gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => void scan()} disabled={busy}>
                  {scanning ? "扫描中..." : "重新扫描"}
                </Button>
                <Button type="button" size="sm" onClick={() => void apply()} disabled={busy || !ready}>
                  {applying ? "执行中..." : "执行清理"}
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