// 前端轨迹状态机测试：覆盖快照覆盖、生命周期、自清理判定与格式化。
import { describe, expect, it } from "vitest";

import {
  applyTraceSnapshot,
  clearTrace,
  describeTraceSummary,
  finishTrace,
  formatDuration,
  IDLE_TRACE_STATE,
  isTraceVisible,
  readTracePolicy,
  shouldAutoClear,
  startTraceState,
  traceStatusLabel,
  writeTracePolicy,
  type AgentTraceViewState,
} from "@/lib/agent-trace-client";
import type { AgentTraceRun, AgentTraceStep } from "@/lib/shared/types";

/** 构造一个最小可用的轨迹快照。 */
function buildRun(overrides: Partial<AgentTraceRun> = {}): AgentTraceRun {
  const step: AgentTraceStep = {
    id: "step-1",
    index: 1,
    kind: "tool",
    label: "读取行情快照",
    status: "success",
    started_at: "2026-09-20T01:00:00.000Z",
    finished_at: "2026-09-20T01:00:00.120Z",
    duration_ms: 120,
  };
  return {
    run_id: "trace-stock-chat-600519-1",
    scope: "stock-chat",
    target: "600519",
    status: "running",
    started_at: "2026-09-20T01:00:00.000Z",
    steps: [step],
    ...overrides,
  };
}

describe("轨迹快照合并", () => {
  it("快照整体覆盖并进入运行中状态", () => {
    const state = startTraceState(buildRun());
    const next = applyTraceSnapshot({
      ...state,
      run: buildRun({ steps: [] }),
    }, buildRun());

    expect(next.phase).toBe("live");
    expect(next.run?.steps).toHaveLength(1);
  });

  it("重复推送同一快照不产生重复步骤", () => {
    const run = buildRun();
    const first = applyTraceSnapshot(IDLE_TRACE_STATE, run);
    const second = applyTraceSnapshot(first, run);
    expect(second.run?.steps).toHaveLength(1);
  });

  it("已清理后忽略迟到的运行中快照", () => {
    const cleared: AgentTraceViewState = { phase: "cleared", run: null };
    const next = applyTraceSnapshot(cleared, buildRun());
    expect(next.phase).toBe("cleared");
    expect(next.run).toBeNull();
  });
});

describe("轨迹生命周期", () => {
  it("正常结束后进入待清理状态", () => {
    const state = finishTrace(startTraceState(buildRun()), "done");
    expect(state.phase).toBe("lingering");
    expect(state.run).not.toBeNull();
  });

  it("中断时立即清除，不残留半成品轨迹", () => {
    const state = finishTrace(startTraceState(buildRun()), "abort");
    expect(state.phase).toBe("idle");
    expect(state.run).toBeNull();
  });

  it("清理后仅在 cleared 状态可见性为否", () => {
    const lingering = finishTrace(startTraceState(buildRun()), "done");
    expect(isTraceVisible(lingering)).toBe(true);
    const cleared = clearTrace(lingering);
    expect(cleared.phase).toBe("cleared");
    expect(isTraceVisible(cleared)).toBe(false);
  });

  it("无轨迹时清理与结束均为空操作", () => {
    expect(clearTrace(IDLE_TRACE_STATE)).toBe(IDLE_TRACE_STATE);
    expect(finishTrace(IDLE_TRACE_STATE, "done")).toBe(IDLE_TRACE_STATE);
  });
});

describe("留存策略", () => {
  it("瞬时策略在结束后需要自动清理，保留策略不需要", () => {
    const lingering = finishTrace(startTraceState(buildRun()), "done");
    expect(shouldAutoClear("ephemeral", lingering)).toBe(true);
    expect(shouldAutoClear("keep-collapsed", lingering)).toBe(false);
  });

  it("运行中不触发自动清理", () => {
    expect(shouldAutoClear("ephemeral", startTraceState(buildRun()))).toBe(false);
  });

  it("策略可写入并读回", () => {
    writeTracePolicy("keep-collapsed");
    expect(readTracePolicy()).toBe("keep-collapsed");
    writeTracePolicy("ephemeral");
    expect(readTracePolicy()).toBe("ephemeral");
  });
});

describe("展示格式化", () => {
  it("按量级输出毫秒 / 秒 / 分钟", () => {
    expect(formatDuration(120)).toBe("120ms");
    expect(formatDuration(1400)).toBe("1.4s");
    expect(formatDuration(65000)).toBe("1.1min");
    expect(formatDuration(undefined)).toBe("--");
    expect(formatDuration(-1)).toBe("--");
  });

  it("步骤状态输出中文标签", () => {
    expect(traceStatusLabel("running")).toBe("进行中");
    expect(traceStatusLabel("failed")).toBe("失败");
    expect(traceStatusLabel("skipped")).toBe("已跳过");
    expect(traceStatusLabel("aborted")).toBe("已中断");
    expect(traceStatusLabel("success")).toBe("已完成");
  });

  it("折叠摘要包含步骤数与耗时", () => {
    const run = buildRun({
      duration_ms: 1400,
      steps: [
        { ...buildRun().steps[0] },
        { ...buildRun().steps[0], id: "step-2", index: 2, status: "running", duration_ms: undefined },
      ],
    });
    expect(describeTraceSummary(run)).toContain("2 步");
    expect(describeTraceSummary(run)).toContain("已完成 1 步");
    expect(describeTraceSummary(run)).toContain("1.4s");
    expect(describeTraceSummary(null)).toBe("");
  });
});