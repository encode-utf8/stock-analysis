#!/usr/bin/env node
// 数据一致性清理 CLI：数据库可用时，把本地降级文件里的真实数据回填入库，并清除断连期间的模板垃圾。
// 与工作台右上角按钮调用同一个接口 /api/admin/data-consistency，因此两者的判定规则完全一致。
//
// 用法：
//   node scripts/data-cleanup.mjs            # 只扫描并打印清理计划（不改动任何数据）
//   node scripts/data-cleanup.mjs --apply    # 执行回填与清除（降级文件会被移入 .data/quarantine/）
//   node scripts/data-cleanup.mjs --json     # 输出原始 JSON，便于脚本消费
//
// 环境变量：
//   APP_BASE_URL  应用地址，默认 http://127.0.0.1:3000

const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
/** 扫描可能读取云端日报索引，超时给足。 */
const SCAN_TIMEOUT_MS = 60_000;
/** 执行包含回填与隔离写入，超时给足。 */
const APPLY_TIMEOUT_MS = 180_000;

const HELP_TEXT = `数据一致性清理

用法：node scripts/data-cleanup.mjs [选项]

选项：
  --apply          执行清理（默认只扫描）
  --json           输出原始 JSON
  --base-url <地址> 应用地址，默认 ${DEFAULT_BASE_URL}
  -h, --help       显示本帮助
`;

/** 解析命令行参数。 */
function parseArgs(argv) {
  const options = { apply: false, json: false, baseUrl: process.env.APP_BASE_URL ?? DEFAULT_BASE_URL };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--base-url") {
      options.baseUrl = argv[index + 1] ?? options.baseUrl;
      index += 1;
    } else if (arg === "-h" || arg === "--help") {
      console.log(HELP_TEXT);
      process.exit(0);
    }
  }
  return options;
}

/** 动作中文名。 */
const ACTION_LABELS = {
  restore: "回填数据库",
  clean: "清除垃圾",
  archive: "归档冗余副本",
  keep: "保持不动",
  pending: "等待数据库",
  "report-only": "仅报告",
  none: "无需处理",
};

/** 条目判定中文名。 */
const DECISION_LABELS = {
  insert: "回填",
  update: "覆盖",
  redundant: "冗余",
  invalid: "垃圾",
  template: "模板垃圾",
  pending: "待比对",
};

/** 打印扫描计划。 */
function printPlan(plan) {
  console.log(`数据库：${plan.database.status} —— ${plan.database.message}`);
  console.log(`云端日报存储：${plan.cloudReady ? "已就绪" : "未配置"}`);
  console.log(
    `汇总：待回填 ${plan.totals.toRestore} 条 / 待覆盖 ${plan.totals.toUpdate} 条 / 数据库已存在 ${plan.totals.skipped} 条 / 垃圾 ${plan.totals.toClean} 条`,
  );
  console.log("");

  for (const file of plan.files) {
    const action = ACTION_LABELS[file.action] ?? file.action;
    console.log(`- ${file.path} [${action}] ${file.summary}`);
    for (const entry of file.entries) {
      const decision = DECISION_LABELS[entry.decision] ?? entry.decision;
      console.log(`    · [${decision}] ${entry.key} ${entry.label} —— ${entry.reason}`);
    }
  }
}

/** 打印执行结果。 */
function printResult(result) {
  if (result.blocked) {
    console.log(`未执行：${result.blocked}`);
    return;
  }
  console.log(
    `清理完成：回填 ${result.applied.restored} 条 / 覆盖 ${result.applied.updated} 条 / 清除 ${result.applied.dropped} 条 / 跳过 ${result.applied.skipped} 条`,
  );
  if (result.applied.quarantined.length > 0) {
    console.log(`已隔离（可回滚）：${result.applied.quarantined.join("、")}`);
  }
  if (result.errors.length > 0) {
    console.log(`部分失败 ${result.errors.length} 项：${result.errors.join("；")}`);
  }
  console.log("提示：界面若仍显示旧数据请刷新页面；处于降级状态的进程需重启后才会切回数据库。");
}

/** 主流程。 */
async function main() {
  const options = parseArgs(process.argv.slice(2));
  const url = `${options.baseUrl.replace(/\/$/, "")}/api/admin/data-consistency`;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.apply ? APPLY_TIMEOUT_MS : SCAN_TIMEOUT_MS,
  );

  try {
    const response = await fetch(
      url,
      options.apply
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
            signal: controller.signal,
          }
        : { signal: controller.signal },
    );
    const payload = await response.json().catch(() => null);

    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else if (!payload?.success) {
      console.error(`[失败] ${payload?.error?.message ?? `HTTP ${response.status}`}`);
    } else if (options.apply) {
      printResult(payload.data);
    } else {
      printPlan(payload.data);
      console.log("");
      console.log("以上为扫描结果，未改动任何数据；确认后执行：node scripts/data-cleanup.mjs --apply");
    }

    if (!payload?.success) {
      process.exitCode = 1;
    } else if (options.apply && payload.data?.blocked) {
      process.exitCode = 2;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[失败] 无法访问 ${url}：${reason}（请先启动应用：corepack pnpm dev）`);
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
  }
}

await main();