// 迁移配置自动加载：把项目根目录的 `.env.export`（由 export-config 脚本导出）合并进进程环境。
// 设计取舍：真实环境变量与 `.env` 优先，导出文件只补空缺，避免迁移时误覆盖目标机器上的本机配置。

import path from "node:path";

import { config } from "dotenv";

/** 迁移导出文件名：放在项目根目录即被自动加载。 */
export const ENV_EXPORT_FILENAME = ".env.export";

/** 设为 1 时关闭迁移配置加载（端到端测试等需要完全隔离环境的场景使用）。 */
export const ENV_EXPORT_SKIP_FLAG = "SKIP_ENV_EXPORT";

/**
 * 占位值判定：空串与模板默认写法（`replace-me`、`replace-with-*`、`xxxx`）都视为「未配置」。
 * 与 `src/lib/analysis.ts`、`src/lib/db/index.ts` 的占位判定保持同一套关键字。
 */
export function isPlaceholderValue(value?: string | null): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return true;
  }
  return /(replace-me|replace-with|x{4,})/i.test(trimmed);
}

/** `loadEnvExport` 的入参。 */
export interface EnvExportOptions {
  /** 项目根目录，默认 `process.cwd()`。 */
  cwd?: string;
  /** 导出文件名，默认 `.env.export`。 */
  fileName?: string;
  /** 为 true 时导出文件覆盖本机已有值（默认 false：只补空缺）。 */
  override?: boolean;
  /** 目标环境对象，默认 `process.env`。 */
  env?: Record<string, string | undefined>;
}

/** `loadEnvExport` 的执行结果，便于日志输出与测试断言。 */
export interface EnvExportResult {
  /** 实际读取到的导出文件绝对路径；文件不存在时为 `null`。 */
  file: string | null;
  /** 是否因 `SKIP_ENV_EXPORT=1` 主动跳过加载。 */
  disabled: boolean;
  /** 导出文件中解析出的键数量。 */
  parsed: number;
  /** 成功写入环境的键（补全的空缺）。 */
  applied: string[];
  /** 本机已有真实配置、按「本机优先」保留的键。 */
  skipped: string[];
  /** 导出文件里是空值或占位值、直接忽略的键。 */
  ignored: string[];
}

/** 读取并合并 `.env.export`；文件不存在时静默返回空结果，不抛错。 */
export function loadEnvExport(options: EnvExportOptions = {}): EnvExportResult {
  const {
    cwd = process.cwd(),
    fileName = ENV_EXPORT_FILENAME,
    override = false,
    env = process.env,
  } = options;

  const file = path.resolve(cwd, fileName);
  const result: EnvExportResult = {
    file: null,
    disabled: false,
    parsed: 0,
    applied: [],
    skipped: [],
    ignored: [],
  };
  if (env[ENV_EXPORT_SKIP_FLAG] === "1") {
    // 显式关闭：例如端到端测试会清空 DATABASE_URL 等变量来隔离真实数据，此时不能再补回来。
    result.disabled = true;
    return result;
  }
  // 借用 dotenv 读取文件：既与运行时（Next / dotenv/config）共用同一套解析规则，
  // 又避免本模块直接调用 fs —— Turbopack 遇到动态 fs 路径会把整个项目 trace 进构建产物（含 .env、.data）。
  const loaded = config({ path: file, processEnv: {} });
  if (loaded.error) {
    // 文件不存在（ENOENT）或不可读：静默跳过，不影响启动。
    return result;
  }

  const exported = loaded.parsed ?? {};
  result.file = file;
  result.parsed = Object.keys(exported).length;

  for (const [key, value] of Object.entries(exported)) {
    if (isPlaceholderValue(value)) {
      // 导出文件里也是空占位：写进去没有意义，直接忽略。
      result.ignored.push(key);
      continue;
    }
    if (override || isPlaceholderValue(env[key])) {
      env[key] = value;
      result.applied.push(key);
    } else {
      result.skipped.push(key);
    }
  }

  return result;
}

/** 生成一行中文摘要，供启动流程与脚本打印（不包含任何密钥明文）。 */
export function describeEnvExportResult(result: EnvExportResult): string {
  if (result.disabled) {
    return `${ENV_EXPORT_SKIP_FLAG}=1，已跳过迁移配置加载。`;
  }
  if (!result.file) {
    return `未发现 ${ENV_EXPORT_FILENAME}，跳过迁移配置补充。`;
  }
  return `已加载 ${path.basename(result.file)}：补全 ${result.applied.length} 项，保留本机已有配置 ${result.skipped.length} 项，忽略空占位 ${result.ignored.length} 项。`;
}
