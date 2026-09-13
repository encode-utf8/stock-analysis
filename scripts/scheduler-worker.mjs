#!/usr/bin/env node
// 定时任务守护进程（独立于 Next 进程）。
// 职责：按固定间隔探测 Web 应用健康状态与调度状态，发现过期任务就调用补跑接口。
// 定位：进程内 cron 失效（进程重启、长时间停摆、cron 未注册）时的兜底，不是高可用调度器。
//
// 用法：
//   node scripts/scheduler-worker.mjs --once
//   node scripts/scheduler-worker.mjs --interval 300 --max-failures 5
//   node scripts/scheduler-worker.mjs --base-url http://127.0.0.1:3000 --token <SCHEDULER_TOKEN>
//
// 环境变量（命令行参数优先）：
//   SCHEDULER_BASE_URL           应用地址，默认 http://127.0.0.1:3000
//   SCHEDULER_TOKEN              写接口令牌，对应请求头 x-scheduler-token
//   SCHEDULER_WORKER_INTERVAL_S  轮询间隔（秒），默认 300
//   SCHEDULER_WORKER_MAX_FAILURES 连续失败上限，默认 5

const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const DEFAULT_INTERVAL_SECONDS = 300;
const DEFAULT_MAX_FAILURES = 5;
/** 健康检查与状态查询的超时（毫秒）。 */
const STATUS_TIMEOUT_MS = 15_000;
/** 补跑可能包含日报生成，超时给足 3 分钟。 */
const TICK_TIMEOUT_MS = 180_000;

const HELP_TEXT = `定时任务守护进程

用法：node scripts/scheduler-worker.mjs [选项]

选项：
  --once                 只执行一轮检查后退出（应用未启动时安全退出并打印原因）
  --interval <秒>        轮询间隔，默认 ${DEFAULT_INTERVAL_SECONDS}
  --max-failures <次数>  连续失败达到该次数后退出，默认 ${DEFAULT_MAX_FAILURES}
  --base-url <地址>      应用地址，默认 ${DEFAULT_BASE_URL}
  --token <令牌>         写接口令牌（等价于 SCHEDULER_TOKEN）
  -h, --help             显示本帮助
`;

/** 打印带时间戳的日志。 */
function log(message) {
  console.log(`[scheduler-worker] ${new Date().toISOString()} ${message}`);
}

/** 打印带时间戳的告警。 */
function warn(message) {
  console.warn(`[scheduler-worker] ${new Date().toISOString()} ${message}`);
}

/** 解析正整数参数，非法时抛错。 */
function parsePositiveInt(value, flag) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`参数 ${flag} 需要一个正整数，收到：${value}`);
  }
  return parsed;
}

/** 解析命令行参数与环境变量。 */
function parseConfig(argv) {
  const config = {
    once: false,
    help: false,
    baseUrl: (process.env.SCHEDULER_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, ""),
    token: process.env.SCHEDULER_TOKEN?.trim() ?? "",
    intervalSeconds: parsePositiveInt(
      process.env.SCHEDULER_WORKER_INTERVAL_S ?? String(DEFAULT_INTERVAL_SECONDS),
      "SCHEDULER_WORKER_INTERVAL_S",
    ),
    maxFailures: parsePositiveInt(
      process.env.SCHEDULER_WORKER_MAX_FAILURES ?? String(DEFAULT_MAX_FAILURES),
      "SCHEDULER_WORKER_MAX_FAILURES",
    ),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--once":
        config.once = true;
        break;
      case "-h":
      case "--help":
        config.help = true;
        break;
      case "--interval":
        config.intervalSeconds = parsePositiveInt(argv[index + 1], "--interval");
        index += 1;
        break;
      case "--max-failures":
        config.maxFailures = parsePositiveInt(argv[index + 1], "--max-failures");
        index += 1;
        break;
      case "--base-url":
        config.baseUrl = (argv[index + 1] ?? "").replace(/\/$/, "");
        index += 1;
        break;
      case "--token":
        config.token = (argv[index + 1] ?? "").trim();
        index += 1;
        break;
      default:
        throw new Error(`未知参数：${arg}`);
    }
  }

  if (!config.baseUrl) {
    throw new Error("--base-url 不能为空。");
  }
  return config;
}

/** 带超时的 fetch，返回解析后的 JSON 或标记失败。 */
async function requestJson(url, { method = "GET", token = "", timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { Accept: "application/json" };
    if (token) {
      headers["x-scheduler-token"] = token;
    }
    const response = await fetch(url, { method, headers, signal: controller.signal });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return { ok: response.ok, status: response.status, payload };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      payload: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 一轮完整的检查 + 补跑流程。 */
async function runCycle(config) {
  const health = await requestJson(`${config.baseUrl}/api/health`, {
    timeoutMs: STATUS_TIMEOUT_MS,
  });
  if (!health.ok) {
    return {
      ok: false,
      reason: `健康检查失败（${health.status || "无响应"}）：${config.baseUrl}/api/health 不可用，应用可能未启动`,
    };
  }

  const status = await requestJson(`${config.baseUrl}/api/admin/scheduler/status`, {
    token: config.token,
    timeoutMs: STATUS_TIMEOUT_MS,
  });
  if (!status.ok) {
    return { ok: false, reason: `读取调度状态失败：HTTP ${status.status || "无响应"}` };
  }

  const staleCount = status.payload?.data?.staleCount ?? 0;
  if (staleCount === 0) {
    return { ok: true, reason: "调度状态正常，无过期任务。" };
  }
  log(`发现 ${staleCount} 个过期任务，触发补跑……`);

  const tick = await requestJson(`${config.baseUrl}/api/admin/scheduler/tick`, {
    method: "POST",
    token: config.token,
    timeoutMs: TICK_TIMEOUT_MS,
  });
  if (!tick.ok) {
    const detail = tick.payload?.error?.message;
    return { ok: false, reason: `触发补跑失败：HTTP ${tick.status || "无响应"}${detail ? `（${detail}）` : ""}` };
  }

  const result = tick.payload?.data ?? {};
  const failed = result.failedCount ?? 0;
  return {
    ok: true,
    reason: `补跑完成：执行 ${result.ranCount ?? 0} 项，失败 ${failed} 项，跳过 ${result.skippedCount ?? 0} 项。`,
    failedCount: failed,
  };
}

const stopping = { value: false };
let wakeMain = null;
let sleepTimer = null;

/** 处理退出信号：停止轮询并唤醒等待中的定时器。 */
function requestStop(signal) {
  if (stopping.value) {
    return;
  }
  stopping.value = true;
  if (sleepTimer) {
    clearTimeout(sleepTimer);
    sleepTimer = null;
  }
  if (wakeMain) {
    const resolve = wakeMain;
    wakeMain = null;
    resolve();
  }
  log(`收到 ${signal}，正在优雅退出……`);
}

/** 可被退出信号打断的等待。 */
function sleep(ms) {
  return new Promise((resolve) => {
    wakeMain = resolve;
    sleepTimer = setTimeout(() => {
      sleepTimer = null;
      const done = wakeMain;
      wakeMain = null;
      if (done) {
        done();
      }
    }, ms);
  });
}

async function main() {
  let config;
  try {
    config = parseConfig(process.argv.slice(2));
  } catch (error) {
    warn(error instanceof Error ? error.message : String(error));
    console.error(HELP_TEXT);
    return 2;
  }

  if (config.help) {
    console.log(HELP_TEXT);
    return 0;
  }

  process.on("SIGINT", () => requestStop("SIGINT"));
  process.on("SIGTERM", () => requestStop("SIGTERM"));
  if (process.platform === "win32") {
    process.on("SIGBREAK", () => requestStop("SIGBREAK"));
  }

  log(
    `启动：目标 ${config.baseUrl}，间隔 ${config.intervalSeconds}s，最大连续失败 ${config.maxFailures}` +
      (config.once ? "，单次模式。" : "。"),
  );

  if (config.once) {
    const outcome = await runCycle(config);
    (outcome.ok ? log : warn)(outcome.reason);
    // 单次模式始终以 0 退出：应用未启动属于预期场景，避免启动脚本误判失败。
    return 0;
  }

  let consecutiveFailures = 0;
  while (!stopping.value) {
    const outcome = await runCycle(config);
    if (outcome.ok) {
      consecutiveFailures = 0;
      log(outcome.reason);
    } else {
      consecutiveFailures += 1;
      warn(`${outcome.reason}（连续失败 ${consecutiveFailures}/${config.maxFailures}）`);
      if (consecutiveFailures >= config.maxFailures) {
        warn("连续失败达到上限，守护进程退出，请检查 Web 应用与日志。");
        return 1;
      }
    }

    if (stopping.value) {
      break;
    }
    await sleep(config.intervalSeconds * 1000);
  }

  log("已退出。");
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    warn(`未捕获异常：${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exitCode = 1;
  });
