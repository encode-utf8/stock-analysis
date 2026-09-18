#!/usr/bin/env node
// 配置导出核心脚本（跨平台、零依赖）：把项目根的 .env 合并进 .env.example 的键位顺序，生成 .env.export。
//
// 用法：node scripts/export-config.mjs [--output .env.export] [--env .env] [--template .env.example] [--force]
// 迁移部署时把生成的 .env.export 复制到目标环境的项目根目录，项目启动时会自动加载并补全缺失配置
// （详见 README「配置迁移」章节与 docs/config-export-plan.md）。
//
// 实现说明：这里刻意不依赖 dotenv，保证还没执行 pnpm install 的机器、或只有 node 的容器里也能导出；
//           解析规则覆盖 dotenv 的常用子集，并由 tests/env-export-script.test.ts 与 dotenv.parse 逐例比对。

import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** 模板默认值里表示「未填写」的写法。 */
const PLACEHOLDER_PATTERN = /(replace-me|replace-with|x{4,})/i;
/** 模板里的一行键值定义；注释行不以键名开头，天然不会被匹配（与 dotenv 的 LINE 正则同款键名规则）。 */
const KEY_LINE_PATTERN = /^\s*(?:export\s+)?([\w.-]+)\s*=/;
/** 解析 .env 的单行：键名 + 分隔符（`=` 或 `: `）+ 值。 */
const PAIR_PATTERN = /^(?:export\s+)?([\w.-]+)\s*(?:=|:\s)\s*([\s\S]*)$/;

/**
 * 是否为「未填写 / 占位」值（与 src/lib/env-export.ts 保持同一套判定）。
 * @param {string | null | undefined} value 待判定的取值
 * @returns {boolean}
 */
export function isPlaceholder(value) {
  if (value === undefined || value === null) {
    return true;
  }
  const trimmed = String(value).trim();
  if (trimmed === "") {
    return true;
  }
  return PLACEHOLDER_PATTERN.test(trimmed);
}

/** 解析单个值：支持单/双/反引号包裹、行内注释、双引号内的 \n \r 转义。 */
function parseValue(raw) {
  const value = String(raw).trim();
  const quote = value[0];
  if (quote === '"' || quote === "'" || quote === "`") {
    let end = -1;
    for (let index = 1; index < value.length; index += 1) {
      if (value[index] === "\\") {
        index += 1;
        continue;
      }
      if (value[index] === quote) {
        end = index;
        break;
      }
    }
    if (end > 0) {
      const inner = value.slice(1, end);
      // 只有双引号会展开 \n / \r（与 dotenv 一致）。
      return quote === '"' ? inner.replace(/\\n/g, "\n").replace(/\\r/g, "\r") : inner;
    }
  }
  const comment = value.indexOf("#");
  return (comment === -1 ? value : value.slice(0, comment)).trim();
}

/**
 * 解析 .env 文本为键值对象（常用子集，语义与 dotenv.parse 对齐）。
 * @param {string} source .env 文本
 * @returns {Record<string, string>}
 */
export function parseEnvText(source) {
  const result = {};
  for (const line of String(source ?? "").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const match = PAIR_PATTERN.exec(trimmed);
    if (!match) {
      continue;
    }
    result[match[1]] = parseValue(match[2]);
  }
  return result;
}

/**
 * 渲染一行 `KEY=value`；必要时加引号，保证 dotenv 回读结果一致。
 * @param {string} value 取值
 * @returns {string}
 */
export function formatValue(value) {
  if (value === "") {
    return "";
  }
  const needsQuote = value !== value.trim() || /[#`'"]/.test(value) || /[\r\n]/.test(value);
  if (!needsQuote) {
    return value;
  }
  const escaped = value.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
  if (value.includes('"') && !value.includes("'")) {
    // 值里有双引号时改用单引号包裹：dotenv 不会把 \" 解回双引号，避免回读多出反斜杠。
    return `'${escaped}'`;
  }
  return `"${escaped.replace(/"/g, '\\"')}"`;
}

/**
 * 本地时间 + 时区偏移，便于追溯导出时刻。
 * @param {Date} [date] 待格式化的时间
 * @returns {string}
 */
export function formatTimestamp(date = new Date()) {
  const pad = (input) => String(input).padStart(2, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return `${day} ${time} (${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)})`;
}

/**
 * 生成导出文件正文（纯函数，便于测试）。
 * @param {{ templateText: string, envText?: string, now?: string, host?: string }} input
 * @returns {{ text: string, stats: { fromEnvCount: number, fromTemplateCount: number, missingKeys: string[], customKeys: string[] } }}
 */
export function buildExportText({ templateText, envText = "", now = formatTimestamp(), host = os.hostname() }) {
  const envValues = parseEnvText(envText);
  const templateValues = parseEnvText(templateText);

  const bodyLines = [];
  const usedKeys = new Set();
  const missingKeys = [];
  let fromEnvCount = 0;
  let fromTemplateCount = 0;

  // 按模板逐行输出：注释与空行原样保留，键值行替换为「.env 优先、模板兜底」的取值。
  for (const rawLine of String(templateText).split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const match = KEY_LINE_PATTERN.exec(line);
    if (!match) {
      bodyLines.push(line);
      continue;
    }
    const key = match[1];
    usedKeys.add(key);
    const localValue = envValues[key];
    let value;
    if (localValue !== undefined && !isPlaceholder(localValue)) {
      value = localValue;
      fromEnvCount += 1;
    } else {
      value = templateValues[key] ?? "";
      fromTemplateCount += 1;
    }
    if (isPlaceholder(value)) {
      missingKeys.push(key);
    }
    bodyLines.push(`${key}=${formatValue(value)}`);
  }

  while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === "") {
    bodyLines.pop();
  }

  const customKeys = Object.keys(envValues).filter((key) => !usedKeys.has(key));
  const customLines =
    customKeys.length > 0
      ? customKeys.map((key) => `${key}=${formatValue(envValues[key])}`)
      : ["# （本机 .env 中没有模板之外的键）"];
  const missingLines =
    missingKeys.length > 0
      ? missingKeys.map((key) => `# ${key}`)
      : ["# （无，模板里的键都已填写）"];

  const outputLines = [
    "# ===== 迁移导出配置（.env.export） =====",
    "# 由 export-config 脚本生成，请勿手工编辑（重复导出会整份覆盖）。",
    `# 导出时间：${now}`,
    `# 来源主机：${host}`,
    "# 生成命令：node scripts/export-config.mjs（Windows 可双击 export-config.bat，Linux / macOS 用 ./export-config.sh）",
    "#",
    "# 用法：把本文件复制到目标环境的项目根目录（文件名保持 .env.export），",
    "#       启动项目（一键启动脚本 / next dev / docker compose）时会自动加载，",
    "#       只补全目标环境缺失的键，不覆盖目标环境已有的 .env 与环境变量。",
    "#",
    "# 安全提示：本文件是明文密钥，请勿提交 Git、勿外发；迁移完成后请妥善保管或删除。",
    "",
    `# ===== 未填写 / 仍为占位值的键（共 ${missingKeys.length} 项，可在目标环境补齐） =====`,
    ...missingLines,
    "",
    "# ===== 以下内容按 .env.example 的键位顺序生成 =====",
    ...bodyLines,
    "",
    "# ===== 自定义键（.env 中存在但 .env.example 未包含） =====",
    ...customLines,
    "",
  ];

  return {
    text: outputLines.join("\n"),
    stats: { fromEnvCount, fromTemplateCount, missingKeys, customKeys },
  };
}

/** 打印帮助：Windows 的 export-config.ps1 与 Linux 的 export-config.sh 都会转发到这里。 */
function printHelp() {
  console.log(`配置导出脚本：把当前 .env 合并进 .env.example 的键位顺序，生成可迁移的 .env.export。

用法：
  node scripts/export-config.mjs [选项]

选项：
  -o, --output <文件>    导出文件路径，默认 .env.export
      --env <文件>       源配置文件路径，默认 .env
      --template <文件>  模板文件路径，默认 .env.example
  -f, --force            导出文件已存在时覆盖，默认拒绝覆盖
  -h, --help             显示本帮助

说明：
  - 取值优先 .env，缺失或仍是占位值（replace-me 等）时回退 .env.example 的默认值；
  - 只输出键名与数量，不会打印任何密钥明文；
  - Linux / macOS 下导出文件权限会自动收紧为 600。`);
}

function fail(message) {
  console.error(`导出失败：${message}`);
  process.exit(1);
}

/** 读取选项取值；缺值或跟的又是一个选项时报错退出。 */
function readOptionValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    fail(`参数 ${name} 缺少取值`);
  }
  return value;
}

/** CLI 入口：解析参数、读写文件、打印摘要（不会打印任何密钥明文）。 */
function main(argv) {
  let output = ".env.export";
  let envFile = ".env";
  let templateFile = ".env.example";
  let force = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      printHelp();
      return 0;
    } else if (arg === "-o" || arg === "--output") {
      output = readOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === "--env") {
      envFile = readOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === "--template") {
      templateFile = readOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === "-f" || arg === "--force") {
      force = true;
    } else {
      fail(`未知参数 ${arg}（用 --help 查看用法）`);
    }
  }

  const outputPath = path.resolve(process.cwd(), output);
  const envPath = path.resolve(process.cwd(), envFile);
  const templatePath = path.resolve(process.cwd(), templateFile);

  if (!existsSync(templatePath)) {
    fail(`未找到模板文件 ${templateFile}，请在项目根目录运行本脚本。`);
  }
  if (existsSync(outputPath) && !force) {
    fail(`导出文件 ${output} 已存在（要覆盖请加 --force，Windows 脚本为 -Force）。`);
  }

  const templateText = readFileSync(templatePath, "utf8");
  const envExists = existsSync(envPath);
  const envText = envExists ? readFileSync(envPath, "utf8") : "";
  const { text, stats } = buildExportText({ templateText, envText });

  writeFileSync(outputPath, text, "utf8");
  if (process.platform !== "win32") {
    chmodSync(outputPath, 0o600);
  }

  console.log(`导出完成：${output}`);
  if (!envExists) {
    console.warn(`  提示：未找到 ${envFile}，本次导出内容全部为模板默认值。`);
  }
  console.log(
    `  来源：${envFile} 已填写 ${stats.fromEnvCount} 项，模板默认值 ${stats.fromTemplateCount} 项，自定义键 ${stats.customKeys.length} 项`,
  );
  console.log(`  未填写 / 占位：${stats.missingKeys.length} 项（文件内已列成清单）`);
  console.log(
    `  安全：文件含明文密钥，请勿提交 Git 或外发${process.platform === "win32" ? "" : "（导出文件权限已收紧为 600）"}。`,
  );
  console.log("  下一步：把该文件复制到目标环境的项目根目录即可自动加载（只补空缺，不覆盖已有配置）。");
  return 0;
}

// 仅在被直接执行时运行 CLI；被测试 import 时只暴露纯函数，不产生副作用。
const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}
