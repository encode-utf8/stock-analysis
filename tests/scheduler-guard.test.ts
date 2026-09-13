// 调度守护层测试：调度表、过期判定、状态汇总、补跑编排与写接口鉴权。
// 所有外部依赖（job_runs、日报落盘）都用模块替身，不访问真实数据库与网络。
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listRecent: vi.fn(),
  dailyReportExists: vi.fn(),
}));

vi.mock("@/lib/store", () => ({
  store: {
    jobRuns: {
      listRecent: mocks.listRecent,
      insert: vi.fn(async () => undefined),
    },
  },
}));

vi.mock("@/lib/daily-report-store", () => ({
  dailyReportExists: mocks.dailyReportExists,
}));

import {
  authorizeSchedulerRequest,
  beijingHour,
  collectTaskStates,
  evaluateTask,
  pickTaskStates,
  resolveCron,
  runSchedulerTick,
  SCHEDULE_TABLE,
  selectStaleTasks,
  summarizeSchedulerStatus,
} from "@/lib/scheduler-guard";
import type { ScheduleEntry, ScheduleStateMap } from "@/lib/scheduler-guard";
import type { JobRun } from "@/lib/shared/types";

const TRADING_ALWAYS = () => true;
const NEVER_TRADING = () => false;

/** 取调度表中的任务定义；key 不存在时直接失败，避免测试悄悄失去意义。 */
function entryOf(key: string): ScheduleEntry {
  const found = SCHEDULE_TABLE.find((entry) => entry.key === key);
  if (!found) {
    throw new Error(`调度表缺少任务 ${key}`);
  }
  return found;
}

/** 构造一条 job_runs 记录，只关心守护判定用到的字段。 */
function jobRun(overrides: Partial<JobRun> & { id: string; started_at: string }): JobRun {
  return {
    job_name: "cleanup",
    status: "success",
    finished_at: overrides.started_at,
    detail: null,
    ...overrides,
  };
}

/** 把状态收窄为必然存在的形态，便于断言。 */
function stateOf(states: ScheduleStateMap, key: string) {
  const state = states[key];
  if (!state) {
    throw new Error(`状态缺少任务 ${key}`);
  }
  return state;
}

beforeEach(() => {
  mocks.listRecent.mockReset();
  mocks.dailyReportExists.mockReset();
  mocks.listRecent.mockResolvedValue([]);
  mocks.dailyReportExists.mockResolvedValue(false);
});

describe("调度表与 cron 配置", () => {
  it("包含 6 个任务且 key 唯一", () => {
    expect(SCHEDULE_TABLE).toHaveLength(6);
    const keys = SCHEDULE_TABLE.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("默认表达式与 startScheduler 既有配置一致", () => {
    const defaults = Object.fromEntries(
      SCHEDULE_TABLE.map((entry) => [entry.key, entry.defaultCron]),
    );
    expect(defaults).toEqual({
      "news-cleanup": "0 3 * * *",
      "sample-quote-refresh": "30 3 * * *",
      "sample-fund-refresh": "45 3 * * *",
      "alert-scan": "*/30 9-15 * * 1-5",
      "daily-stock-report": "*/10 15-16 * * 1-5",
      "daily-fund-report": "*/20 20-23 * * 1-5",
    });
  });

  it("resolveCron 优先环境变量，留空时回退默认值", () => {
    const entry = entryOf("news-cleanup");
    expect(resolveCron(entry, { CLEANUP_CRON: "0 5 * * *" })).toBe("0 5 * * *");
    expect(resolveCron(entry, { CLEANUP_CRON: "   " })).toBe(entry.defaultCron);
    expect(resolveCron(entry, {})).toBe(entry.defaultCron);
  });
});

describe("beijingHour", () => {
  it("按北京时间取小时数", () => {
    expect(beijingHour(new Date("2026-09-13T02:30:00.000Z"))).toBe(10);
    expect(beijingHour(new Date("2026-09-13T16:10:00.000Z"))).toBe(0);
  });
});

describe("pickTaskStates", () => {
  const now = new Date("2026-09-13T08:30:00.000Z");

  it("没有记录时全部为空", () => {
    const states = pickTaskStates([], now);
    for (const entry of SCHEDULE_TABLE) {
      expect(stateOf(states, entry.key)).toEqual({ lastRunAt: null, satisfiedToday: false });
    }
  });

  it("日报任务按 detail.kind 区分股市与基金", () => {
    const states = pickTaskStates(
      [
        jobRun({
          id: "run-stock",
          job_name: "daily-report",
          started_at: "2026-09-13T07:30:00.000Z",
          detail: { kind: "stock" },
        }),
      ],
      now,
    );
    expect(stateOf(states, "daily-stock-report")).toEqual({
      lastRunAt: "2026-09-13T07:30:00.000Z",
      satisfiedToday: true,
    });
    expect(stateOf(states, "daily-fund-report")).toEqual({
      lastRunAt: null,
      satisfiedToday: false,
    });
  });

  it("当天成功才算完成，当天失败与昨天成功都不算", () => {
    const states = pickTaskStates(
      [
        jobRun({
          id: "run-failed",
          job_name: "refresh",
          status: "failed",
          started_at: "2026-09-13T06:00:00.000Z",
        }),
        jobRun({
          id: "run-yesterday",
          job_name: "cleanup",
          started_at: "2026-09-12T10:00:00.000Z",
        }),
      ],
      now,
    );
    const refresh = stateOf(states, "sample-quote-refresh");
    expect(refresh.lastRunAt).toBe("2026-09-13T06:00:00.000Z");
    expect(refresh.satisfiedToday).toBe(false);
    const cleanup = stateOf(states, "news-cleanup");
    expect(cleanup.lastRunAt).toBe("2026-09-12T10:00:00.000Z");
    expect(cleanup.satisfiedToday).toBe(false);
  });
});

describe("evaluateTask 与 selectStaleTasks", () => {
  it("非交易日不补跑仅交易日的任务", () => {
    const evaluation = evaluateTask(entryOf("alert-scan"), {
      now: new Date("2026-09-13T08:30:00.000Z"),
      states: {},
      isTradingDay: NEVER_TRADING,
    });
    expect(evaluation.stale).toBe(false);
    expect(evaluation.skipReason).toBe("非交易日");
  });

  it("未到触发时段不补跑日报任务", () => {
    const evaluation = evaluateTask(entryOf("daily-stock-report"), {
      now: new Date("2026-09-13T06:00:00.000Z"),
      states: {},
      isTradingDay: TRADING_ALWAYS,
    });
    expect(evaluation.stale).toBe(false);
    expect(evaluation.skipReason).toContain("未到触发时段");
  });

  it("interval 任务按距上次运行的时长判定", () => {
    const now = new Date("2026-09-13T08:30:00.000Z");
    const entry = entryOf("sample-quote-refresh");

    const missing = evaluateTask(entry, { now, states: {}, isTradingDay: TRADING_ALWAYS });
    expect(missing.stale).toBe(true);
    expect(missing.lastRunAgeMinutes).toBeNull();

    const fresh = evaluateTask(entry, {
      now,
      states: {
        "sample-quote-refresh": {
          lastRunAt: "2026-09-13T05:30:00.000Z",
          satisfiedToday: true,
        },
      },
      isTradingDay: TRADING_ALWAYS,
    });
    expect(fresh.stale).toBe(false);
    expect(fresh.lastRunAgeMinutes).toBe(180);
    expect(fresh.skipReason).toBe("未到期");

    const overdue = evaluateTask(entry, {
      now,
      states: {
        "sample-quote-refresh": {
          lastRunAt: "2026-09-12T02:00:00.000Z",
          satisfiedToday: false,
        },
      },
      isTradingDay: TRADING_ALWAYS,
    });
    expect(overdue.stale).toBe(true);
    expect(overdue.skipReason).toBeNull();
  });

  it("daily 任务看当天是否完成", () => {
    const now = new Date("2026-09-13T08:30:00.000Z");
    const entry = entryOf("daily-stock-report");

    const pending = evaluateTask(entry, { now, states: {}, isTradingDay: TRADING_ALWAYS });
    expect(pending.stale).toBe(true);

    const done = evaluateTask(entry, {
      now,
      states: { "daily-stock-report": { lastRunAt: null, satisfiedToday: true } },
      isTradingDay: TRADING_ALWAYS,
    });
    expect(done.stale).toBe(false);
    expect(done.skipReason).toBe("当天已完成");
  });

  it("selectStaleTasks 只返回过期任务", () => {
    const now = new Date("2026-09-13T08:30:00.000Z");
    const stale = selectStaleTasks({
      now,
      states: {
        "news-cleanup": { lastRunAt: "2026-09-13T07:30:00.000Z", satisfiedToday: true },
        "alert-scan": { lastRunAt: "2026-09-13T08:00:00.000Z", satisfiedToday: true },
        "daily-fund-report": { lastRunAt: null, satisfiedToday: true },
      },
      isTradingDay: TRADING_ALWAYS,
    });
    expect(stale.map((entry) => entry.key)).toEqual([
      "sample-quote-refresh",
      "sample-fund-refresh",
      "daily-stock-report",
    ]);
  });
});

describe("collectTaskStates", () => {
  it("当天日报已落盘时视为已完成", async () => {
    mocks.listRecent.mockResolvedValue([]);
    mocks.dailyReportExists.mockImplementation(async (kind: string) => kind === "fund");

    const states = await collectTaskStates(new Date("2026-09-13T12:30:00.000Z"));
    expect(stateOf(states, "daily-fund-report").satisfiedToday).toBe(true);
    expect(stateOf(states, "daily-stock-report").satisfiedToday).toBe(false);
    expect(mocks.dailyReportExists).toHaveBeenCalledWith("fund", "2026-09-13");
    expect(mocks.dailyReportExists).toHaveBeenCalledWith("stock", "2026-09-13");
  });
});

describe("summarizeSchedulerStatus", () => {
  it("汇总每个任务的过期状态、cron 与跳过原因", () => {
    const summary = summarizeSchedulerStatus({
      now: new Date("2026-09-13T08:30:00.000Z"),
      states: {
        "news-cleanup": { lastRunAt: "2026-09-13T07:30:00.000Z", satisfiedToday: true },
      },
      isTradingDay: TRADING_ALWAYS,
      schedulerRegistered: true,
      timezone: "Asia/Shanghai",
    });

    expect(summary.schedulerRegistered).toBe(true);
    expect(summary.tradingDay).toBe(true);
    expect(summary.timezone).toBe("Asia/Shanghai");
    expect(summary.tasks).toHaveLength(6);
    expect(summary.staleCount).toBe(4);

    const cleanup = summary.tasks.find((task) => task.key === "news-cleanup");
    expect(cleanup?.stale).toBe(false);
    expect(cleanup?.skipReason).toBe("未到期");
    expect(cleanup?.staleAfterMinutes).toBe(1560);
    expect(cleanup?.lastRunAt).toBe("2026-09-13T07:30:00.000Z");

    const fundReport = summary.tasks.find((task) => task.key === "daily-fund-report");
    expect(fundReport?.staleAfterMinutes).toBeNull();
    expect(fundReport?.skipReason).toContain("未到触发时段");
  });
});

describe("runSchedulerTick", () => {
  const now = new Date("2026-09-13T08:30:00.000Z");

  it("只补跑过期任务，单项失败不影响其它任务", async () => {
    const runners = {
      "news-cleanup": vi.fn(async () => undefined),
      "sample-quote-refresh": vi.fn(async () => {
        throw new Error("刷新失败");
      }),
      "sample-fund-refresh": vi.fn(async () => undefined),
      "alert-scan": vi.fn(async () => undefined),
      "daily-stock-report": vi.fn(async () => undefined),
      "daily-fund-report": vi.fn(async () => undefined),
    };

    const result = await runSchedulerTick({ now, runners, isTradingDay: TRADING_ALWAYS });

    expect(result.staleCount).toBe(5);
    expect(result.ranCount).toBe(4);
    expect(result.failedCount).toBe(1);
    expect(result.skippedCount).toBe(0);
    expect(runners["daily-fund-report"]).not.toHaveBeenCalled();

    const failed = result.tasks.find((task) => task.key === "sample-quote-refresh");
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toBe("刷新失败");
  });

  it("未注册执行器的任务记为 skipped", async () => {
    const result = await runSchedulerTick({
      now,
      runners: { "news-cleanup": vi.fn(async () => undefined) },
      isTradingDay: TRADING_ALWAYS,
    });

    expect(result.ranCount).toBe(1);
    expect(result.skippedCount).toBe(4);
    const skipped = result.tasks.filter((task) => task.status === "skipped");
    expect(skipped.every((task) => task.error === "未注册执行器")).toBe(true);
  });

  it("全部新鲜时不执行任何任务", async () => {
    mocks.listRecent.mockResolvedValue([
      jobRun({ id: "run-cleanup", job_name: "cleanup", started_at: "2026-09-13T08:00:00.000Z" }),
      jobRun({ id: "run-refresh", job_name: "refresh", started_at: "2026-09-13T08:00:00.000Z" }),
      jobRun({
        id: "run-fund",
        job_name: "fund-refresh",
        started_at: "2026-09-13T08:00:00.000Z",
      }),
      jobRun({ id: "run-alert", job_name: "alert-scan", started_at: "2026-09-13T08:00:00.000Z" }),
      jobRun({
        id: "run-daily",
        job_name: "daily-report",
        started_at: "2026-09-13T08:00:00.000Z",
        detail: { kind: "stock" },
      }),
      jobRun({
        id: "run-daily-fund",
        job_name: "daily-report",
        started_at: "2026-09-13T08:00:00.000Z",
        detail: { kind: "fund" },
      }),
    ]);
    const runners = { "news-cleanup": vi.fn(async () => undefined) };

    const result = await runSchedulerTick({ now, runners, isTradingDay: TRADING_ALWAYS });

    expect(result.staleCount).toBe(0);
    expect(runners["news-cleanup"]).not.toHaveBeenCalled();
  });
});

describe("authorizeSchedulerRequest", () => {
  const url = "http://127.0.0.1:3000/api/admin/scheduler/tick";

  it("配置令牌时要求请求头完全一致", () => {
    const env = { SCHEDULER_TOKEN: "secret-token" };

    const ok = authorizeSchedulerRequest(
      new Request(url, { method: "POST", headers: { "x-scheduler-token": "secret-token" } }),
      env,
    );
    expect(ok.ok).toBe(true);

    const wrong = authorizeSchedulerRequest(
      new Request(url, { method: "POST", headers: { "x-scheduler-token": "another" } }),
      env,
    );
    expect(wrong.ok).toBe(false);

    const missing = authorizeSchedulerRequest(new Request(url, { method: "POST" }), env);
    expect(missing.ok).toBe(false);
    expect(missing.reason).toContain("令牌");
  });

  it("未配置令牌时只允许本机来源", () => {
    const env = {};

    const direct = authorizeSchedulerRequest(new Request(url, { method: "POST" }), env);
    expect(direct.ok).toBe(true);

    const localProxy = authorizeSchedulerRequest(
      new Request(url, {
        method: "POST",
        headers: { "x-forwarded-for": "127.0.0.1, 10.0.0.8" },
      }),
      env,
    );
    expect(localProxy.ok).toBe(true);

    const ipv6 = authorizeSchedulerRequest(
      new Request(url, { method: "POST", headers: { "x-real-ip": "::1" } }),
      env,
    );
    expect(ipv6.ok).toBe(true);

    // Next 在 Node 服务端常以 IPv4 映射地址上报本机来源。
    const mapped = authorizeSchedulerRequest(
      new Request(url, { method: "POST", headers: { "x-forwarded-for": "::ffff:127.0.0.1" } }),
      env,
    );
    expect(mapped.ok).toBe(true);

    const remote = authorizeSchedulerRequest(
      new Request(url, {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.9" },
      }),
      env,
    );
    expect(remote.ok).toBe(false);
    expect(remote.reason).toContain("SCHEDULER_TOKEN");
  });
});
