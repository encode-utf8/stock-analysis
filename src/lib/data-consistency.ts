// 数据一致性清理：数据库（日报为 R2 云端）可用时，把本地降级文件里的确定性事实回填到目标存储，
// 并把数据库/数据源断连期间产生的模板化垃圾隔离出 .data。
// 判定规则与安全策略见 docs/data-consistency-cleanup-plan.md。

import { mkdir, readFile, readdir, rename, stat } from "node:fs/promises";
import path from "node:path";

import { isPlaceholderName } from "@/lib/code-verify";
import { createDrizzleConsistencyDb } from "@/lib/data-consistency-db";
import {
  alertEventSignature,
  alertRuleSignature,
  fundPositionSignature,
  fundWatchlistSignature,
  stockHoldingSignature,
  stockWatchlistSignature,
} from "@/lib/data-consistency-signature";
import {
  DAILY_REPORT_KINDS,
  deleteDailyReport,
  getDailyReport,
  saveDailyReport,
} from "@/lib/daily-report-store";
import { isR2Configured } from "@/lib/r2";
import type {
  AlertEvent,
  AlertRule,
  DailyReport,
  DailyReportKind,
  DailyReportStorage,
  FundPosition,
  FundWatchlistItem,
  StockHolding,
  WatchlistItem,
} from "@/lib/shared/types";

/** 数据库健康状态：只有 ready 才允许执行清理。 */
export type DatabaseHealthStatus = "ready" | "unavailable" | "schema_behind";

/** 数据库健康检查结果。 */
export interface DatabaseHealth {
  status: DatabaseHealthStatus;
  message: string;
  /** 缺失的关键表（迁移未应用时给出具体表名）。 */
  missingTables: string[];
  /** 本地迁移日志中尚未应用到数据库的条数。 */
  pendingMigrations: number;
}

/** 参与一致性判定的数据表（用于查询该数据域的最后改动时间）。 */
export type ConsistencyTable =
  | "watchlist"
  | "fund_watchlist"
  | "stock_holdings"
  | "fund_positions"
  | "alert_rules"
  | "alert_events";

/** 数据库侧条目索引：只保留核对所需的最小字段。 */
export interface RemoteEntry {
  key: string;
  id: string;
  label: string;
  /** 数据库记录的更新时间，仅用于展示与排查。 */
  updated_at: string | null;
  /** 数据库记录的内容指纹；与本地条目指纹相同即视为同一条数据。 */
  signature: string;
}

/** 清理需要直连读写的数据库能力（由适配层实现，单测可注入替身）。 */
export interface ConsistencyDb {
  health(): Promise<DatabaseHealth>;

  /** 该数据域在数据库中的最后改动时间；读不到时返回 null，判定层会保守处理。 */
  getLastModified(table: ConsistencyTable): Promise<string | null>;

  listStockWatchlist(): Promise<RemoteEntry[]>;
  insertStockWatchlist(item: WatchlistItem): Promise<void>;
  updateStockWatchlist(item: WatchlistItem): Promise<void>;

  listFundWatchlist(): Promise<RemoteEntry[]>;
  insertFundWatchlist(item: FundWatchlistItem): Promise<void>;
  updateFundWatchlist(item: FundWatchlistItem): Promise<void>;

  listStockHoldings(): Promise<RemoteEntry[]>;
  insertStockHolding(holding: StockHolding): Promise<void>;
  updateStockHolding(id: string, holding: StockHolding): Promise<void>;

  listFundPositions(): Promise<RemoteEntry[]>;
  insertFundPosition(position: FundPosition): Promise<void>;
  updateFundPosition(id: string, position: FundPosition): Promise<void>;

  listAlertRules(): Promise<RemoteEntry[]>;
  insertAlertRule(rule: AlertRule): Promise<void>;
  updateAlertRule(id: string, rule: AlertRule): Promise<void>;

  listAlertEvents(): Promise<RemoteEntry[]>;
  insertAlertEvents(events: AlertEvent[]): Promise<void>;
}

/** 日报存储能力：R2 就绪判定、读取、回填与清除。 */
export interface ConsistencyReportStore {
  /** 云端（R2）是否可用；不可用时本地就是唯一存储，不做任何清理。 */
  cloudReady(): boolean;
  read(
    kind: DailyReportKind,
    date: string,
  ): Promise<{ report: DailyReport; storage: DailyReportStorage } | null>;
  restore(report: DailyReport): Promise<void>;
  /** 通过日报自身的删除通道移除正文与双侧索引条目。 */
  purge(kind: DailyReportKind, date: string): Promise<void>;
}

/** 清理依赖，默认使用真实实现，单测注入替身与临时目录。 */
export interface ConsistencyDeps {
  rootDir: string;
  now(): Date;
  db: ConsistencyDb;
  reports: ConsistencyReportStore;
}

/** 本地降级文件的分类。 */
export type DumpFileKind =
  | "stock-watchlist"
  | "fund-watchlist"
  | "stock-portfolio"
  | "fund-positions"
  | "alerts"
  | "daily-reports"
  | "alert-settings"
  | "unknown";

/** 文件级处置动作。 */
export type DumpAction =
  | "restore"
  | "clean"
  | "archive"
  | "keep"
  | "pending"
  | "report-only"
  | "none";

/** 条目级判定结果。 */
export type EntryDecisionKind =
  | "insert"
  | "update"
  | "redundant"
  | "invalid"
  | "template"
  | "pending";

/** 单条本地数据的核对结论。 */
export interface EntryDecision {
  key: string;
  label: string;
  decision: EntryDecisionKind;
  reason: string;
  /** 命中数据库已有条目时携带其主键，供「本地更新」覆盖使用。 */
  remoteId?: string;
}

/** 单个本地文件的扫描结论。 */
export interface DumpFileReport {
  path: string;
  kind: DumpFileKind;
  action: DumpAction;
  summary: string;
  entries: EntryDecision[];
  bytes: number;
}

/** 扫描计划：数据库状态 + 每个文件的处置建议。 */
export interface ConsistencyPlan {
  database: DatabaseHealth;
  cloudReady: boolean;
  files: DumpFileReport[];
  totals: {
    toRestore: number;
    toUpdate: number;
    toClean: number;
    skipped: number;
  };
  scannedAt: string;
}

/** 执行结果。 */
export interface ConsistencyResult {
  plan: ConsistencyPlan;
  /** 非空表示数据库未就绪、本次未做任何写入。 */
  blocked: string | null;
  applied: {
    restored: number;
    updated: number;
    dropped: number;
    skipped: number;
    quarantined: string[];
  };
  errors: string[];
  completedAt: string;
}

/** 判断是否为 6 位证券代码。 */
export function isSecurityCode(value: unknown): boolean {
  return typeof value === "string" && /^\d{6}$/.test(value.trim());
}

/** 判断是否为可用数值（金额、收益）。 */
export function isUsableNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

/** 统一提取错误信息。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 展示用路径统一使用正斜杠，避免 Windows 反斜杠泄漏到界面与报告里。 */
export function toDisplayPath(value: string): string {
  return value.split(path.sep).join("/");
}

/** 时间字符串是否可解析。 */
function isParsableTime(value: unknown): boolean {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/** 条目核对的取字段规则。 */
export interface EntryReconcileOptions<T> {
  keyOf: (item: T) => string;
  labelOf: (item: T) => string;
  /** 本地条目的内容指纹，必须与数据库适配层使用同一套字段顺序。 */
  signatureOf: (item: T) => string;
  /** 返回非空字符串表示该条为垃圾数据，直接丢弃。 */
  validate: (item: T) => string | null;
  /** 附加提示（例如「占位名，待名称自愈」）。 */
  hintOf?: (item: T) => string | null;
}

/** 条目核对的比对基准：本地文件修改时间 vs 数据库最后改动时间。 */
export interface ReconcileContext {
  /** 本地降级文件的磁盘修改时间（ISO 字符串）；读不到时为 null。 */
  localMtime: string | null;
  /** 数据库该数据域的最后改动时间（ISO 字符串）；读不到时为 null。 */
  dbLastModified: string | null;
}

/** 数据库版本是否落后于本地文件：数据库最后改动时间早于本地文件修改时间。 */
function isDatabaseBehind(context: ReconcileContext): boolean {
  if (!isParsableTime(context.localMtime) || !isParsableTime(context.dbLastModified)) {
    return false;
  }
  return (
    Date.parse(context.dbLastModified as string) < Date.parse(context.localMtime as string)
  );
}

/**
 * 条目级核对。判定基准是「数据更新时间」而不是单纯的内容差异：
 *
 * 1. 数据库没有该主键 → `insert` 回填；
 * 2. 数据库有该主键且内容指纹一致 → `redundant`，两边本就是同一条数据；
 * 3. 数据库有该主键但内容不同 → 默认判为本地老旧冗余（`redundant`）；
 *    只有「数据库最后改动时间早于本地文件修改时间」时才判 `update`（数据库版本落后，以本地为准覆盖）。
 *
 * 任一侧时间不可解析时保持保守：不覆盖数据库。
 */
export function reconcileEntries<T>(
  local: T[],
  remote: RemoteEntry[],
  options: EntryReconcileOptions<T>,
  context: ReconcileContext = { localMtime: null, dbLastModified: null },
): EntryDecision[] {
  const remoteMap = new Map(remote.map((entry) => [entry.key, entry]));
  const databaseBehind = isDatabaseBehind(context);
  const basis = `本地文件修改于 ${context.localMtime ?? "未知时间"}，数据库最后改动于 ${
    context.dbLastModified ?? "未知时间"
  }`;

  return local.map((item) => {
    const key = options.keyOf(item);
    const label = options.labelOf(item);
    const hint = options.hintOf?.(item) ?? null;
    const withHint = (reason: string): string => (hint ? `${reason}；${hint}` : reason);

    const invalidReason = options.validate(item);
    if (invalidReason) {
      return { key, label, decision: "invalid" as const, reason: withHint(invalidReason) };
    }

    const current = remoteMap.get(key);
    if (!current) {
      return { key, label, decision: "insert" as const, reason: withHint("数据库缺少该条目") };
    }

    if (options.signatureOf(item) === current.signature) {
      return {
        key,
        label,
        decision: "redundant" as const,
        reason: withHint("内容与数据库完全一致，本地文件只是冗余副本"),
        remoteId: current.id,
      };
    }

    if (databaseBehind) {
      return {
        key,
        label,
        decision: "update" as const,
        reason: withHint(`数据库最后改动早于本地文件修改（${basis}），数据库版本落后，以本地为准覆盖`),
        remoteId: current.id,
      };
    }

    return {
      key,
      label,
      decision: "redundant" as const,
      reason: withHint(
        `本地与数据库内容不一致，且数据库不早于本地文件（${basis}），判定本地为老旧冗余数据`,
      ),
      remoteId: current.id,
    };
  });
}

/** 本地 JSON 文件的读取结果。 */
interface LoadedDump<T> {
  exists: boolean;
  bytes: number;
  /** 文件存在但结构不是数组/对象，视为降级垃圾。 */
  broken: boolean;
  /** 文件修改时间（ISO 字符串），参与「数据库是否落后于本地」的判定。 */
  mtime: string | null;
  items: T[];
}

/** 读取本地 JSON 数组降级文件。 */
async function loadJsonArrayDump<T>(
  rootDir: string,
  relPath: string,
): Promise<LoadedDump<T>> {
  const file = path.join(rootDir, ".data", relPath);
  let raw: string;
  let bytes = 0;
  let mtime: string | null = null;
  try {
    const info = await stat(file);
    bytes = info.size;
    mtime = info.mtime.toISOString();
    raw = await readFile(file, "utf8");
  } catch {
    return { exists: false, bytes: 0, broken: false, mtime: null, items: [] };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return { exists: true, bytes, broken: true, mtime, items: [] };
    }
    return { exists: true, bytes, broken: false, mtime, items: parsed as T[] };
  } catch {
    return { exists: true, bytes, broken: true, mtime, items: [] };
  }
}

/** 预警降级文件的读取结果。 */
interface LoadedAlertDump {
  exists: boolean;
  bytes: number;
  broken: boolean;
  /** 文件修改时间（ISO 字符串），参与「数据库是否落后于本地」的判定。 */
  mtime: string | null;
  rules: AlertRule[];
  events: AlertEvent[];
}

/** 读取本地预警降级文件（`{ rules, events }` 结构）。 */
async function loadAlertDump(rootDir: string, relPath: string): Promise<LoadedAlertDump> {
  const file = path.join(rootDir, ".data", relPath);
  let raw: string;
  let bytes = 0;
  let mtime: string | null = null;
  try {
    const info = await stat(file);
    bytes = info.size;
    mtime = info.mtime.toISOString();
    raw = await readFile(file, "utf8");
  } catch {
    return { exists: false, bytes: 0, broken: false, mtime: null, rules: [], events: [] };
  }

  try {
    const parsed = JSON.parse(raw) as { rules?: unknown; events?: unknown };
    const rules = Array.isArray(parsed.rules) ? (parsed.rules as AlertRule[]) : [];
    const events = Array.isArray(parsed.events) ? (parsed.events as AlertEvent[]) : [];
    const broken = !Array.isArray(parsed.rules) || !Array.isArray(parsed.events);
    return { exists: true, bytes, broken, mtime, rules, events };
  } catch {
    return { exists: true, bytes, broken: true, mtime, rules: [], events: [] };
  }
}

/** 校验降级文件路径必须落在 .data 目录内，避免任何越界写入。 */
function resolveInsideData(rootDir: string, relPath: string): string {
  const dataRoot = path.resolve(rootDir, ".data");
  const target = path.resolve(dataRoot, relPath);
  if (target !== dataRoot && !target.startsWith(dataRoot + path.sep)) {
    throw new Error(`非法的 .data 相对路径：${relPath}`);
  }
  return target;
}

/** 把处理完毕的降级文件移入隔离目录（不做物理删除，可人工回滚）。 */
async function quarantineFile(
  deps: ConsistencyDeps,
  relPath: string,
  stamp: string,
): Promise<void> {
  const source = resolveInsideData(deps.rootDir, relPath);
  const target = resolveInsideData(deps.rootDir, path.join("quarantine", stamp, relPath));
  await mkdir(path.dirname(target), { recursive: true });
  await rename(source, target);
}

/** 统计一份扫描结论的条目分布。 */
function countDecisions(entries: EntryDecision[]): {
  toRestore: number;
  toUpdate: number;
  toClean: number;
  skipped: number;
} {
  return {
    toRestore: entries.filter((entry) => entry.decision === "insert").length,
    toUpdate: entries.filter((entry) => entry.decision === "update").length,
    toClean: entries.filter(
      (entry) => entry.decision === "invalid" || entry.decision === "template",
    ).length,
    skipped: entries.filter((entry) => entry.decision === "redundant").length,
  };
}
/** 单个数据域的降级文件描述：把「读取、比对、回填」的差异收敛到描述对象里。 */
interface DumpDomain<T> extends EntryReconcileOptions<T> {
  kind: DumpFileKind;
  relPath: string;
  /** 该数据域对应的数据库表，用于查询「数据库最后改动时间」。 */
  table: ConsistencyTable;
  listRemote: (db: ConsistencyDb) => Promise<RemoteEntry[]>;
  insert: (db: ConsistencyDb, item: T) => Promise<void>;
  update?: (db: ConsistencyDb, remoteId: string, item: T) => Promise<void>;
}

/** 读取条目字段的安全包装，兼容文件里的脏数据。 */
function fieldOf(item: unknown, key: string): unknown {
  if (!item || typeof item !== "object") {
    return undefined;
  }
  return (item as Record<string, unknown>)[key];
}

/** 分组字段的安全取值：与数据库写入时的 `group || "默认"` 兜底保持一致。 */
function groupOf(item: unknown): unknown {
  const value = fieldOf(item, "group");
  return typeof value === "string" && value.trim().length > 0 ? value : "默认";
}

/** 排序字段的安全取值：与数据库写入时的兜底 0 保持一致。 */
function sortOrderOf(item: unknown): unknown {
  const value = fieldOf(item, "sort_order");
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** 读取数据库该数据域的最后改动时间；读不到按「未知」处理，判定层会保守地不覆盖数据库。 */
async function readLastModified(
  db: ConsistencyDb,
  tables: ConsistencyTable[],
): Promise<string | null> {
  let latest: string | null = null;
  for (const table of tables) {
    let value: string | null = null;
    try {
      value = await db.getLastModified(table);
    } catch {
      value = null;
    }
    if (!isParsableTime(value)) {
      continue;
    }
    if (!latest || Date.parse(value as string) > Date.parse(latest)) {
      latest = value;
    }
  }
  return latest;
}

/** 自选股降级文件。 */
const STOCK_WATCHLIST_DOMAIN: DumpDomain<WatchlistItem> = {
  kind: "stock-watchlist",
  relPath: "watchlist.json",
  table: "watchlist",
  keyOf: (item) => String(fieldOf(item, "code") ?? "").trim(),
  labelOf: (item) => String(fieldOf(item, "name") ?? ""),
  signatureOf: (item) =>
    stockWatchlistSignature(
      fieldOf(item, "code"),
      fieldOf(item, "name"),
      fieldOf(item, "exchange"),
      groupOf(item),
      sortOrderOf(item),
      fieldOf(item, "note"),
    ),
  validate: (item) =>
    isSecurityCode(fieldOf(item, "code")) ? null : "代码不是 6 位数字，属于无效占位数据",
  hintOf: (item) =>
    isPlaceholderName("stock", String(fieldOf(item, "name") ?? ""))
      ? "名称为本地占位名，回填后交给名称自愈流程补全"
      : null,
  listRemote: (db) => db.listStockWatchlist(),
  insert: (db, item) => db.insertStockWatchlist(item),
  update: (db, _remoteId, item) => db.updateStockWatchlist(item),
};

/** 自选基金降级文件。 */
const FUND_WATCHLIST_DOMAIN: DumpDomain<FundWatchlistItem> = {
  kind: "fund-watchlist",
  relPath: "fund-watchlist.json",
  table: "fund_watchlist",
  keyOf: (item) => String(fieldOf(item, "code") ?? "").trim(),
  labelOf: (item) => String(fieldOf(item, "name") ?? ""),
  signatureOf: (item) =>
    fundWatchlistSignature(
      fieldOf(item, "code"),
      fieldOf(item, "name"),
      fieldOf(item, "type"),
      fieldOf(item, "trading_mode"),
      groupOf(item),
      sortOrderOf(item),
      fieldOf(item, "note"),
    ),
  validate: (item) =>
    isSecurityCode(fieldOf(item, "code")) ? null : "代码不是 6 位数字，属于无效占位数据",
  hintOf: (item) =>
    isPlaceholderName("fund", String(fieldOf(item, "name") ?? ""))
      ? "名称为本地占位名，回填后交给名称自愈流程补全"
      : null,
  listRemote: (db) => db.listFundWatchlist(),
  insert: (db, item) => db.insertFundWatchlist(item),
  update: (db, _remoteId, item) => db.updateFundWatchlist(item),
};

/** 个股持仓降级文件。 */
const STOCK_PORTFOLIO_DOMAIN: DumpDomain<StockHolding> = {
  kind: "stock-portfolio",
  relPath: "stock-portfolio.json",
  table: "stock_holdings",
  keyOf: (item) => String(fieldOf(item, "code") ?? "").trim(),
  labelOf: (item) => String(fieldOf(item, "name") ?? ""),
  signatureOf: (item) =>
    stockHoldingSignature(
      fieldOf(item, "code"),
      fieldOf(item, "name"),
      fieldOf(item, "amount"),
      fieldOf(item, "profit"),
      fieldOf(item, "note"),
    ),
  validate: (item) => {
    if (!isSecurityCode(fieldOf(item, "code"))) {
      return "代码不是 6 位数字，属于无效占位数据";
    }
    const amount = fieldOf(item, "amount");
    if (!isUsableNumber(amount) || (amount as number) <= 0) {
      return "投入金额不是有效正数";
    }
    return isUsableNumber(fieldOf(item, "profit")) ? null : "持仓收益不是有效数值";
  },
  listRemote: (db) => db.listStockHoldings(),
  insert: (db, item) => db.insertStockHolding(item),
  update: (db, remoteId, item) => db.updateStockHolding(remoteId, item),
};

/** 持有基金降级文件；定投派生的持仓允许金额为 0。 */
const FUND_POSITION_DOMAIN: DumpDomain<FundPosition> = {
  kind: "fund-positions",
  relPath: "fund-positions.json",
  table: "fund_positions",
  keyOf: (item) => String(fieldOf(item, "code") ?? "").trim(),
  labelOf: (item) => String(fieldOf(item, "name") ?? ""),
  signatureOf: (item) =>
    fundPositionSignature(
      fieldOf(item, "code"),
      fieldOf(item, "name"),
      fieldOf(item, "amount"),
      fieldOf(item, "profit"),
      fieldOf(item, "profit_caliber"),
      fieldOf(item, "plan"),
      fieldOf(item, "calibration"),
      fieldOf(item, "manual_anchor"),
      fieldOf(item, "note"),
    ),
  validate: (item) => {
    if (!isSecurityCode(fieldOf(item, "code"))) {
      return "代码不是 6 位数字，属于无效占位数据";
    }
    const amount = fieldOf(item, "amount");
    if (!isUsableNumber(amount) || (amount as number) < 0) {
      return "持有金额不是有效数值";
    }
    return isUsableNumber(fieldOf(item, "profit")) ? null : "累计收益不是有效数值";
  },
  hintOf: (item) =>
    isPlaceholderName("fund", String(fieldOf(item, "name") ?? ""))
      ? "名称为本地占位名，回填后交给名称自愈流程补全"
      : null,
  listRemote: (db) => db.listFundPositions(),
  insert: (db, item) => db.insertFundPosition(item),
  update: (db, remoteId, item) => db.updateFundPosition(remoteId, item),
};

/** 生成隔离目录时间戳（本地时间，精确到秒）。 */
export function formatQuarantineStamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** 依据条目分布决定文件级动作：有回填=恢复，有垃圾=清除，其余（纯冗余镜像）=归档。 */
function decideAction(entries: EntryDecision[]): DumpAction {
  const counts = countDecisions(entries);
  if (counts.toRestore + counts.toUpdate > 0) {
    return "restore";
  }
  return counts.toClean > 0 ? "clean" : "archive";
}

/** 汇总一个文件的条目分布文案。 */
function summarizeEntries(entries: EntryDecision[]): string {
  const counts = countDecisions(entries);
  const parts = [
    `待回填 ${counts.toRestore} 条`,
    `待覆盖 ${counts.toUpdate} 条`,
    `冗余 ${counts.skipped} 条`,
    `垃圾 ${counts.toClean} 条`,
  ];
  return `${entries.length} 条本地数据：${parts.join(" / ")}`;
}

/** 扫描单个降级文件。 */
async function scanDomain<T>(
  deps: ConsistencyDeps,
  domain: DumpDomain<T>,
  ready: boolean,
): Promise<DumpFileReport> {
  const loaded = await loadJsonArrayDump<T>(deps.rootDir, domain.relPath);
  const base = {
    path: `.data/${toDisplayPath(domain.relPath)}`,
    kind: domain.kind,
    bytes: loaded.bytes,
  };

  if (!loaded.exists) {
    return { ...base, action: "none", summary: "本地没有该降级文件，无需处理", entries: [] };
  }
  if (loaded.broken) {
    return {
      ...base,
      action: "clean",
      summary: "文件内容不是合法数组，属于降级期间产生的垃圾数据",
      entries: [],
    };
  }
  if (loaded.items.length === 0) {
    return { ...base, action: "clean", summary: "空文件，没有任何用户数据", entries: [] };
  }
  if (!ready) {
    const entries: EntryDecision[] = loaded.items.map((item) => ({
      key: domain.keyOf(item),
      label: domain.labelOf(item),
      decision: "pending",
      reason: "数据库未就绪，本次只扫描不写入",
    }));
    return {
      ...base,
      action: "pending",
      summary: `数据库未就绪，${entries.length} 条本地数据等待比对`,
      entries,
    };
  }

  try {
    const remote = await domain.listRemote(deps.db);
    const entries = reconcileEntries(loaded.items, remote, domain, {
      localMtime: loaded.mtime,
      dbLastModified: await readLastModified(deps.db, [domain.table]),
    });
    return {
      ...base,
      action: decideAction(entries),
      summary: summarizeEntries(entries),
      entries,
    };
  } catch (error) {
    return {
      ...base,
      action: "none",
      summary: `读取数据库失败：${messageOf(error)}`,
      entries: [],
    };
  }
}

/** 预警降级文件的扫描：规则按 id 与更新时间比对，事件按 id 去重回填。 */
async function scanAlerts(deps: ConsistencyDeps, ready: boolean): Promise<DumpFileReport> {
  const relPath = "alerts.json";
  const loaded = await loadAlertDump(deps.rootDir, relPath);
  const base = { path: `.data/${toDisplayPath(relPath)}`, kind: "alerts" as DumpFileKind, bytes: loaded.bytes };

  if (!loaded.exists) {
    return { ...base, action: "none", summary: "本地没有预警降级文件，无需处理", entries: [] };
  }
  if (loaded.broken) {
    return {
      ...base,
      action: "clean",
      summary: "文件结构不是 { rules, events }，属于降级期间产生的垃圾数据",
      entries: [],
    };
  }
  if (loaded.rules.length === 0 && loaded.events.length === 0) {
    return { ...base, action: "clean", summary: "空文件，没有任何预警数据", entries: [] };
  }
  if (!ready) {
    const entries: EntryDecision[] = [
      ...loaded.rules.map((rule) => ({
        key: String(fieldOf(rule, "id") ?? ""),
        label: `规则 ${String(fieldOf(rule, "code") ?? "")}`,
        decision: "pending" as const,
        reason: "数据库未就绪，本次只扫描不写入",
      })),
      ...loaded.events.map((event) => ({
        key: String(fieldOf(event, "id") ?? ""),
        label: `事件 ${String(fieldOf(event, "code") ?? "")}`,
        decision: "pending" as const,
        reason: "数据库未就绪，本次只扫描不写入",
      })),
    ];
    return {
      ...base,
      action: "pending",
      summary: `数据库未就绪，${entries.length} 条预警数据等待比对`,
      entries,
    };
  }

  try {
    const [remoteRules, remoteEvents] = await Promise.all([
      deps.db.listAlertRules(),
      deps.db.listAlertEvents(),
    ]);
    const context = {
      localMtime: loaded.mtime,
      dbLastModified: await readLastModified(deps.db, ["alert_rules", "alert_events"]),
    };
    const entries = [
      ...reconcileEntries(
        loaded.rules,
        remoteRules,
        {
          keyOf: (rule) => String(fieldOf(rule, "id") ?? ""),
          labelOf: (rule) => `规则 ${String(fieldOf(rule, "code") ?? "")}`,
          signatureOf: (rule) =>
            alertRuleSignature(
              fieldOf(rule, "target"),
              fieldOf(rule, "code"),
              fieldOf(rule, "name"),
              fieldOf(rule, "logic"),
              fieldOf(rule, "conditions"),
              fieldOf(rule, "enabled"),
              fieldOf(rule, "cooldown_hours"),
            ),
          validate: (rule) =>
            String(fieldOf(rule, "id") ?? "").trim() ? null : "规则缺少 id，属于无效占位数据",
        },
        context,
      ),
      ...reconcileEntries(
        loaded.events,
        remoteEvents,
        {
          keyOf: (event) => String(fieldOf(event, "id") ?? ""),
          labelOf: (event) => `事件 ${String(fieldOf(event, "code") ?? "")}`,
          signatureOf: (event) =>
            alertEventSignature(
              fieldOf(event, "rule_id"),
              fieldOf(event, "target"),
              fieldOf(event, "code"),
              fieldOf(event, "name"),
              fieldOf(event, "logic"),
              fieldOf(event, "metrics"),
              fieldOf(event, "hits"),
              fieldOf(event, "data_source"),
              fieldOf(event, "observed_at"),
              fieldOf(event, "level"),
              fieldOf(event, "message"),
              fieldOf(event, "status"),
            ),
          validate: (event) =>
            String(fieldOf(event, "id") ?? "").trim() ? null : "事件缺少 id，属于无效占位数据",
        },
        context,
      ),
    ];
    return {
      ...base,
      action: decideAction(entries),
      summary: summarizeEntries(entries),
      entries,
    };
  } catch (error) {
    return { ...base, action: "none", summary: `读取数据库失败：${messageOf(error)}`, entries: [] };
  }
}
/** 本地日报正文文件。 */
interface LocalReportBody {
  kind: DailyReportKind;
  date: string;
  relPath: string;
  bytes: number;
  report: DailyReport | null;
}

/** 本地日报索引条目（只取核对需要的字段）。 */
interface LocalIndexEntry {
  kind: DailyReportKind;
  date: string;
  title: string;
}

/** 日报条目的稳定键。 */
function reportKey(kind: DailyReportKind, date: string): string {
  return `${kind}/${date}`;
}

/** 解析日报键。 */
function parseReportKey(key: string): { kind: DailyReportKind; date: string } | null {
  const [kind, date] = key.split("/");
  if ((kind === "stock" || kind === "fund") && /^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
    return { kind, date };
  }
  return null;
}

/** 判断数据结构是否像一篇日报。 */
function isDailyReportLike(value: unknown): value is DailyReport {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<DailyReport>;
  return (
    (item.kind === "stock" || item.kind === "fund") &&
    typeof item.date === "string" &&
    typeof item.markdown === "string"
  );
}

/** 列出本地日报正文文件。 */
async function listLocalReportBodies(rootDir: string): Promise<LocalReportBody[]> {
  const result: LocalReportBody[] = [];
  for (const kind of DAILY_REPORT_KINDS) {
    const dir = path.join(rootDir, ".data", "daily-reports", kind);
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".json") || file === "index.json") {
        continue;
      }
      const date = file.slice(0, -".json".length);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        continue;
      }
      const full = path.join(dir, file);
      try {
        const info = await stat(full);
        const raw = await readFile(full, "utf8");
        let report: DailyReport | null = null;
        try {
          const parsed = JSON.parse(raw) as unknown;
          report = isDailyReportLike(parsed) ? parsed : null;
        } catch {
          report = null;
        }
        result.push({
          kind,
          date,
          relPath: path.join("daily-reports", kind, file),
          bytes: info.size,
          report,
        });
      } catch {
        continue;
      }
    }
  }
  return result;
}

/** 读取一类日报的本地索引条目。 */
async function listLocalReportIndex(
  rootDir: string,
): Promise<{ entries: LocalIndexEntry[]; bytes: number }> {
  const entries: LocalIndexEntry[] = [];
  let bytes = 0;

  for (const kind of DAILY_REPORT_KINDS) {
    const file = path.join(rootDir, ".data", "daily-reports", kind, "index.json");
    try {
      const info = await stat(file);
      bytes += info.size;
      const parsed = JSON.parse(await readFile(file, "utf8")) as { reports?: unknown };
      if (!Array.isArray(parsed.reports)) {
        continue;
      }
      for (const raw of parsed.reports) {
        const item = raw as { date?: unknown; title?: unknown };
        if (typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
          entries.push({
            kind,
            date: item.date,
            title: typeof item.title === "string" ? item.title : `${kind} ${item.date}`,
          });
        }
      }
    } catch {
      continue;
    }
  }
  return { entries, bytes };
}

/** 读取云端/本地日报，异常按「读不到」处理。 */
async function readReportSafely(
  deps: ConsistencyDeps,
  kind: DailyReportKind,
  date: string,
): Promise<{ report: DailyReport; storage: DailyReportStorage } | null> {
  try {
    return await deps.reports.read(kind, date);
  } catch {
    return null;
  }
}

/**
 * 扫描本地日报：AI 生成的正式日报回填云端；
 * 模板降级稿（数据源断连时的占位内容）与悬空索引属于垃圾，走日报自身的删除通道清除。
 */
async function scanDailyReports(deps: ConsistencyDeps): Promise<DumpFileReport> {
  const base = { path: ".data/daily-reports", kind: "daily-reports" as DumpFileKind };
  const bodies = await listLocalReportBodies(deps.rootDir);
  const index = await listLocalReportIndex(deps.rootDir);
  const bytes = bodies.reduce((sum, body) => sum + body.bytes, 0) + index.bytes;

  if (bodies.length === 0 && index.entries.length === 0) {
    return { ...base, bytes, action: "none", summary: "本地没有日报降级文件，无需处理", entries: [] };
  }

  if (!deps.reports.cloudReady()) {
    return {
      ...base,
      bytes,
      action: "keep",
      summary: `未配置云端日报存储：本地 ${bodies.length} 篇正文与 ${index.entries.length} 条索引是当前唯一存储，全部保留`,
      entries: [],
    };
  }

  const entries: EntryDecision[] = [];
  const bodyKeys = new Set(bodies.map((body) => reportKey(body.kind, body.date)));

  for (const body of bodies) {
    const key = reportKey(body.kind, body.date);
    const label = body.report?.title ?? body.relPath;
    if (!body.report) {
      entries.push({ key, label, decision: "invalid", reason: "本地正文无法解析，无法回填云端" });
      continue;
    }
    const remote = await readReportSafely(deps, body.kind, body.date);
    if (remote?.storage === "r2") {
      entries.push({ key, label, decision: "redundant", reason: "云端已有同一篇日报，本地副本冗余" });
      continue;
    }
    if (body.report.source === "deepseek") {
      entries.push({ key, label, decision: "insert", reason: "云端缺少该篇 AI 日报，需回填" });
    } else {
      entries.push({
        key,
        label,
        decision: "template",
        reason: `模板降级日报（source=${String(body.report.source)}），正文为占位内容`,
      });
    }
  }

  for (const item of index.entries) {
    const key = reportKey(item.kind, item.date);
    if (bodyKeys.has(key)) {
      continue;
    }
    const remote = await readReportSafely(deps, item.kind, item.date);
    if (remote) {
      continue;
    }
    entries.push({
      key,
      label: item.title,
      decision: "invalid",
      reason: "索引条目找不到对应正文（悬空索引），属于降级残留",
    });
  }

  const counts = countDecisions(entries);
  const redundantBodies = entries.filter(
    (entry) => entry.decision === "redundant" && bodyKeys.has(entry.key),
  ).length;
  const action: DumpAction = entries.length === 0 ? "keep" : decideAction(entries);

  return {
    ...base,
    bytes,
    action,
    summary: `本地 ${bodies.length} 篇正文与 ${index.entries.length} 条索引：待回填 ${counts.toRestore} 条 / 垃圾清除 ${counts.toClean} 条 / 冗余副本 ${redundantBodies} 条 / 其余为云端已有内容`,
    entries,
  };
}

/** 扫描预警设置：它不是降级文件，一律保持不动。 */
async function scanSettingsFile(deps: ConsistencyDeps): Promise<DumpFileReport> {
  const relPath = "alert-settings.json";
  try {
    const info = await stat(path.join(deps.rootDir, ".data", relPath));
    return {
      path: `.data/${toDisplayPath(relPath)}`,
      kind: "alert-settings",
      action: "keep",
      summary: "预警设置不是降级文件（数据库模式下同样读写它），保持不动",
      entries: [],
      bytes: info.size,
    };
  } catch {
    return {
      path: `.data/${toDisplayPath(relPath)}`,
      kind: "alert-settings",
      action: "none",
      summary: "本地没有预警设置文件",
      entries: [],
      bytes: 0,
    };
  }
}

/** 已识别的降级文件与目录；其余文件只报告不处理。 */
const KNOWN_DATA_ENTRIES = new Set([
  "watchlist.json",
  "fund-watchlist.json",
  "stock-portfolio.json",
  "fund-positions.json",
  "alerts.json",
  "alert-settings.json",
  "daily-reports",
  "quarantine",
]);

/** 扫描 .data 根目录下的未识别文件。 */
async function scanUnknownFiles(deps: ConsistencyDeps): Promise<DumpFileReport> {
  const base = { path: ".data", kind: "unknown" as DumpFileKind, bytes: 0 };
  let names: string[] = [];
  try {
    const items = await readdir(path.join(deps.rootDir, ".data"), { withFileTypes: true });
    names = items
      .filter((item) => item.isFile() && !KNOWN_DATA_ENTRIES.has(item.name))
      .map((item) => item.name)
      .sort();
  } catch {
    names = [];
  }
  if (names.length === 0) {
    return { ...base, action: "none", summary: "没有未识别的本地文件", entries: [] };
  }
  return {
    ...base,
    action: "report-only",
    summary: `未识别的本地文件 ${names.length} 个，仅报告不处理：${names.join("、")}`,
    entries: [],
  };
}

/** 扫描本地降级数据并生成清理计划（只读，不产生任何写入）。 */
export async function scanDataConsistency(
  deps: ConsistencyDeps = createDefaultConsistencyDeps(),
): Promise<ConsistencyPlan> {
  const database = await deps.db.health();
  const ready = database.status === "ready";

  const files: DumpFileReport[] = [
    await scanDomain(deps, STOCK_WATCHLIST_DOMAIN, ready),
    await scanDomain(deps, FUND_WATCHLIST_DOMAIN, ready),
    await scanDomain(deps, STOCK_PORTFOLIO_DOMAIN, ready),
    await scanDomain(deps, FUND_POSITION_DOMAIN, ready),
    await scanAlerts(deps, ready),
    await scanDailyReports(deps),
    await scanSettingsFile(deps),
    await scanUnknownFiles(deps),
  ];

  const totals = files.reduce(
    (accumulator, file) => {
      const counts = countDecisions(file.entries);
      return {
        toRestore: accumulator.toRestore + counts.toRestore,
        toUpdate: accumulator.toUpdate + counts.toUpdate,
        toClean: accumulator.toClean + counts.toClean,
        skipped: accumulator.skipped + counts.skipped,
      };
    },
    { toRestore: 0, toUpdate: 0, toClean: 0, skipped: 0 },
  );

  return {
    database,
    cloudReady: deps.reports.cloudReady(),
    files,
    totals,
    scannedAt: deps.now().toISOString(),
  };
}

/** 执行结果累计器。 */
interface AppliedAccumulator {
  restored: number;
  updated: number;
  dropped: number;
  skipped: number;
  quarantined: string[];
}

/** 回填并隔离一个数组型降级文件。 */
async function applyDomain<T>(
  deps: ConsistencyDeps,
  domain: DumpDomain<T>,
  stamp: string,
  applied: AppliedAccumulator,
  errors: string[],
): Promise<void> {
  const loaded = await loadJsonArrayDump<T>(deps.rootDir, domain.relPath);
  if (!loaded.exists) {
    return;
  }

  try {
    if (loaded.broken || loaded.items.length === 0) {
      await quarantineFile(deps, domain.relPath, stamp);
      applied.quarantined.push(`.data/${toDisplayPath(domain.relPath)}`);
      return;
    }

    const remote = await domain.listRemote(deps.db);
    const entries = reconcileEntries(loaded.items, remote, domain, {
      localMtime: loaded.mtime,
      dbLastModified: await readLastModified(deps.db, [domain.table]),
    });
    const localByKey = new Map<string, T>();
    for (const item of loaded.items) {
      localByKey.set(domain.keyOf(item), item);
    }

    let unappliedUpdates = 0;
    for (const entry of entries) {
      const item = localByKey.get(entry.key);
      if (!item) {
        continue;
      }
      if (entry.decision === "insert") {
        await domain.insert(deps.db, item);
        applied.restored += 1;
      } else if (entry.decision === "update") {
        if (entry.remoteId && domain.update) {
          await domain.update(deps.db, entry.remoteId, item);
          applied.updated += 1;
        } else {
          unappliedUpdates += 1;
        }
      } else if (entry.decision === "redundant") {
        applied.skipped += 1;
      } else {
        applied.dropped += 1;
      }
    }

    // 覆盖判定必须真正落地，否则保留文件：宁可留文件让人复核，也不能让本地版本只留在隔离目录里。
    if (unappliedUpdates > 0) {
      errors.push(
        `${domain.relPath}：${unappliedUpdates} 条判定为覆盖但该数据域没有覆盖写入能力，已保留本地文件`,
      );
      return;
    }

    // 内容已完整回填（或本就是垃圾）后才隔离文件；中途失败会跳过隔离，保证数据不丢。
    await quarantineFile(deps, domain.relPath, stamp);
    applied.quarantined.push(`.data/${toDisplayPath(domain.relPath)}`);
  } catch (error) {
    errors.push(`${domain.relPath}：${messageOf(error)}`);
  }
}

/** 回填并隔离预警降级文件。 */
async function applyAlerts(
  deps: ConsistencyDeps,
  stamp: string,
  applied: AppliedAccumulator,
  errors: string[],
): Promise<void> {
  const relPath = "alerts.json";
  const loaded = await loadAlertDump(deps.rootDir, relPath);
  if (!loaded.exists) {
    return;
  }

  try {
    if (loaded.broken || (loaded.rules.length === 0 && loaded.events.length === 0)) {
      await quarantineFile(deps, relPath, stamp);
      applied.quarantined.push(`.data/${toDisplayPath(relPath)}`);
      return;
    }

    const [remoteRules, remoteEvents] = await Promise.all([
      deps.db.listAlertRules(),
      deps.db.listAlertEvents(),
    ]);
    const context = {
      localMtime: loaded.mtime,
      dbLastModified: await readLastModified(deps.db, ["alert_rules", "alert_events"]),
    };
    const ruleDecisions = reconcileEntries(
      loaded.rules,
      remoteRules,
      {
        keyOf: (rule) => String(fieldOf(rule, "id") ?? ""),
        labelOf: (rule) => `规则 ${String(fieldOf(rule, "code") ?? "")}`,
        signatureOf: (rule) =>
          alertRuleSignature(
            fieldOf(rule, "target"),
            fieldOf(rule, "code"),
            fieldOf(rule, "name"),
            fieldOf(rule, "logic"),
            fieldOf(rule, "conditions"),
            fieldOf(rule, "enabled"),
            fieldOf(rule, "cooldown_hours"),
          ),
        validate: () => null,
      },
      context,
    );
    const rulesById = new Map(loaded.rules.map((rule) => [String(fieldOf(rule, "id") ?? ""), rule]));
    for (const entry of ruleDecisions) {
      const rule = rulesById.get(entry.key);
      if (!rule) {
        continue;
      }
      if (entry.decision === "insert") {
        await deps.db.insertAlertRule(rule);
        applied.restored += 1;
      } else if (entry.decision === "update" && entry.remoteId) {
        await deps.db.updateAlertRule(entry.remoteId, rule);
        applied.updated += 1;
      } else if (entry.decision === "redundant") {
        applied.skipped += 1;
      } else {
        applied.dropped += 1;
      }
    }

    const eventDecisions = reconcileEntries(
      loaded.events,
      remoteEvents,
      {
        keyOf: (event) => String(fieldOf(event, "id") ?? ""),
        labelOf: (event) => `事件 ${String(fieldOf(event, "code") ?? "")}`,
        signatureOf: (event) =>
          alertEventSignature(
            fieldOf(event, "rule_id"),
            fieldOf(event, "target"),
            fieldOf(event, "code"),
            fieldOf(event, "name"),
            fieldOf(event, "logic"),
            fieldOf(event, "metrics"),
            fieldOf(event, "hits"),
            fieldOf(event, "data_source"),
            fieldOf(event, "observed_at"),
            fieldOf(event, "level"),
            fieldOf(event, "message"),
            fieldOf(event, "status"),
          ),
        validate: () => null,
      },
      context,
    );
    const eventsById = new Map(
      loaded.events.map((event) => [String(fieldOf(event, "id") ?? ""), event]),
    );
    const eventsToInsert = eventDecisions
      .filter((entry) => entry.decision === "insert")
      .map((entry) => eventsById.get(entry.key))
      .filter((event): event is AlertEvent => Boolean(event));
    if (eventsToInsert.length > 0) {
      await deps.db.insertAlertEvents(eventsToInsert);
      applied.restored += eventsToInsert.length;
    }
    // 事件是追加型事实，只回填缺失项；与数据库已有事件不一致时按「不覆盖」处理。
    applied.skipped += eventDecisions.filter((entry) => entry.decision !== "insert").length;

    await quarantineFile(deps, relPath, stamp);
    applied.quarantined.push(`.data/${toDisplayPath(relPath)}`);
  } catch (error) {
    errors.push(`${relPath}：${messageOf(error)}`);
  }
}

/** 回填并清除本地日报。 */
async function applyDailyReports(
  deps: ConsistencyDeps,
  stamp: string,
  applied: AppliedAccumulator,
  errors: string[],
): Promise<void> {
  if (!deps.reports.cloudReady()) {
    return;
  }

  const report = await scanDailyReports(deps);
  const bodies = await listLocalReportBodies(deps.rootDir);
  const bodyByKey = new Map(bodies.map((body) => [reportKey(body.kind, body.date), body]));

  for (const entry of report.entries) {
    const parsed = parseReportKey(entry.key);
    if (!parsed) {
      continue;
    }
    const body = bodyByKey.get(entry.key);
    try {
      if (entry.decision === "insert" && body?.report) {
        await deps.reports.restore(body.report);
        applied.restored += 1;
        await quarantineFile(deps, body.relPath, stamp);
        applied.quarantined.push(`.data/${toDisplayPath(body.relPath)}`);
      } else if (entry.decision === "template" || entry.decision === "invalid") {
        await deps.reports.purge(parsed.kind, parsed.date);
        applied.dropped += 1;
      } else if (entry.decision === "redundant" && body) {
        await quarantineFile(deps, body.relPath, stamp);
        applied.quarantined.push(`.data/${toDisplayPath(body.relPath)}`);
        applied.skipped += 1;
      }
    } catch (error) {
      errors.push(`${entry.key}：${messageOf(error)}`);
    }
  }
}

/**
 * 执行数据一致性清理：
 * 数据库未就绪时只返回扫描计划并给出阻塞原因，不做任何写入；
 * 数据库就绪时先回填事实数据，再把处理完毕的降级文件隔离到 .data/quarantine。
 */
export async function applyDataConsistency(
  deps: ConsistencyDeps = createDefaultConsistencyDeps(),
): Promise<ConsistencyResult> {
  const plan = await scanDataConsistency(deps);
  const applied: AppliedAccumulator = {
    restored: 0,
    updated: 0,
    dropped: 0,
    skipped: 0,
    quarantined: [],
  };
  const errors: string[] = [];

  if (plan.database.status !== "ready") {
    return {
      plan,
      blocked: plan.database.message,
      applied,
      errors,
      completedAt: deps.now().toISOString(),
    };
  }

  const stamp = formatQuarantineStamp(deps.now());
  await applyDomain(deps, STOCK_WATCHLIST_DOMAIN, stamp, applied, errors);
  await applyDomain(deps, FUND_WATCHLIST_DOMAIN, stamp, applied, errors);
  await applyDomain(deps, STOCK_PORTFOLIO_DOMAIN, stamp, applied, errors);
  await applyDomain(deps, FUND_POSITION_DOMAIN, stamp, applied, errors);
  await applyAlerts(deps, stamp, applied, errors);
  await applyDailyReports(deps, stamp, applied, errors);

  return {
    plan,
    blocked: null,
    applied,
    errors,
    completedAt: deps.now().toISOString(),
  };
}

/** 默认依赖：真实数据库适配层 + 日报存储 + 项目根目录。 */
export function createDefaultConsistencyDeps(): ConsistencyDeps {
  const rootDir = process.cwd();
  return {
    rootDir,
    now: () => new Date(),
    db: createDrizzleConsistencyDb(rootDir),
    reports: {
      cloudReady: () => isR2Configured(),
      read: (kind, date) => getDailyReport(kind, date),
      restore: async (report) => {
        await saveDailyReport(report);
      },
      purge: async (kind, date) => {
        await deleteDailyReport(kind, date);
      },
    },
  };
}