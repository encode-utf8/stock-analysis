

import { validate } from "node-cron";

import { SAMPLE_CODES } from "@/lib/market";
import { objectExists, isR2Configured } from "@/lib/r2";
import { store } from "@/lib/store";
import type {
  DataSourceState,
  DataSourceStatus,
  JobRun,
  SchedulerJob,
} from "@/lib/shared/types";

/** 数据源健康视图：在冻结的 SchedulerJob 契约上补充最近状态与运行历史。 */
export interface SchedulerJobView extends Omit<SchedulerJob, "target"> {
  status: JobRun["status"] | "idle";
  runs: JobRun[];
  target: SchedulerJob["target"] | "fund";
}

/** 管理员数据源面板返回快照。 */
export interface DataSourceHealthSnapshot {
  sources: DataSourceStatus[];
  jobs: SchedulerJobView[];
}

const DATA_SERVICE_URL = (
  process.env.DATA_SERVICE_URL ?? "http://127.0.0.1:8000"
).replace(/\/$/, "");

const TAVILY_URL = "https://api.tavily.com/search";

/** 各数据源最近成功时间，进程内存记录，单机 MVP 足够。 */
const lastSuccessAt = new Map<string, string>();

/** 各数据源连续失败次数，成功时归零。 */
const consecutiveFailures = new Map<string, number>();

/** 判断密钥是否已填写且不是示例占位值。 */
function hasRealKey(value: string | undefined): boolean {
  return Boolean(value && value !== "replace-me");
}

/** 记录一次成功探测，重置失败计数。 */
function markSuccess(source: string): void {
  lastSuccessAt.set(source, new Date().toISOString());
  consecutiveFailures.set(source, 0);
}

/** 记录一次失败探测，失败次数递增。 */
function markFailure(source: string): void {
  consecutiveFailures.set(source, (consecutiveFailures.get(source) ?? 0) + 1);
}

/** 构造统一的数据源健康状态。 */
function buildStatus(
  source: string,
  state: DataSourceState,
  latencyMs: number | null,
  message?: string,
): DataSourceStatus {
  return {
    source,
    state,
    healthy: state === "online",
    latency_ms: latencyMs,
    last_checked_at: new Date().toISOString(),
    last_success_at: lastSuccessAt.get(source) ?? null,
    consecutive_failures: consecutiveFailures.get(source) ?? 0,
    message,
  };
}

/** 带超时的网络请求，避免外部服务拖慢面板加载。 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 探测 AkShare/Tencent 行情侧车：真实上游可用时 online，回退数据时 degraded。 */
async function probeMarketData(): Promise<DataSourceStatus> {
  const source = "AkShare/Tencent";
  const startedAt = Date.now();
  const code = SAMPLE_CODES[0];

  try {
    const response = await fetchWithTimeout(
      `${DATA_SERVICE_URL}/quote?code=${encodeURIComponent(code)}`,
      { headers: { Accept: "application/json" }, cache: "no-store" },
      8_000,
    );

    if (!response.ok) {
      throw new Error(`行情侧车响应异常：${response.status}`);
    }

    const payload = (await response.json()) as {
      source?: string;
      code?: string;
      price?: number;
    };
    const latencyMs = Date.now() - startedAt;
    const isRealUpstream =
      payload.source === "akshare" || payload.source === "tencent";

    if (isRealUpstream) {
      markSuccess(source);
      return buildStatus(source, "online", latencyMs);
    }

    markFailure(source);
    return buildStatus(
      source,
      "degraded",
      latencyMs,
      "行情侧车已连通，但 AkShare/Tencent 上游不可用，当前返回确定性回退数据。",
    );
  } catch (error) {
    markFailure(source);
    const message = error instanceof Error ? error.message : "行情侧车连接失败";
    return buildStatus(source, "offline", null, `${message}；页面将使用确定性回退数据。`);
  }
}

/** 探测基金数据侧车：真实 AkShare 基金接口可用时 online，确定性回退时 degraded。 */
async function probeFundData(): Promise<DataSourceStatus> {
  const source = "AkShare/基金";
  const startedAt = Date.now();
  const code = "510300";

  try {
    const response = await fetchWithTimeout(
      `${DATA_SERVICE_URL}/fund/profile?code=${encodeURIComponent(code)}`,
      { headers: { Accept: "application/json" }, cache: "no-store" },
      8_000,
    );

    if (!response.ok) {
      throw new Error(`基金侧车响应异常：${response.status}`);
    }

    const payload = (await response.json()) as {
      source?: string;
      code?: string;
      name?: string;
    };
    const latencyMs = Date.now() - startedAt;
    if (payload.source === "akshare") {
      markSuccess(source);
      return buildStatus(source, "online", latencyMs);
    }

    markFailure(source);
    return buildStatus(
      source,
      "degraded",
      latencyMs,
      "基金侧车已连通，但 AkShare 基金上游不可用，当前返回确定性回退数据。",
    );
  } catch (error) {
    markFailure(source);
    const message = error instanceof Error ? error.message : "基金侧车连接失败";
    return buildStatus(source, "offline", null, `${message}；基金数据将使用确定性回退数据。`);
  }
}

/** 探测 Tavily：未配置密钥时降级，配置后请求轻量搜索校验可用性。 */
async function probeTavily(): Promise<DataSourceStatus> {
  const source = "Tavily";
  const apiKey = process.env.TAVILY_API_KEY;

  if (!hasRealKey(apiKey)) {
    return buildStatus(
      source,
      "degraded",
      null,
      "未配置 TAVILY_API_KEY，资讯检索将使用本地演示数据。",
    );
  }

  const startedAt = Date.now();
  try {
    const response = await fetchWithTimeout(
      TAVILY_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query: "stock market health check",
          max_results: 1,
          search_depth: "basic",
          include_answer: false,
        }),
      },
      8_000,
    );

    if (!response.ok) {
      throw new Error(`Tavily 响应异常：${response.status}`);
    }

    markSuccess(source);
    return buildStatus(source, "online", Date.now() - startedAt);
  } catch (error) {
    markFailure(source);
    const message = error instanceof Error ? error.message : "Tavily 请求失败";
    return buildStatus(source, "offline", null, message);
  }
}

/** 探测 DeepSeek：未配置密钥时降级，配置后校验模型列表接口。 */
async function probeDeepSeek(): Promise<DataSourceStatus> {
  const source = "DeepSeek";
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!hasRealKey(apiKey)) {
    return buildStatus(
      source,
      "degraded",
      null,
      "未配置 DEEPSEEK_API_KEY，AI 分析与对话将使用降级能力。",
    );
  }

  const baseUrl = (
    process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com"
  ).replace(/\/$/, "");
  const startedAt = Date.now();

  try {
    const response = await fetchWithTimeout(
      `${baseUrl}/models`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      },
      8_000,
    );

    if (!response.ok) {
      throw new Error(`DeepSeek 响应异常：${response.status}`);
    }

    markSuccess(source);
    return buildStatus(source, "online", Date.now() - startedAt);
  } catch (error) {
    markFailure(source);
    const message = error instanceof Error ? error.message : "DeepSeek 请求失败";
    return buildStatus(source, "offline", null, message);
  }
}

/** 探测 Cloudflare R2：未配置时降级，配置后验证对象存储可达性。 */
async function probeR2(): Promise<DataSourceStatus> {
  const source = "R2";

  if (!isR2Configured()) {
    return buildStatus(
      source,
      "degraded",
      null,
      "未配置完整 R2 密钥，报告与资讯快照暂不上传。",
    );
  }

  const startedAt = Date.now();
  try {
    await objectExists("__health_check__");
    markSuccess(source);
    return buildStatus(source, "online", Date.now() - startedAt);
  } catch (error) {
    markFailure(source);
    const message = error instanceof Error ? error.message : "R2 连接失败";
    return buildStatus(source, "offline", null, message);
  }
}

/** 按调度任务名称过滤最近的 job_runs，并保持时间降序。 */
function runsFor(runs: JobRun[], jobName: string): JobRun[] {
  return runs
    .filter((run) => run.job_name === jobName)
    .sort((left, right) => right.started_at.localeCompare(left.started_at));
}

/** 将 refresh/cleanup 的 cron 与 job_runs 历史组装为调度任务视图。 */
export async function getSchedulerJobViews(): Promise<SchedulerJobView[]> {
  const allRuns = await store.jobRuns.listRecent(50);
  const refreshRuns = runsFor(allRuns, "refresh").slice(0, 8);
  const cleanupRuns = runsFor(allRuns, "cleanup").slice(0, 8);
  const fundRefreshRuns = runsFor(allRuns, "fund-refresh").slice(0, 8);
  const now = new Date().toISOString();
  const refreshCron = process.env.REFRESH_CRON ?? "30 3 * * *";
  const cleanupCron = process.env.CLEANUP_CRON ?? "0 3 * * *";
  const fundRefreshCron = process.env.FUND_REFRESH_CRON ?? "45 3 * * *";
  const latestRefresh = refreshRuns[0] ?? null;
  const latestCleanup = cleanupRuns[0] ?? null;
  const latestFundRefresh = fundRefreshRuns[0] ?? null;

  return [
    {
      id: "refresh",
      name: "refresh",
      cron: refreshCron,
      target: "quote" as const,
      enabled: validate(refreshCron),
      created_at: latestRefresh?.started_at ?? now,
      updated_at: latestRefresh?.finished_at ?? latestRefresh?.started_at ?? now,
      last_run_at: latestRefresh?.started_at ?? null,
      next_run_at: null,
      status: latestRefresh?.status ?? "idle",
      runs: refreshRuns,
    },
    {
      id: "cleanup",
      name: "cleanup",
      cron: cleanupCron,
      target: "news" as const,
      enabled: validate(cleanupCron),
      created_at: latestCleanup?.started_at ?? now,
      updated_at: latestCleanup?.finished_at ?? latestCleanup?.started_at ?? now,
      last_run_at: latestCleanup?.started_at ?? null,
      next_run_at: null,
      status: latestCleanup?.status ?? "idle",
      runs: cleanupRuns,
    },
    {
      id: "fund-refresh",
      name: "fund-refresh",
      cron: fundRefreshCron,
      target: "fund" as const,
      enabled: validate(fundRefreshCron),
      created_at: latestFundRefresh?.started_at ?? now,
      updated_at: latestFundRefresh?.finished_at ?? latestFundRefresh?.started_at ?? now,
      last_run_at: latestFundRefresh?.started_at ?? null,
      next_run_at: null,
      status: latestFundRefresh?.status ?? "idle",
      runs: fundRefreshRuns,
    },
  ];
}

/** 并发执行四类数据源健康探测，并汇总调度任务视图。 */
export async function getDataSourceHealthSnapshot(): Promise<DataSourceHealthSnapshot> {
  const [market, fund, tavily, deepSeek, r2] = await Promise.all([
    probeMarketData(),
    probeFundData(),
    probeTavily(),
    probeDeepSeek(),
    probeR2(),
  ]);
  const jobs = await getSchedulerJobViews();

  return {
    sources: [market, fund, tavily, deepSeek, r2],
    jobs,
  };
}
