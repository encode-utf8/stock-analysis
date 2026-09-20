"use client";

// 执行轨迹面板：运行期展示步骤流与每步耗时，结束后由调用方按留存策略清理。
// 只用既有设计令牌与 Tailwind 语义色，不新增样式文件。
import { useEffect, useState } from "react";

import {
  formatDuration,
  isTraceVisible,
  traceStatusLabel,
  type AgentTraceViewState,
} from "@/lib/agent-trace-client";
import type {
  AgentTracePolicy,
  AgentTraceRun,
  AgentTraceStatus,
  AgentTraceStep,
  AgentTraceStepKind,
} from "@/lib/shared/types";

/** 步骤类型到图标与配色。 */
const STEP_KIND_STYLES: Record<AgentTraceStepKind, { icon: string; tone: string }> = {
  thinking: { icon: "◌", tone: "text-sky-300" },
  tool: { icon: "▸", tone: "text-emerald-300" },
  data: { icon: "▤", tone: "text-cyan-300" },
  model: { icon: "✦", tone: "text-violet-300" },
  guard: { icon: "⊘", tone: "text-amber-300" },
  persist: { icon: "▣", tone: "text-teal-300" },
};

/** 步骤状态圆点配色；进行中使用脉冲动画，降级动效时自动停用。 */
const STEP_STATUS_TONES: Record<AgentTraceStatus, string> = {
  running: "bg-sky-400 motion-safe:animate-pulse",
  success: "bg-emerald-400",
  failed: "bg-red-400",
  skipped: "bg-slate-400",
  aborted: "bg-amber-400",
};

/** 是否处于降低动效偏好（SSR 与单测下按否处理）。 */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** 运行中的累计耗时：每 100ms 采样一次，采样值绑定 runId，避免跨轮串值。 */
function useLiveElapsed(active: boolean, runId: string): number {
  const [sample, setSample] = useState<{ runId: string; elapsedMs: number } | null>(null);

  useEffect(() => {
    if (!active || prefersReducedMotion()) {
      return;
    }
    const anchor = Date.now();
    const timer = window.setInterval(() => {
      setSample({ runId, elapsedMs: Date.now() - anchor });
    }, 100);
    return () => window.clearInterval(timer);
  }, [active, runId]);

  return sample && sample.runId === runId ? sample.elapsedMs : 0;
}

/** 头部摘要：步骤数 + 已完成数 + 耗时。 */
function buildSummary(run: AgentTraceRun, totalMs: number | undefined): string {
  const parts = [run.steps.length + " 步"];
  const doneSteps = run.steps.filter((step) => step.status !== "running").length;
  if (doneSteps < run.steps.length) {
    parts.push("已完成 " + doneSteps + " 步");
  }
  parts.push(formatDuration(totalMs));
  return parts.join(" · ");
}

/** 单个步骤行。 */
function TraceStepRow({ step }: { step: AgentTraceStep }) {
  const style = STEP_KIND_STYLES[step.kind];
  return (
    <li className="flex items-start gap-2 py-1 text-xs">
      <span
        aria-hidden="true"
        className={"mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full " + STEP_STATUS_TONES[step.status]}
      />
      <span aria-hidden="true" className={"shrink-0 " + style.tone}>
        {style.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-2">
          <span className="font-medium text-foreground">{step.label}</span>
          {step.round !== undefined ? (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              第 {step.round} 轮
            </span>
          ) : null}
          <span className="text-[10px] text-muted-foreground">{traceStatusLabel(step.status)}</span>
        </span>
        {step.detail ? (
          <span className="mt-0.5 block break-words text-muted-foreground">{step.detail}</span>
        ) : null}
        {step.error ? (
          <span className="mt-0.5 block break-words text-red-300">{step.error}</span>
        ) : null}
      </span>
      <span className="shrink-0 text-right font-mono text-[11px] text-muted-foreground">
        {step.ttft_ms !== undefined ? (
          <span className="mr-2 text-[10px]">首字 {formatDuration(step.ttft_ms)}</span>
        ) : null}
        {formatDuration(step.duration_ms)}
      </span>
    </li>
  );
}

interface AgentTracePanelProps {
  state: AgentTraceViewState;
  policy: AgentTracePolicy;
}

/** 执行轨迹面板；不可见时渲染为空。 */
export function AgentTracePanel({ state, policy }: AgentTracePanelProps) {
  const run = state.run;
  const runId = run?.run_id ?? "";
  // 折叠状态用「本轮覆盖值」表达：换一轮执行后自动回到默认展开，无需副作用重置。
  const [collapseOverride, setCollapseOverride] = useState<{
    runId: string;
    collapsed: boolean;
  } | null>(null);
  const liveElapsed = useLiveElapsed(state.phase === "live", runId);

  if (!isTraceVisible(state) || !run) {
    return null;
  }

  const defaultCollapsed = state.phase === "lingering" && policy === "keep-collapsed";
  const collapsed =
    collapseOverride && collapseOverride.runId === runId
      ? collapseOverride.collapsed
      : defaultCollapsed;
  const totalMs = state.phase === "live" ? liveElapsed : run.duration_ms;
  const headTone = state.phase === "live" ? STEP_STATUS_TONES.running : STEP_STATUS_TONES[run.status];

  return (
    <section
      aria-label="执行轨迹"
      className="rounded-lg border border-border bg-muted/20 px-3 py-2"
    >
      <button
        type="button"
        onClick={() => setCollapseOverride({ runId, collapsed: !collapsed })}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-2 text-left text-xs"
      >
        <span aria-hidden="true" className={"h-1.5 w-1.5 shrink-0 rounded-full " + headTone} />
        <span className="font-medium text-foreground">执行轨迹</span>
        <span className="tabular-nums text-muted-foreground">{buildSummary(run, totalMs)}</span>
        <span className="ml-auto text-[10px] text-muted-foreground">{collapsed ? "展开" : "收起"}</span>
      </button>
      {!collapsed ? (
        <>
          <ol className="mt-1.5 border-t border-border/60 pt-1.5">
            {run.steps.map((step) => (
              <TraceStepRow key={step.id} step={step} />
            ))}
          </ol>
          {run.truncated ? (
            <p className="mt-1 text-[10px] text-amber-300">
              步骤过多，仅展示前 {run.steps.length} 步。
            </p>
          ) : null}
          <p className="mt-1 text-[10px] text-muted-foreground">
            {state.phase === "live"
              ? "正在执行，结束后将按设置处理轨迹。"
              : policy === "ephemeral"
                ? "轨迹已结束，即将自动清除。"
                : "轨迹已结束，折叠保留（可在右上角设置中改为自动清除）。"}
          </p>
        </>
      ) : null}
    </section>
  );
}