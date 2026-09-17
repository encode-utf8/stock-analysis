// 数据一致性清理测试：条目级判定、文件级处置、数据库未就绪时的安全行为与隔离落地。
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyDataConsistency,
  formatQuarantineStamp,
  isSecurityCode,
  isUsableNumber,
  reconcileEntries,
  scanDataConsistency,
} from "@/lib/data-consistency";
import type {
  ConsistencyDb,
  ConsistencyDeps,
  ConsistencyReportStore,
  ConsistencyTable,
  DatabaseHealth,
  ReconcileContext,
  RemoteEntry,
} from "@/lib/data-consistency";
import {
  fundPositionSignature,
  stockHoldingSignature,
  stockWatchlistSignature,
} from "@/lib/data-consistency-signature";
import type {
  AlertEvent,
  AlertRule,
  DailyReport,
  DailyReportKind,
  FundPosition,
  FundWatchlistItem,
  StockHolding,
  WatchlistItem,
} from "@/lib/shared/types";

/** 数据库就绪状态。 */
function readyHealth(): DatabaseHealth {
  return {
    status: "ready",
    message: "数据库连接正常",
    missingTables: [],
    pendingMigrations: 0,
  };
}

/** 数据库不可用状态。 */
function downHealth(): DatabaseHealth {
  return {
    status: "unavailable",
    message: "数据库连接失败",
    missingTables: [],
    pendingMigrations: 0,
  };
}

/** 内存版数据库替身，只记录写入动作。 */
function createFakeDb(options: {
  health?: DatabaseHealth;
  lastModified?: Partial<Record<ConsistencyTable, string | null>>;
  stockWatchlist?: RemoteEntry[];
  fundWatchlist?: RemoteEntry[];
  stockHoldings?: RemoteEntry[];
  fundPositions?: RemoteEntry[];
  alertRules?: RemoteEntry[];
  alertEvents?: RemoteEntry[];
} = {}): { db: ConsistencyDb; inserted: string[]; updated: string[] } {
  const inserted: string[] = [];
  const updated: string[] = [];

  const db: ConsistencyDb = {
    health: async () => options.health ?? readyHealth(),
    getLastModified: async (table: ConsistencyTable) => options.lastModified?.[table] ?? null,
    listStockWatchlist: async () => options.stockWatchlist ?? [],
    insertStockWatchlist: async (item: WatchlistItem) => {
      inserted.push(`watchlist:${item.code}`);
    },
    updateStockWatchlist: async (item: WatchlistItem) => {
      updated.push(`watchlist:${item.code}`);
    },
    listFundWatchlist: async () => options.fundWatchlist ?? [],
    insertFundWatchlist: async (item: FundWatchlistItem) => {
      inserted.push(`fund_watchlist:${item.code}`);
    },
    updateFundWatchlist: async (item: FundWatchlistItem) => {
      updated.push(`fund_watchlist:${item.code}`);
    },
    listStockHoldings: async () => options.stockHoldings ?? [],
    insertStockHolding: async (holding: StockHolding) => {
      inserted.push(`stock_holdings:${holding.code}`);
    },
    updateStockHolding: async (id: string) => {
      updated.push(`stock_holdings:${id}`);
    },
    listFundPositions: async () => options.fundPositions ?? [],
    insertFundPosition: async (position: FundPosition) => {
      inserted.push(`fund_positions:${position.code}`);
    },
    updateFundPosition: async (id: string) => {
      updated.push(`fund_positions:${id}`);
    },
    listAlertRules: async () => options.alertRules ?? [],
    insertAlertRule: async (rule: AlertRule) => {
      inserted.push(`alert_rules:${rule.id}`);
    },
    updateAlertRule: async (id: string) => {
      updated.push(`alert_rules:${id}`);
    },
    listAlertEvents: async () => options.alertEvents ?? [],
    insertAlertEvents: async (events: AlertEvent[]) => {
      for (const event of events) {
        inserted.push(`alert_events:${event.id}`);
      }
    },
  };

  return { db, inserted, updated };
}

/** 数据库条目替身：指纹由调用方给出，便于构造「内容一致 / 不一致」两种场景。 */
function remoteEntry(
  key: string,
  id: string,
  label: string,
  signature: string,
  updatedAt: string | null = null,
): RemoteEntry {
  return { key, id, label, signature, updated_at: updatedAt };
}

/** 测试用简化指纹：代码 + 金额，足够区分「内容是否一致」。 */
function simpleSignature(code: string, amount: number): string {
  return `${code}#${amount}`;
}

/** 本地文件的默认修改时间：固定值让「数据库是否落后」的判定可复现。 */
const FILE_MTIME = "2026-09-15T10:00:00.000Z";

/** 比对基准替身。 */
function context(overrides: Partial<ReconcileContext> = {}): ReconcileContext {
  return { localMtime: FILE_MTIME, dbLastModified: null, ...overrides };
}

/** 自选股核对选项替身：指纹走与生产同一套字段顺序。 */
function watchOptions() {
  return {
    keyOf: (item: WatchlistItem) => item.code,
    labelOf: (item: WatchlistItem) => item.name,
    signatureOf: (item: WatchlistItem) =>
      stockWatchlistSignature(
        item.code,
        item.name,
        item.exchange,
        item.group,
        item.sort_order,
        item.note,
      ),
    validate: () => null,
  };
}

/** 持有基金核对选项替身：指纹用简化实现，便于构造一致 / 不一致场景。 */
function fundOptions() {
  return {
    keyOf: (item: FundPosition) => item.code,
    labelOf: (item: FundPosition) => item.name,
    signatureOf: (item: FundPosition) => simpleSignature(item.code, item.amount),
    validate: () => null,
  };
}

/** 日报存储替身。 */
function createFakeReports(options: { cloudReady?: boolean; cloudHas?: string[] } = {}): {
  store: ConsistencyReportStore;
  restored: string[];
  purged: string[];
} {
  const restored: string[] = [];
  const purged: string[] = [];
  const cloudHas = new Set(options.cloudHas ?? []);

  const store: ConsistencyReportStore = {
    cloudReady: () => options.cloudReady ?? true,
    read: async (kind: DailyReportKind, date: string) => {
      if (cloudHas.has(`${kind}/${date}`)) {
        return { report: buildReport(kind, date, "deepseek"), storage: "r2" };
      }
      return null;
    },
    restore: async (report: DailyReport) => {
      restored.push(`${report.kind}/${report.date}`);
    },
    purge: async (kind: DailyReportKind, date: string) => {
      purged.push(`${kind}/${date}`);
    },
  };

  return { store, restored, purged };
}

/** 构造日报。 */
function buildReport(
  kind: DailyReportKind,
  date: string,
  source: DailyReport["source"],
): DailyReport {
  return {
    kind,
    date,
    generated_at: `${date}T08:00:00.000Z`,
    source,
    storage: "local",
    title: `${kind} ${date} 日报`,
    headline: "标题",
    metrics: [],
    markdown: "# 正文",
    model: source === "deepseek" ? "deepseek-chat" : null,
    data: {} as DailyReport["data"],
  };
}

/** 构造测试依赖。 */
function createDeps(
  rootDir: string,
  db: ConsistencyDb,
  reports: ConsistencyReportStore,
): ConsistencyDeps {
  return {
    rootDir,
    dataDir: path.join(rootDir, ".data"),
    now: () => new Date("2026-09-15T10:00:00.000Z"),
    db,
    reports,
  };
}

/** 写入 .data 下的文件，并固定修改时间，让「数据库是否落后」的判定可复现。 */
async function writeDataFile(
  rootDir: string,
  relPath: string,
  content: string,
  mtime: string = FILE_MTIME,
): Promise<void> {
  const target = path.join(rootDir, ".data", relPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  const stamp = new Date(mtime);
  await utimes(target, stamp, stamp);
}

/** 自选股条目。 */
function watchItem(code: string, name: string, addedAt: string): WatchlistItem {
  return {
    code,
    name,
    exchange: "SH",
    group: "默认",
    added_at: addedAt,
    sort_order: 0,
    note: null,
  };
}

/** 持有基金条目。 */
function fundPosition(code: string, amount: number, updatedAt: string): FundPosition {
  return {
    id: `pos-${code}`,
    code,
    name: `基金 ${code}`,
    amount,
    profit: 0,
    profit_caliber: "include_today",
    plan: null,
    calibration: null,
    note: null,
    created_at: addedAtFallback(updatedAt),
    updated_at: updatedAt,
  };
}

/** 构造早于给定时间的时间戳。 */
function addedAtFallback(updatedAt: string): string {
  return new Date(Date.parse(updatedAt) - 86_400_000).toISOString();
}

const tempDirs: string[] = [];

/** 创建临时项目根目录。 */
async function createTempRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "data-consistency-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("基础判定", () => {
  it("识别 6 位证券代码", () => {
    expect(isSecurityCode("600519")).toBe(true);
    expect(isSecurityCode(" 600519 ")).toBe(true);
    expect(isSecurityCode("60051")).toBe(false);
    expect(isSecurityCode(600519 as unknown as string)).toBe(false);
  });

  it("识别有效数值", () => {
    expect(isUsableNumber(0)).toBe(true);
    expect(isUsableNumber(Number.NaN)).toBe(false);
    expect(isUsableNumber("100" as unknown as number)).toBe(false);
  });

  it("隔离目录时间戳精确到秒", () => {
    expect(formatQuarantineStamp(new Date(2026, 8, 15, 9, 5, 3))).toBe("20260915090503");
  });

  it("数据库缺少条目时判定为回填", () => {
    const decisions = reconcileEntries(
      [watchItem("600519", "贵州茅台", "2026-09-01T00:00:00.000Z")],
      [],
      watchOptions(),
      context(),
    );
    expect(decisions[0].decision).toBe("insert");
  });

  it("内容与数据库一致时判为冗余，即使本地文件比数据库新", () => {
    const decisions = reconcileEntries(
      [fundPosition("110022", 100, "2026-09-12T00:00:00.000Z")],
      [remoteEntry("110022", "pos-1", "旧", simpleSignature("110022", 100))],
      fundOptions(),
      context({ dbLastModified: "2026-09-10T00:00:00.000Z" }),
    );
    expect(decisions[0].decision).toBe("redundant");
    expect(decisions[0].reason).toContain("内容与数据库完全一致");
  });

  it("内容不一致且数据库最后改动早于本地文件时判为覆盖", () => {
    const decisions = reconcileEntries(
      [fundPosition("110022", 100, "2026-09-12T00:00:00.000Z")],
      [remoteEntry("110022", "pos-1", "旧", simpleSignature("110022", 88))],
      fundOptions(),
      context({ dbLastModified: "2026-09-10T00:00:00.000Z" }),
    );
    expect(decisions[0].decision).toBe("update");
    expect(decisions[0].remoteId).toBe("pos-1");
    expect(decisions[0].reason).toContain("数据库版本落后");
  });

  it("内容不一致且数据库不早于本地文件时判为本地老旧冗余", () => {
    const decisions = reconcileEntries(
      [fundPosition("110022", 100, "2026-09-12T00:00:00.000Z")],
      [remoteEntry("110022", "pos-1", "旧", simpleSignature("110022", 88))],
      fundOptions(),
      context({ dbLastModified: "2026-09-16T00:00:00.000Z" }),
    );
    expect(decisions[0].decision).toBe("redundant");
    expect(decisions[0].reason).toContain("老旧冗余");
  });

  it("数据库最后改动时间不可读时保持保守，不以本地覆盖数据库", () => {
    const decisions = reconcileEntries(
      [fundPosition("110022", 100, "2026-09-12T00:00:00.000Z")],
      [remoteEntry("110022", "pos-1", "旧", simpleSignature("110022", 88))],
      fundOptions(),
      context({ dbLastModified: null }),
    );
    expect(decisions[0].decision).toBe("redundant");
    expect(decisions[0].reason).toContain("未知时间");
  });

  it("内容指纹不同但数据库不落后时判为冗余，并保留占位名提示", () => {
    const decisions = reconcileEntries(
      [watchItem("600519", "股票 600519", "2026-09-01T00:00:00.000Z")],
      [remoteEntry("600519", "600519", "贵州茅台", "数据库内容指纹")],
      { ...watchOptions(), hintOf: () => "名称为本地占位名" },
      context(),
    );
    expect(decisions[0].decision).toBe("redundant");
    expect(decisions[0].reason).toContain("占位名");
  });

  it("垃圾条目直接判定为无效", () => {
    const decisions = reconcileEntries(
      [watchItem("普通文本" as unknown as string, "股票 x", "2026-09-01T00:00:00.000Z")],
      [],
      {
        ...watchOptions(),
        validate: (item) => (isSecurityCode(item.code) ? null : "代码不是 6 位数字"),
      },
      context(),
    );
    expect(decisions[0].decision).toBe("invalid");
  });
});

describe("内容指纹", () => {
  it("数据库 numeric 字符串与本地数值生成同一指纹", () => {
    expect(stockHoldingSignature("600519", "贵州茅台", "1000.00", "50.10", null)).toBe(
      stockHoldingSignature("600519", "贵州茅台", 1000, 50.1, null),
    );
  });

  it("字段全为空的子对象与 null 生成同一指纹", () => {
    const emptyPlan = { frequency: null, weekday: null, amount: null, start_date: null };
    expect(
      fundPositionSignature("110022", "基金", 1, 2, "include_today", emptyPlan, null, null, null),
    ).toBe(fundPositionSignature("110022", "基金", 1, 2, "include_today", null, null, null, null));
  });

  it("字符串空白差异与空串不影响指纹", () => {
    expect(stockWatchlistSignature("600519", " 贵州茅台 ", "SH", "默认", 0, "")).toBe(
      stockWatchlistSignature("600519", "贵州茅台", "SH", "默认", 0, null),
    );
  });

  it("真实字段差异仍可分辨", () => {
    expect(stockHoldingSignature("600519", "贵州茅台", 1000, 50, null)).not.toBe(
      stockHoldingSignature("600519", "贵州茅台", 1000, 55, null),
    );
  });
});

describe("扫描计划", () => {
  it("数据库未就绪时只标记待比对，不读取数据库", async () => {
    const rootDir = await createTempRoot();
    await writeDataFile(
      rootDir,
      "fund-positions.json",
      JSON.stringify([fundPosition("021533", 396.47, "2026-09-15T09:00:00.000Z")]),
    );

    const { db, inserted } = createFakeDb({ health: downHealth() });
    const { store } = createFakeReports();
    const plan = await scanDataConsistency(createDeps(rootDir, db, store));

    expect(plan.database.status).toBe("unavailable");
    const file = plan.files.find((item) => item.kind === "fund-positions");
    expect(file?.action).toBe("pending");
    expect(file?.entries[0].decision).toBe("pending");
    expect(inserted).toHaveLength(0);
  });

  it("区分真实数据回填、陈旧镜像与垃圾", async () => {
    const rootDir = await createTempRoot();
    await writeDataFile(
      rootDir,
      "watchlist.json",
      JSON.stringify([
        watchItem("600519", "贵州茅台", "2026-09-01T00:00:00.000Z"),
        watchItem("510300", "沪深300ETF", "2026-09-01T00:00:00.000Z"),
        { code: "bad", name: "股票 bad" },
      ]),
    );

    const { db } = createFakeDb({
      stockWatchlist: [
        remoteEntry(
          "510300",
          "510300",
          "沪深300ETF",
          stockWatchlistSignature("510300", "沪深300ETF", "SH", "默认", 0, null),
          "2026-09-01T00:00:00.000Z",
        ),
      ],
    });
    const { store } = createFakeReports();
    const plan = await scanDataConsistency(createDeps(rootDir, db, store));

    const file = plan.files.find((item) => item.kind === "stock-watchlist");
    expect(file?.action).toBe("restore");
    expect(file?.entries.map((entry) => entry.decision)).toEqual([
      "insert",
      "redundant",
      "invalid",
    ]);
    expect(plan.totals).toMatchObject({ toRestore: 1, toClean: 1, skipped: 1 });
  });

  it("空文件与损坏文件判定为清除垃圾", async () => {
    const rootDir = await createTempRoot();
    await writeDataFile(rootDir, "watchlist.json", "[]");
    await writeDataFile(rootDir, "stock-portfolio.json", "{不是数组");

    const { db } = createFakeDb();
    const { store } = createFakeReports();
    const plan = await scanDataConsistency(createDeps(rootDir, db, store));

    expect(plan.files.find((item) => item.kind === "stock-watchlist")?.action).toBe("clean");
    expect(plan.files.find((item) => item.kind === "stock-portfolio")?.action).toBe("clean");
  });

  it("预警设置保持不动，未知文件仅报告", async () => {
    const rootDir = await createTempRoot();
    await writeDataFile(rootDir, "alert-settings.json", JSON.stringify({ email_to: "a@b.com" }));
    await writeDataFile(rootDir, "dev-server.log", "log");

    const { db } = createFakeDb();
    const { store } = createFakeReports();
    const plan = await scanDataConsistency(createDeps(rootDir, db, store));

    expect(plan.files.find((item) => item.kind === "alert-settings")?.action).toBe("keep");
    const unknown = plan.files.find((item) => item.kind === "unknown");
    expect(unknown?.action).toBe("report-only");
    expect(unknown?.summary).toContain("dev-server.log");
  });

  it("未配置云端时保留本地日报", async () => {
    const rootDir = await createTempRoot();
    await writeDataFile(
      rootDir,
      path.join("daily-reports", "stock", "2026-09-11.json"),
      JSON.stringify(buildReport("stock", "2026-09-11", "template")),
    );

    const { db } = createFakeDb();
    const { store } = createFakeReports({ cloudReady: false });
    const plan = await scanDataConsistency(createDeps(rootDir, db, store));

    expect(plan.files.find((item) => item.kind === "daily-reports")?.action).toBe("keep");
  });

  it("日报区分 AI 正式稿、云端已有与模板降级稿", async () => {
    const rootDir = await createTempRoot();
    await writeDataFile(
      rootDir,
      path.join("daily-reports", "stock", "2026-09-11.json"),
      JSON.stringify(buildReport("stock", "2026-09-11", "deepseek")),
    );
    await writeDataFile(
      rootDir,
      path.join("daily-reports", "stock", "2026-09-12.json"),
      JSON.stringify(buildReport("stock", "2026-09-12", "template")),
    );
    await writeDataFile(
      rootDir,
      path.join("daily-reports", "stock", "2026-09-13.json"),
      JSON.stringify(buildReport("stock", "2026-09-13", "deepseek")),
    );

    const { db } = createFakeDb();
    const { store } = createFakeReports({ cloudHas: ["stock/2026-09-13"] });
    const plan = await scanDataConsistency(createDeps(rootDir, db, store));

    const file = plan.files.find((item) => item.kind === "daily-reports");
    const byKey = new Map(file?.entries.map((entry) => [entry.key, entry.decision]));
    expect(byKey.get("stock/2026-09-11")).toBe("insert");
    expect(byKey.get("stock/2026-09-12")).toBe("template");
    expect(byKey.get("stock/2026-09-13")).toBe("redundant");
  });
});

describe("执行清理", () => {
  it("数据库未就绪时拒绝执行，文件保持原样", async () => {
    const rootDir = await createTempRoot();
    await writeDataFile(
      rootDir,
      "watchlist.json",
      JSON.stringify([watchItem("600519", "贵州茅台", "2026-09-01T00:00:00.000Z")]),
    );

    const { db, inserted } = createFakeDb({ health: downHealth() });
    const { store } = createFakeReports();
    const result = await applyDataConsistency(createDeps(rootDir, db, store));

    expect(result.blocked).toContain("数据库连接失败");
    expect(inserted).toHaveLength(0);
    expect(result.applied.quarantined).toHaveLength(0);
    const kept = await readFile(path.join(rootDir, ".data", "watchlist.json"), "utf8");
    expect(kept).toContain("600519");
  });

  it("回填事实数据后把降级文件移入隔离目录", async () => {
    const rootDir = await createTempRoot();
    await writeDataFile(
      rootDir,
      "fund-positions.json",
      JSON.stringify([
        fundPosition("021533", 396.47, "2026-09-15T09:00:00.000Z"),
        fundPosition("000033", 1600.72, "2026-09-15T09:00:00.000Z"),
      ]),
    );

    const { db, inserted } = createFakeDb({
      fundPositions: [
        remoteEntry(
          "000033",
          "pos-000033",
          "旧",
          simpleSignature("000033", 999),
          "2026-09-16T00:00:00.000Z",
        ),
      ],
    });
    const { store } = createFakeReports();
    const result = await applyDataConsistency(createDeps(rootDir, db, store));

    expect(result.blocked).toBeNull();
    expect(inserted).toEqual(["fund_positions:021533"]);
    expect(result.applied).toMatchObject({ restored: 1, skipped: 1 });
    expect(result.applied.quarantined).toEqual([".data/fund-positions.json"]);

    const quarantined = await readFile(
      path.join(
        rootDir,
        ".data",
        "quarantine",
        formatQuarantineStamp(new Date("2026-09-15T10:00:00.000Z")),
        "fund-positions.json",
      ),
      "utf8",
    );
    expect(quarantined).toContain("021533");
    await expect(readFile(path.join(rootDir, ".data", "fund-positions.json"), "utf8")).rejects.toThrow();
  });

  it("数据库最后改动早于本地文件时以本地覆盖数据库", async () => {
    const rootDir = await createTempRoot();
    await writeDataFile(
      rootDir,
      "stock-portfolio.json",
      JSON.stringify([
        {
          id: "h-1",
          code: "600519",
          name: "贵州茅台",
          amount: 1000,
          profit: 50,
          note: null,
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-15T09:00:00.000Z",
        },
      ]),
    );

    const { db, inserted, updated } = createFakeDb({
      stockHoldings: [
        remoteEntry(
          "600519",
          "h-db",
          "贵州茅台",
          stockHoldingSignature("600519", "贵州茅台", 1000, 55, null),
        ),
      ],
      lastModified: { stock_holdings: "2026-09-10T00:00:00.000Z" },
    });
    const { store } = createFakeReports();
    const result = await applyDataConsistency(createDeps(rootDir, db, store));

    expect(inserted).toHaveLength(0);
    expect(updated).toEqual(["stock_holdings:h-db"]);
    expect(result.applied).toEqual({
      restored: 0,
      updated: 1,
      dropped: 0,
      skipped: 0,
      quarantined: [".data/stock-portfolio.json"],
    });
  });

  it("数据库不早于本地文件时保持数据库内容，本地文件按冗余归档", async () => {
    const rootDir = await createTempRoot();
    await writeDataFile(
      rootDir,
      "stock-portfolio.json",
      JSON.stringify([
        {
          id: "h-1",
          code: "600519",
          name: "贵州茅台",
          amount: 1000,
          profit: 50,
          note: null,
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-15T09:00:00.000Z",
        },
      ]),
    );

    const { db, inserted, updated } = createFakeDb({
      stockHoldings: [
        remoteEntry(
          "600519",
          "h-db",
          "贵州茅台",
          stockHoldingSignature("600519", "贵州茅台", 1000, 55, null),
        ),
      ],
      lastModified: { stock_holdings: "2026-09-16T00:00:00.000Z" },
    });
    const { store } = createFakeReports();
    const result = await applyDataConsistency(createDeps(rootDir, db, store));

    expect(inserted).toHaveLength(0);
    expect(updated).toHaveLength(0);
    expect(result.applied).toEqual({
      restored: 0,
      updated: 0,
      dropped: 0,
      skipped: 1,
      quarantined: [".data/stock-portfolio.json"],
    });
  });

  it("回填日报到云端并清除模板降级稿", async () => {
    const rootDir = await createTempRoot();
    await writeDataFile(
      rootDir,
      path.join("daily-reports", "stock", "2026-09-11.json"),
      JSON.stringify(buildReport("stock", "2026-09-11", "deepseek")),
    );
    await writeDataFile(
      rootDir,
      path.join("daily-reports", "stock", "2026-09-12.json"),
      JSON.stringify(buildReport("stock", "2026-09-12", "template")),
    );

    const { db } = createFakeDb();
    const { store, restored, purged } = createFakeReports();
    const result = await applyDataConsistency(createDeps(rootDir, db, store));

    expect(restored).toEqual(["stock/2026-09-11"]);
    expect(purged).toEqual(["stock/2026-09-12"]);
    expect(result.applied.restored).toBe(1);
    expect(result.applied.dropped).toBe(1);
    expect(result.applied.quarantined).toEqual([
      ".data/daily-reports/stock/2026-09-11.json",
    ]);
  });

  it("空的预警降级文件直接隔离", async () => {
    const rootDir = await createTempRoot();
    await writeDataFile(rootDir, "alerts.json", JSON.stringify({ rules: [], events: [] }));

    const { db } = createFakeDb();
    const { store } = createFakeReports();
    const result = await applyDataConsistency(createDeps(rootDir, db, store));

    expect(result.applied.quarantined).toEqual([".data/alerts.json"]);
    await expect(readFile(path.join(rootDir, ".data", "alerts.json"), "utf8")).rejects.toThrow();
  });

  it("单个数据域写入失败时保留文件并记录错误", async () => {
    const rootDir = await createTempRoot();
    await writeDataFile(
      rootDir,
      "watchlist.json",
      JSON.stringify([watchItem("600519", "贵州茅台", "2026-09-01T00:00:00.000Z")]),
    );

    const { db } = createFakeDb();
    const failing: ConsistencyDb = {
      ...db,
      insertStockWatchlist: async () => {
        throw new Error("写入被拒绝");
      },
    };
    const { store } = createFakeReports();
    const result = await applyDataConsistency(createDeps(rootDir, failing, store));

    expect(result.errors[0]).toContain("watchlist.json");
    expect(result.applied.quarantined).toHaveLength(0);
    const kept = await readFile(path.join(rootDir, ".data", "watchlist.json"), "utf8");
    expect(kept).toContain("600519");
  });
});
