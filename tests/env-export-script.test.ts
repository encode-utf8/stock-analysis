// 导出脚本（scripts/export-config.mjs）测试：解析与 dotenv 对齐、导出内容结构、CLI 行为。
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "dotenv";
import { afterEach, describe, expect, it } from "vitest";

import { buildExportText, formatValue, parseEnvText } from "../scripts/export-config.mjs";

const SCRIPT_PATH = fileURLToPath(new URL("../scripts/export-config.mjs", import.meta.url));
const tempDirs: string[] = [];

/** 创建临时目录并按需写入文件。 */
function makeTempDir(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "env-export-script-"));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), content, "utf8");
  }
  return dir;
}

/** 以子进程方式跑 CLI，校验退出码与提示语。 */
function runCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { cwd, encoding: "utf8" });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

// 脚本刻意不依赖 dotenv，但这些边界写法的解析结果必须与运行时完全一致。
const PARSE_CASES = [
  "A=x   # c",
  "B=  spaced  ",
  "C='unterminated",
  "D: colon-value",
  "E:x",
  'F="a" # c',
  "G=",
  "export H = 1",
  'I=a"b',
  'J="multi\\nline"',
  "K=`tick`",
  "L=-x",
  "中文=value",
  "M=has:colon",
  "N= trail # c",
  "O =''",
  "P='a#b' # c",
  'Q="a\\"b"',
  "# 注释行",
  "",
];

describe("parseEnvText 与 dotenv 语义一致", () => {
  it.each(PARSE_CASES)("解析 %s", (line) => {
    expect(parseEnvText(line)).toEqual(parse(line as string));
  });
});

const TEMPLATE = [
  "# ===== 分组一 =====",
  "DEEPSEEK_API_KEY=replace-me",
  "DEEPSEEK_BASE_URL=https://api.deepseek.com",
  "",
  "# ===== 分组二 =====",
  "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/stock_analysis",
  "DAILY_REPORT_EMAIL_TO=",
  "",
].join("\n");

describe("buildExportText", () => {
  it("按模板顺序输出，取值优先 .env、缺失回退模板默认值", () => {
    const { text, stats } = buildExportText({
      templateText: TEMPLATE,
      envText: "DEEPSEEK_API_KEY=sk-test\nDATA_ROOT=/srv/app\n",
      now: "2026-01-01 00:00:00 (+08:00)",
      host: "test-host",
    });

    expect(text.endsWith("\n")).toBe(true);
    expect(text).toContain("DEEPSEEK_API_KEY=sk-test");
    expect(text).toContain("DEEPSEEK_BASE_URL=https://api.deepseek.com");
    expect(text).toContain("# 导出时间：2026-01-01 00:00:00 (+08:00)");
    expect(text).toContain("# 来源主机：test-host");
    expect(stats.fromEnvCount).toBe(1);
    expect(stats.customKeys).toEqual(["DATA_ROOT"]);
    expect(stats.missingKeys).toEqual(["DAILY_REPORT_EMAIL_TO"]);
    expect(text.indexOf("DEEPSEEK_API_KEY")).toBeLessThan(text.indexOf("DATABASE_URL"));
  });

  it("保留模板分组注释，未填写键列成清单，自定义键单独成段", () => {
    const { text } = buildExportText({ templateText: TEMPLATE, envText: "", now: "t", host: "h" });

    expect(text).toContain("# ===== 分组一 =====");
    expect(text).toContain("# DEEPSEEK_API_KEY");
    expect(text).toContain("# （本机 .env 中没有模板之外的键）");
    expect(text).toContain("# ===== 自定义键（.env 中存在但 .env.example 未包含） =====");
  });

  it("导出结果能被 dotenv 原样读回（含 # 的值会自动加引号）", () => {
    const { text } = buildExportText({
      templateText: "SMTP_PASS=replace-with-qq-smtp-auth-code\n",
      envText: 'SMTP_PASS="p#ss-word"\n',
      now: "t",
      host: "h",
    });

    expect(parse(text).SMTP_PASS).toBe("p#ss-word");
  });
});

describe("formatValue", () => {
  it("对常见值做无损渲染", () => {
    const values = [
      "plain",
      "with space",
      "p#ss-word",
      'has"quote',
      "has'quote",
      "line\nbreak",
      "trail ",
    ];
    for (const value of values) {
      expect(parseEnvText(`K=${formatValue(value)}`).K).toBe(value);
    }
  });
});

describe("export-config.mjs CLI", () => {
  it("模板缺失时报错退出", () => {
    const dir = makeTempDir();

    const result = runCli([], dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("未找到模板文件");
  });

  it("生成导出文件，重复导出默认拒绝覆盖，--force 可覆盖", () => {
    const dir = makeTempDir({
      ".env.example": "DEEPSEEK_API_KEY=replace-me\n",
      ".env": "DEEPSEEK_API_KEY=sk-cli\n",
    });

    const first = runCli([], dir);
    expect(first.status).toBe(0);
    const output = path.join(dir, ".env.export");
    expect(readFileSync(output, "utf8")).toContain("DEEPSEEK_API_KEY=sk-cli");

    const second = runCli([], dir);
    expect(second.status).toBe(1);
    expect(second.stderr).toContain("已存在");

    const forced = runCli(["--force"], dir);
    expect(forced.status).toBe(0);
  });

  it("--help 与自定义路径可用，未知参数报错", () => {
    const dir = makeTempDir({ "config.tpl": "A=replace-me\n", "custom.env": "A=real\n" });

    const help = runCli(["--help"], dir);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("用法");

    const result = runCli(
      ["--template", "config.tpl", "--env", "custom.env", "--output", "out.env"],
      dir,
    );
    expect(result.status).toBe(0);
    expect(readFileSync(path.join(dir, "out.env"), "utf8")).toContain("A=real");

    const bad = runCli(["--nope"], dir);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("未知参数");
  });
});
