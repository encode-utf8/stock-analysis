import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DATA_DIR_NAME, dataDir, dataPath, dataRootDir } from "@/lib/data-dir";

/** 用例前后恢复 DATA_ROOT，避免相互影响。 */
const original = process.env.DATA_ROOT;

afterEach(() => {
  if (original === undefined) {
    delete process.env.DATA_ROOT;
  } else {
    process.env.DATA_ROOT = original;
  }
});

describe("本地数据目录", () => {
  it("默认落在工作目录的 .data 下", () => {
    delete process.env.DATA_ROOT;
    expect(dataRootDir()).toBe(process.cwd());
    expect(dataDir()).toBe(path.join(process.cwd(), DATA_DIR_NAME));
    expect(dataPath("watchlist.json")).toBe(
      path.join(process.cwd(), DATA_DIR_NAME, "watchlist.json"),
    );
  });

  it("DATA_ROOT 有值时整体切换数据根目录", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "data-root-"));
    try {
      process.env.DATA_ROOT = root;
      expect(dataRootDir()).toBe(path.resolve(root));
      expect(dataDir()).toBe(path.join(path.resolve(root), DATA_DIR_NAME));
      expect(dataPath("backgrounds", "a.png")).toBe(
        path.join(path.resolve(root), DATA_DIR_NAME, "backgrounds", "a.png"),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("DATA_ROOT 为空白时回退默认目录", () => {
    process.env.DATA_ROOT = "   ";
    expect(dataRootDir()).toBe(process.cwd());
    expect(dataDir()).toBe(path.join(process.cwd(), DATA_DIR_NAME));
  });

  it("DATA_ROOT 支持相对路径并按工作目录解析", () => {
    process.env.DATA_ROOT = "tmp-e2e-data";
    expect(dataRootDir()).toBe(path.resolve("tmp-e2e-data"));
    expect(dataDir()).toBe(path.join(path.resolve("tmp-e2e-data"), DATA_DIR_NAME));
  });
});
