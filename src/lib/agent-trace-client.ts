"use client";

// Agent 执行轨迹前端状态机：服务端全量快照覆盖本地状态，并管理轨迹生命周期。
// 轨迹是运行期临时产物：默认结束后自动清理，用户可在设置里切换为折叠保留。

import { useCallback, useEffect, useSyncExternalStore } from "react";

import type { AgentTracePolicy, AgentTraceRun, AgentTraceStatus } from "@/lib/shared/types";

/** 轨迹生命周期：idle 未开始 → live 运行中 → lingering 结束待清理 → cleared 已清理。 */
export type AgentTracePhase = "idle" | "live" | "lingering" | "cleared";

/** 前端轨迹视图状态。 */
export interface AgentTraceViewState {
  phase: AgentTracePhase;
  run: AgentTraceRun | null;
}

/** 一轮执行的结束方式。 */
export type AgentTraceOutcome = "done" | "error" | "abort";

/** 结束到清理之间的停留时长（毫秒），仅用于让用户看清最后一步。 */
export const TRACE_LINGER_MS = 800;

/** 留存策略的本地存储键。 */
export const TRACE_POLICY_STORAGE_KEY = "stock-analysis:agent-trace-policy";

/** 默认状态：没有轨迹。 */
export const IDLE_TRACE_STATE: AgentTraceViewState = { phase: "idle", run: null };

/** 开始一轮新轨迹；同一轮里重复调用等价于重置。 */
export function startTraceState(run: AgentTraceRun): AgentTraceViewState {
  return { phase: "live", run };
}

/** 应用一次轨迹快照：整体覆盖，重复与乱序事件都不会产生重复步骤。 */
export function applyTraceSnapshot(
  state: AgentTraceViewState,
  run: AgentTraceRun,
): AgentTraceViewState {
  // 已清理后迟到的运行中快照直接忽略，避免轨迹残留。
  if (state.phase === "cleared" && run.status === "running") {
    return state;
  }
  return { phase: "live", run };
}

/** 推进结束后的生命周期：中断立即清除，其余进入待清理状态。 */
export function finishTrace(
  state: AgentTraceViewState,
  outcome: AgentTraceOutcome,
): AgentTraceViewState {
  if (!state.run) {
    return state;
  }
  if (outcome === "abort") {
    return IDLE_TRACE_STATE;
  }
  return { phase: "lingering", run: state.run };
}

/** 清理轨迹：结束后由定时器调用，或用户中断时立即调用。 */
export function clearTrace(state: AgentTraceViewState): AgentTraceViewState {
  if (state.phase === "idle") {
    return state;
  }
  return { phase: "cleared", run: null };
}

/** 轨迹面板是否需要渲染。 */
export function isTraceVisible(state: AgentTraceViewState): boolean {
  return (state.phase === "live" || state.phase === "lingering") && Boolean(state.run);
}

/** 结束后是否需要自动清理（瞬时策略下为 true）。 */
export function shouldAutoClear(policy: AgentTracePolicy, state: AgentTraceViewState): boolean {
  return policy === "ephemeral" && state.phase === "lingering";
}

/** 步骤状态到中文标签。 */
export function traceStatusLabel(status: AgentTraceStatus): string {
  if (status === "running") {
    return "进行中";
  }
  if (status === "failed") {
    return "失败";
  }
  if (status === "skipped") {
    return "已跳过";
  }
  if (status === "aborted") {
    return "已中断";
  }
  return "已完成";
}

/** 把毫秒格式化成便于阅读的耗时文本。 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) {
    return "--";
  }
  if (ms < 1000) {
    return Math.round(ms) + "ms";
  }
  if (ms < 60000) {
    return (ms / 1000).toFixed(1) + "s";
  }
  return (ms / 60000).toFixed(1) + "min";
}

/** 折叠态摘要：步骤数与累计耗时。 */
export function describeTraceSummary(run: AgentTraceRun | null): string {
  if (!run) {
    return "";
  }
  const doneSteps = run.steps.filter((step) => step.status !== "running").length;
  const parts = [run.steps.length + " 步"];
  if (doneSteps < run.steps.length) {
    parts.push("已完成 " + doneSteps + " 步");
  }
  parts.push(formatDuration(run.duration_ms));
  return parts.join(" · ");
}

/** 是否具备浏览器环境（SSR 与单测下没有 window）。 */
function hasWindow(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

let cachedPolicy: AgentTracePolicy | null = null;
const policyListeners = new Set<() => void>();

/** 读取留存策略；默认 ephemeral（结束后清除）。 */
export function readTracePolicy(): AgentTracePolicy {
  if (cachedPolicy) {
    return cachedPolicy;
  }
  if (!hasWindow()) {
    return "ephemeral";
  }
  try {
    const raw = window.localStorage.getItem(TRACE_POLICY_STORAGE_KEY);
    cachedPolicy = raw === "keep-collapsed" ? "keep-collapsed" : "ephemeral";
  } catch {
    cachedPolicy = "ephemeral";
  }
  return cachedPolicy;
}

/** 写入留存策略并通知订阅者。 */
export function writeTracePolicy(policy: AgentTracePolicy): void {
  cachedPolicy = policy;
  if (hasWindow()) {
    try {
      window.localStorage.setItem(TRACE_POLICY_STORAGE_KEY, policy);
    } catch {
      // 隐私模式等场景写入失败时忽略，仅影响下次打开时的即时生效。
    }
  }
  for (const listener of policyListeners) {
    listener();
  }
}

/** 订阅留存策略变化，供 useSyncExternalStore 使用。 */
export function subscribeTracePolicy(listener: () => void): () => void {
  policyListeners.add(listener);
  return () => {
    policyListeners.delete(listener);
  };
}

/** React Hook：读取并订阅留存策略（客户端）。 */
export function useAgentTracePolicy(): [AgentTracePolicy, (policy: AgentTracePolicy) => void] {
  const policy = useSyncExternalStore(subscribeTracePolicy, readTracePolicy, (): AgentTracePolicy => "ephemeral");
  const update = useCallback((next: AgentTracePolicy) => writeTracePolicy(next), []);
  return [policy, update];
}

/**
 * React Hook：轨迹结束后按留存策略自动清理。
 * clear 必须引用稳定（用 useCallback 包裹），否则重渲染会不断重置计时器。
 */
export function useTraceAutoClear(
  state: AgentTraceViewState,
  policy: AgentTracePolicy,
  clear: () => void,
): void {
  useEffect(() => {
    if (!shouldAutoClear(policy, state)) {
      return;
    }
    const timer = window.setTimeout(clear, TRACE_LINGER_MS);
    return () => window.clearTimeout(timer);
  }, [clear, policy, state]);
}