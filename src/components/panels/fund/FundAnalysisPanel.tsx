"use client";

import { AgentTracePanel } from "@/components/panels/AgentTracePanel";
import { Button } from "@/components/ui/button";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { IDLE_TRACE_STATE, isTraceVisible, type AgentTraceViewState } from "@/lib/agent-trace-client";
import { formatDateTime } from "@/lib/format";
import type { AgentTracePolicy, FundAnalysisReport } from "@/lib/shared/types";

interface FundAnalysisPanelProps {
  code: string | null;
  reports: FundAnalysisReport[];
  loading: boolean;
  onGenerate: () => void;
  onDelete: (reportId: string) => void;
  /** 生成期的执行轨迹；缺省时不渲染。 */
  trace?: AgentTraceViewState;
  /** 轨迹留存策略，默认结束后清除。 */
  tracePolicy?: AgentTracePolicy;
}

/** 基金 AI 报告面板：生成、展示与删除基金分析结果。 */
export function FundAnalysisPanel({
  code,
  reports,
  loading,
  onGenerate,
  onDelete,
  trace,
  tracePolicy,
}: FundAnalysisPanelProps) {
  const latestReport = reports[0] ?? null;
  const traceState = trace ?? IDLE_TRACE_STATE;
  const policy = tracePolicy ?? "ephemeral";

  return (
    <section className="tech-panel tech-lift p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">基金 AI 分析</h2>
          <p className="text-xs text-muted-foreground">
            基于档案、净值、行情/估算、持仓与风险指标生成学习报告。
          </p>
        </div>
        <Button type="button" disabled={!code || loading} onClick={onGenerate}>
          {loading ? "生成中..." : "生成基金 AI 分析"}
        </Button>
      </div>

      {isTraceVisible(traceState) ? (
        <div className="mb-3">
          <AgentTracePanel state={traceState} policy={policy} />
        </div>
      ) : null}

      {loading && !latestReport ? (
        <p className="py-12 text-center text-sm text-muted-foreground">正在聚合基金数据并生成报告...</p>
      ) : !latestReport ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          暂无基金分析结果，点击上方按钮开始生成。
        </p>
      ) : (
        <div className="rounded-lg border p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium">{formatDateTime(latestReport.created_at)}</span>
            <span className="text-xs text-muted-foreground">
              {latestReport.source_refs.length} 项数据来源
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onDelete(latestReport.id)}
            >
              删除当前结果
            </Button>
          </div>
          <div className="markdown-body max-h-[560px] overflow-y-auto pr-1">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {latestReport.content}
            </ReactMarkdown>
          </div>
          <p className="mt-3 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            {latestReport.risk_note}
          </p>
        </div>
      )}
    </section>
  );
}
