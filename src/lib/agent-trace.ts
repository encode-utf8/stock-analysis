// Agent 执行轨迹记录器：为对话与分析链路提供步骤计时、状态流转与快照。
// 纯内存实现，不落库、不写文件；轨迹只存在于本次 SSE 生命周期内。

import type {
  AgentTraceRun,
  AgentTraceScope,
  AgentTraceStatus,
  AgentTraceStep,
  AgentTraceStepKind,
} from "@/lib/shared/types";

/** 步骤上限与摘要截断长度，防止异常循环产生噪声。 */
export const TRACE_LIMITS = { maxSteps: 24, detailMaxLength: 180 } as const;

/** 新建步骤的入参。 */
export interface TraceStepInput {
  kind: AgentTraceStepKind;
  label: string;
  detail?: string;
  round?: number;
}

/** 结束步骤时回填的字段。 */
export interface TraceStepFinishPatch {
  status?: AgentTraceStatus;
  detail?: string;
  error?: string;
}

/** 单步句柄：可标记首字时延并结束该步。 */
export interface TraceStepHandle {
  readonly id: string;
  /** 记录首字时延；仅首次调用生效。 */
  markToken(): void;
  /** 结束该步并回填耗时；重复调用无副作用；超出步骤上限时返回 null。 */
  finish(patch?: TraceStepFinishPatch): AgentTraceStep | null;
}

/** 单轮执行的记录器。 */
export interface TraceRunRecorder {
  readonly runId: string;
  startStep(input: TraceStepInput): TraceStepHandle;
  /** 包装一次异步操作：自动计时、自动回填成功 / 失败与错误摘要，失败时原样抛出。 */
  measure<T>(
    input: TraceStepInput,
    task: () => Promise<T>,
    detailOf?: (value: T) => string | undefined,
  ): Promise<T>;
  /** 结束整轮并回填总耗时；未结束的步骤按中断或跳过统一收尾。 */
  finish(status?: AgentTraceStatus): AgentTraceRun;
  /** 当前完整快照（深拷贝），用于推送 SSE。 */
  snapshot(): AgentTraceRun;
}

/** 文本摘要裁剪：去空白并按上限截断。 */
function clipDetail(text: string | undefined): string | undefined {
  if (typeof text !== "string") {
    return undefined;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > TRACE_LIMITS.detailMaxLength
    ? `${trimmed.slice(0, TRACE_LIMITS.detailMaxLength - 1)}…`
    : trimmed;
}

/** 创建一轮轨迹记录器；now 可注入，便于单测获得确定性耗时。 */
export function createTraceRun(
  scope: AgentTraceScope,
  target: string,
  now: () => number = Date.now,
): TraceRunRecorder {
  const runId = `trace-${scope}-${target}-${now().toString(36)}`;
  const runStartedAtMs = now();
  const steps: AgentTraceStep[] = [];
  let stepSeq = 0;
  let truncated = false;
  let runStatus: AgentTraceStatus = "running";
  let runFinishedAtMs: number | null = null;

  /** 已达步骤上限时返回空操作句柄，调用方无需分支。 */
  const overflowHandle: TraceStepHandle = {
    id: "step-overflow",
    markToken: () => undefined,
    finish: () => null,
  };

  function startStep(input: TraceStepInput): TraceStepHandle {
    if (steps.length >= TRACE_LIMITS.maxSteps) {
      truncated = true;
      return overflowHandle;
    }

    stepSeq += 1;
    const startedAtMs = now();
    const step: AgentTraceStep = {
      id: `step-${stepSeq}`,
      index: stepSeq,
      kind: input.kind,
      label: input.label,
      status: "running",
      started_at: new Date(startedAtMs).toISOString(),
    };
    const detail = clipDetail(input.detail);
    if (detail) {
      step.detail = detail;
    }
    if (input.round !== undefined) {
      step.round = input.round;
    }
    steps.push(step);

    let tokenAtMs: number | null = null;
    let closed = false;

    return {
      id: step.id,
      markToken() {
        if (tokenAtMs === null) {
          tokenAtMs = now();
        }
      },
      finish(patch) {
        if (closed) {
          return { ...step };
        }
        closed = true;
        const stepFinishedAtMs = now();
        const detailText = clipDetail(patch?.detail);
        if (detailText) {
          step.detail = detailText;
        }
        const errorText = clipDetail(patch?.error);
        if (errorText) {
          step.error = errorText;
        }
        step.status = patch?.status ?? (errorText ? "failed" : "success");
        step.finished_at = new Date(stepFinishedAtMs).toISOString();
        step.duration_ms = Math.max(0, stepFinishedAtMs - startedAtMs);
        if (tokenAtMs !== null) {
          step.ttft_ms = Math.max(0, tokenAtMs - startedAtMs);
        }
        return { ...step };
      },
    };
  }

  async function measure<T>(
    input: TraceStepInput,
    task: () => Promise<T>,
    detailOf?: (value: T) => string | undefined,
  ): Promise<T> {
    const handle = startStep(input);
    try {
      const value = await task();
      handle.finish({ detail: detailOf ? detailOf(value) : undefined });
      return value;
    } catch (error) {
      handle.finish({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  function snapshot(): AgentTraceRun {
    const run: AgentTraceRun = {
      run_id: runId,
      scope,
      target,
      status: runStatus,
      started_at: new Date(runStartedAtMs).toISOString(),
      steps: steps.map((step) => ({ ...step })),
    };
    if (runFinishedAtMs !== null) {
      run.finished_at = new Date(runFinishedAtMs).toISOString();
      run.duration_ms = Math.max(0, runFinishedAtMs - runStartedAtMs);
    }
    if (truncated) {
      run.truncated = true;
    }
    return run;
  }

  function finish(status: AgentTraceStatus = "success"): AgentTraceRun {
    if (runFinishedAtMs === null) {
      runFinishedAtMs = now();
    }
    runStatus = status;
    const leftoverStatus: AgentTraceStatus = status === "aborted" ? "aborted" : "skipped";
    for (const step of steps) {
      if (step.status !== "running") {
        continue;
      }
      step.status = leftoverStatus;
      step.finished_at = new Date(runFinishedAtMs).toISOString();
      step.duration_ms = Math.max(0, runFinishedAtMs - new Date(step.started_at).getTime());
    }
    return snapshot();
  }

  return { runId, startStep, measure, finish, snapshot };
}

/** 组装一条 SSE 轨迹事件；对话与分析链路共用。 */
export function traceEvent(run: AgentTraceRun): { type: "trace"; data: { trace: AgentTraceRun } } {
  return { type: "trace", data: { trace: run } };
}
