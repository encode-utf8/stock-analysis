// 迁移配置自动加载（.env.export）解析与合并语义测试。
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { describeEnvExportResult, isPlaceholderValue, loadEnvExport } from "@/lib/env-export";

const tempDirs: string[] = [];

/** 创建临时目录，可选写入 `.env.export` 内容。 */
function makeTempDir(content?: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "env-export-"));
  tempDirs.push(dir);
  if (content !== undefined) {
    writeFileSync(path.join(dir, ".env.export"), content, "utf8");
  }
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("isPlaceholderValue", () => {
  it("把空值与模板占位写法视为未配置", () => {
    expect(isPlaceholderValue(undefined)).toBe(true);
    expect(isPlaceholderValue(null)).toBe(true);
    expect(isPlaceholderValue("")).toBe(true);
    expect(isPlaceholderValue("   ")).toBe(true);
    expect(isPlaceholderValue("replace-me")).toBe(true);
    expect(isPlaceholderValue("replace-with-your-qq@qq.com")).toBe(true);
    expect(isPlaceholderValue("https://pub-xxxxxxxxxxxxxxxx.r2.dev")).toBe(true);
  });

  it("把真实配置视为已填写", () => {
    expect(isPlaceholderValue("sk-live-1234567890")).toBe(false);
    expect(isPlaceholderValue("postgresql://postgres:postgres@localhost:5432/stock_analysis")).toBe(
      false,
    );
    expect(isPlaceholderValue("http://127.0.0.1:8000")).toBe(false);
  });
});

describe("loadEnvExport", () => {
  it("导出文件不存在时静默返回空结果", () => {
    const dir = makeTempDir();
    const env: Record<string, string | undefined> = {};

    const result = loadEnvExport({ cwd: dir, env });

    expect(result).toEqual({
      file: null,
      disabled: false,
      parsed: 0,
      applied: [],
      skipped: [],
      ignored: [],
    });
    expect(env).toEqual({});
    expect(describeEnvExportResult(result)).toContain(".env.export");
  });

  it("SKIP_ENV_EXPORT=1 时完全跳过加载", () => {
    const dir = makeTempDir("FILL=from-export\n");
    const env: Record<string, string | undefined> = { SKIP_ENV_EXPORT: "1" };

    const result = loadEnvExport({ cwd: dir, env });

    expect(env.FILL).toBeUndefined();
    expect(result.disabled).toBe(true);
    expect(describeEnvExportResult(result)).toContain("SKIP_ENV_EXPORT=1");
  });

  it("按 dotenv 语法解析 BOM / CRLF / 注释 / 引号 / export 前缀 / 非法行", () => {
    const dir = makeTempDir(
      "\uFEFF# 注释行\r\n\r\nA=plain\r\nB='single'\r\nC=\"double\"\r\nexport D=exported\r\nE=\r\nF=replace-me\r\n这行不合法\r\nG=has=equals\r\n",
    );
    const env: Record<string, string | undefined> = {};

    const result = loadEnvExport({ cwd: dir, env });

    expect(env.A).toBe("plain");
    expect(env.B).toBe("single");
    expect(env.C).toBe("double");
    expect(env.D).toBe("exported");
    expect(env.G).toBe("has=equals");
    expect(env.E).toBeUndefined();
    expect(env.F).toBeUndefined();
    expect(result.applied.sort()).toEqual(["A", "B", "C", "D", "G"]);
    expect(result.ignored.sort()).toEqual(["E", "F"]);
    expect(result.parsed).toBe(7);
  });

  it("只补空缺：本机已有配置优先，导出文件不覆盖", () => {
    const dir = makeTempDir("KEEP=from-export\nFILL=from-export\nEMPTY=from-export\n");
    const env: Record<string, string | undefined> = { KEEP: "from-env", EMPTY: "  " };

    const result = loadEnvExport({ cwd: dir, env });

    expect(env.KEEP).toBe("from-env");
    expect(env.FILL).toBe("from-export");
    expect(env.EMPTY).toBe("from-export");
    expect(result.skipped).toEqual(["KEEP"]);
    expect(result.applied.sort()).toEqual(["EMPTY", "FILL"]);
  });

  it("override 为 true 时导出文件覆盖本机配置", () => {
    const dir = makeTempDir("KEEP=from-export\n");
    const env: Record<string, string | undefined> = { KEEP: "from-env" };

    const result = loadEnvExport({ cwd: dir, env, override: true });

    expect(env.KEEP).toBe("from-export");
    expect(result.applied).toEqual(["KEEP"]);
    expect(result.skipped).toEqual([]);
  });

  it("支持自定义文件名，并返回可读的中文摘要", () => {
    const dir = makeTempDir();
    writeFileSync(path.join(dir, ".env.migrate"), "A=1\nB=2\n", "utf8");
    const env: Record<string, string | undefined> = { A: "local" };

    const result = loadEnvExport({ cwd: dir, fileName: ".env.migrate", env });

    expect(result.file).toBe(path.join(dir, ".env.migrate"));
    expect(result.applied).toEqual(["B"]);
    const summary = describeEnvExportResult(result);
    expect(summary).toContain(".env.migrate");
    expect(summary).toContain("补全 1 项");
    expect(summary).toContain("保留本机已有配置 1 项");
  });
});
