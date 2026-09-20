// Agent 轨迹记录器测试：注入可控时钟，覆盖计时、状态流转、并发、截断与快照隔离。
import { describe, expect, it } from "vitest";

import { TRACE_LIMITS, createTraceRun } from "@/lib/agent-trace";

/** 可控时钟：用例手动推进，保证耗时断言确定。 */
function createClock(start = 1_700_000_000_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe("轨迹记录器 - 计时与状态", () => {
  it("记录每步耗时并按完成时刻回填整轮总耗时", () => {
    const clock = createClock();
    const run = createTraceRun("stock-chat", "600519", clock.now);

    const step = run.startStep({ kind: "tool", label: "读取行情快照" });
    clock.advance(120);
    const finished = step.finish();

    expect(finished?.index).toBe(1);
    expect(finished?.status).toBe("success");
    expect(finished?.duration_ms).toBe(120);

    clock.advance(30);
    const snapshot = run.finish();
    expect(snapshot.status).toBe("success");
    expect(snapshot.duration_ms).toBe(150);
    expect(snapshot.steps).toHaveLength(1);
    expect(snapshot.scope).toBe("stock-chat");
    expect(snapshot.target).toBe("600519");
  });
});

describe("轨迹记录器 - 状态回填与幂等", () => {
  it("模型步骤记录首字时延，且不重复覆盖", () => {
    const clock = createClock();
    const run = createTraceRun("stock-chat", "600519", clock.now);

    const step = run.startStep({ kind: "thinking", label: "Thinking" });
    clock.advance(300);
    step.markToken();
    clock.advance(50);
    step.markToken();
    clock.advance(650);
    const finished = step.finish();

    expect(finished?.ttft_ms).toBe(300);
    expect(finished?.duration_ms).toBe(1000);
  });

  it("显式传 status 时覆盖推断结果", () => {
    const clock = createClock();
    const run = createTraceRun("fund-chat", "110011", clock.now);
    const step = run.startStep({ kind: "model", label: "生成回答" });
    expect(step.finish({ status: "skipped" })?.status).toBe("skipped");
  });

  it("重复结束同一步不产生副作用", () => {
    const clock = createClock();
    const run = createTraceRun("fund-chat", "110011", clock.now);
    const step = run.startStep({ kind: "data", label: "装配基金上下文" });
    clock.advance(80);
    const first = step.finish();
    clock.advance(500);
    const second = step.finish();
    expect(second?.duration_ms).toBe(first?.duration_ms);
  });
});

describe("轨迹记录器 - measure 包装", () => {
  it("成功时回填结果摘要，缺省时保留入参摘要", async () => {
    const clock = createClock();
    const run = createTraceRun("stock-analysis", "600519", clock.now);

    await run.measure({ kind: "data", label: "装配数据", detail: "行情 / K 线" }, async () => {
      clock.advance(200);
      return 3;
    });
    await run.measure(
      { kind: "data", label: "装配资讯" },
      async () => "ok",
      (value) => `返回 ${value}`,
    );

    const [first, second] = run.snapshot().steps;
    expect(first.detail).toBe("行情 / K 线");
    expect(first.duration_ms).toBe(200);
    expect(second.detail).toBe("返回 ok");
  });

  it("失败时标记 failed 并原样抛出", async () => {
    const clock = createClock();
    const run = createTraceRun("stock-analysis", "600519", clock.now);

    await expect(
      run.measure({ kind: "persist", label: "保存分析报告" }, async () => {
        clock.advance(40);
        throw new Error("数据库不可用");
      }),
    ).rejects.toThrow("数据库不可用");

    const [step] = run.snapshot().steps;
    expect(step.status).toBe("failed");
    expect(step.error).toBe("数据库不可用");
    expect(step.duration_ms).toBe(40);
  });
});

describe("轨迹记录器 - 并发与护栏", () => {
  it("并发步骤各自计时互不影响", () => {
    const clock = createClock();
    const run = createTraceRun("stock-chat", "600519", clock.now);

    const first = run.startStep({ kind: "tool", label: "读取行情快照" });
    clock.advance(100);
    const second = run.startStep({ kind: "tool", label: "检索相关资讯" });
    clock.advance(200);
    second.finish();
    clock.advance(300);
    first.finish();

    const [stepOne, stepTwo] = run.snapshot().steps;
    expect(stepOne.duration_ms).toBe(600);
    expect(stepTwo.duration_ms).toBe(200);
  });

  it("超过步骤上限后不再记录并标记截断", () => {
    const clock = createClock();
    const run = createTraceRun("stock-chat", "600519", clock.now);

    for (let index = 0; index < TRACE_LIMITS.maxSteps; index += 1) {
      run.startStep({ kind: "tool", label: `步骤 ${index + 1}` }).finish();
    }
    const overflow = run.startStep({ kind: "tool", label: "溢出步骤" });

    expect(overflow.finish()).toBeNull();
    const snapshot = run.finish();
    expect(snapshot.steps).toHaveLength(TRACE_LIMITS.maxSteps);
    expect(snapshot.truncated).toBe(true);
  });
});

describe("轨迹记录器 - 截断与收尾", () => {
  it("摘要超长时按上限截断", () => {
    const clock = createClock();
    const run = createTraceRun("stock-chat", "600519", clock.now);
    const step = run.startStep({
      kind: "tool",
      label: "读取 K 线数据",
      detail: "长".repeat(400),
    });
    const finished = step.finish();

    expect(finished?.detail?.length).toBe(TRACE_LIMITS.detailMaxLength);
    expect(finished?.detail?.endsWith("…")).toBe(true);
  });

  it("结束整轮时未完成步骤按中断收尾", () => {
    const clock = createClock();
    const run = createTraceRun("stock-chat", "600519", clock.now);
    run.startStep({ kind: "thinking", label: "Thinking" });
    clock.advance(60);

    const aborted = run.finish("aborted");
    expect(aborted.status).toBe("aborted");
    expect(aborted.steps[0].status).toBe("aborted");
    expect(aborted.steps[0].duration_ms).toBe(60);
    expect(aborted.duration_ms).toBe(60);
  });

  it("快照为深拷贝，外部修改不影响内部状态", () => {
    const clock = createClock();
    const run = createTraceRun("stock-chat", "600519", clock.now);
    run.startStep({ kind: "tool", label: "读取行情快照" }).finish();

    const snapshot = run.snapshot();
    snapshot.steps[0].label = "被外部改写";
    snapshot.steps.pop();

    const next = run.snapshot();
    expect(next.steps).toHaveLength(1);
    expect(next.steps[0].label).toBe("读取行情快照");
  });
});
