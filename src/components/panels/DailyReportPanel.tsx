"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import type {
  DailyReport,
  DailyReportJobResult,
  DailyReportKind,
  DailyReportListResult,
  DailyReportMetric,
  DailyReportSummary,
} from "@/lib/shared/types";

/** 日报类型中文名。 */
const KIND_LABELS: Record<DailyReportKind, string> = {
  stock: "AI 股市日报",
  fund: "AI 基金日报",
};

/** 面板顶部口径说明。 */
const KIND_HINTS: Record<DailyReportKind, string> = {
  stock: "交易日收盘后自动生成，覆盖大盘指数、全市场涨跌家数、板块涨跌幅与自选股复盘。",
  fund: "交易日净值公布后自动生成，覆盖大盘背景、自选基金当日涨跌与净值口径说明。",
};

const SOURCE_LABELS: Record<DailyReportSummary["source"], string> = {
  deepseek: "AI 生成",
  template: "模板降级",
};

const STORAGE_LABELS: Record<DailyReportSummary["storage"], string> = {
  r2: "云端存储",
  local: "本地存储",
};

/** A 股口径：红涨绿跌。 */
const TONE_CLASS: Record<DailyReportMetric["tone"], string> = {
  up: "text-red-600",
  down: "text-green-600",
  flat: "text-muted-foreground",
};

/** 统一接口响应包装。 */
interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: { message?: string };
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
    if (!payload?.success || payload.data === undefined) {
      throw new Error(payload?.error?.message ?? "请求失败。");
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

/** 取北京日期键；面板内联实现，避免把服务端模块引入客户端产物。 */
function beijingToday(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

interface DailyReportPanelProps {
  kind: DailyReportKind;
}

/** AI 收盘日报面板：列表按日期倒序，支持查看详情与按指定日期补生成。 */
export function DailyReportPanel({ kind }: DailyReportPanelProps) {
  const [reports, setReports] = useState<DailyReportSummary[]>([]);
  const [listStorage, setListStorage] = useState<DailyReportSummary["storage"]>("local");
  const [detail, setDetail] = useState<DailyReport | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [historyDate, setHistoryDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const today = useMemo(() => beijingToday(), []);
  const todayGenerated = reports.some((item) => item.date === today);

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const data = await apiFetch<DailyReportListResult>(`/api/daily-reports?kind=${kind}`);
      setReports(data.reports);
      setListStorage(data.storage);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "日报列表加载失败。");
    } finally {
      setListLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    // 放进微任务回调，避免在 effect 同步路径里直接 setState。
    void Promise.resolve().then(() => loadList());
  }, [loadList]);

  const openDetail = useCallback(
    async (date: string) => {
      setDetailLoading(true);
      try {
        const data = await apiFetch<DailyReport>(`/api/daily-reports/${kind}/${date}`);
        setDetail(data);
        setError(null);
      } catch (nextError) {
        setDetail(null);
        setError(nextError instanceof Error ? nextError.message : "日报详情加载失败。");
      } finally {
        setDetailLoading(false);
      }
    },
    [kind],
  );

  const generate = useCallback(
    async (date?: string) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const result = await apiFetch<DailyReportJobResult>("/api/admin/daily-reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(date ? { kind, date } : { kind }),
        });
        if (result.status === "generated") {
          setNotice(
            `已生成 ${result.date} 日报：${
              result.report_source === "deepseek" ? "AI 生成" : "模板降级"
            }，${result.storage === "r2" ? "云端存储" : "本地存储"}。`,
          );
          await loadList();
          await openDetail(result.date);
        } else {
          setNotice(`未生成：${result.reason}`);
        }
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "日报生成失败。");
      } finally {
        setBusy(false);
      }
    },
    [kind, loadList, openDetail],
  );

  // 切换日报类型时派生可见详情，避免在 effect 里同步 setState（React 反模式）。
  const visibleDetail = detail && detail.kind === kind ? detail : null;

  const handleHistoryGenerate = () => {
    const value = historyDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      setNotice(null);
      setError("请选择合法的日期（YYYY-MM-DD）。");
      return;
    }
    if (value > today) {
      setNotice(null);
      setError("日期不能晚于今天。");
      return;
    }
    void generate(value);
  };

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{KIND_LABELS[kind]}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{KIND_HINTS[kind]}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            列表存储位置：{STORAGE_LABELS[listStorage]}　共 {reports.length} 篇
          </p>
        </div>
        <Button type="button" onClick={() => void generate()} disabled={busy}>
          {busy ? "生成中..." : todayGenerated ? "重新生成今日日报" : "立即生成今日日报"}
        </Button>
      </div>

      <div className="mt-3 space-y-2 rounded-lg border border-dashed p-3">
        <label className="text-xs font-medium" htmlFor={`daily-report-date-${kind}`}>
          按指定日期生成历史日报
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id={`daily-report-date-${kind}`}
            type="date"
            value={historyDate}
            max={today}
            onChange={(event) => setHistoryDate(event.target.value)}
            className="rounded-md border px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleHistoryGenerate}
            disabled={busy}
          >
            生成该日日报
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          仅支持交易日；全市场涨跌与板块数据上游只提供当日口径，历史日期会在正文中标注缺失。
        </p>
      </div>

      {error ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {notice}
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="rounded-lg border">
          <div className="border-b px-3 py-2 text-sm font-medium">历史日报（日期倒序）</div>
          <div className="max-h-[420px] overflow-y-auto">
            {listLoading && reports.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">加载中...</p>
            ) : null}
            {!listLoading && reports.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">
                暂无日报。数据就绪后系统会自动生成，也可点击右上角立即生成。
              </p>
            ) : null}
            {reports.map((item) => (
              <button
                key={item.date}
                type="button"
                onClick={() => void openDetail(item.date)}
                className={
                  "block w-full border-b px-3 py-2 text-left transition-colors hover:bg-accent " +
                  (visibleDetail?.date === item.date ? "bg-accent" : "")
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{item.date}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {SOURCE_LABELS[item.source]}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.headline}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {STORAGE_LABELS[item.storage]} · 生成于 {formatDateTime(item.generated_at)}
                </p>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-lg border p-3">
          {detailLoading ? (
            <p className="text-sm text-muted-foreground">日报详情加载中...</p>
          ) : !visibleDetail ? (
            <p className="text-sm text-muted-foreground">
              点击左侧任一日报查看完整内容。
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold">{visibleDetail.title}</h3>
                  <p className="text-xs text-muted-foreground">
                    生成于 {formatDateTime(visibleDetail.generated_at)} · {SOURCE_LABELS[visibleDetail.source]} ·{" "}
                    {STORAGE_LABELS[visibleDetail.storage]}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">{visibleDetail.model ?? "确定性模板"}</span>
              </div>

              {visibleDetail.metrics.length > 0 ? (
                <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3">
                  {visibleDetail.metrics.map((metric, index) => (
                    <div key={`${metric.label}-${index}`} className="rounded-md border px-2 py-1.5">
                      <p className="text-[11px] text-muted-foreground">{metric.label}</p>
                      <p className={`text-sm font-medium ${TONE_CLASS[metric.tone]}`}>
                        {metric.value}
                        {metric.change_pct !== null ? (
                          <span className="ml-1 text-[11px]">
                            ({metric.change_pct > 0 ? "+" : ""}
                            {metric.change_pct.toFixed(2)}%)
                          </span>
                        ) : null}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}

              {visibleDetail.data.missing.length > 0 ? (
                <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  数据缺失：{visibleDetail.data.missing.join("；")}
                </p>
              ) : null}

              <div className="markdown-body mt-3 max-h-[520px] overflow-y-auto pr-1">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{visibleDetail.markdown}</ReactMarkdown>
              </div>

              <p className="mt-3 text-xs text-muted-foreground">
                本日报仅用于学习与研究，不构成任何投资建议。
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}