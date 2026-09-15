// 数据一致性清理的数据库适配层。
// 关键约定：这里直接用 Drizzle 客户端读写目标表，不经过各数据域的「故障回退仓储」。
// 原因是回退仓储带「粘性降级」：进程内失败一次后本次运行都读写本地文件，
// 若复用它们做回填，会出现「把文件内容当成数据库现状」→ 判定为冗余 → 隔离文件，造成数据丢失。

import { readFile } from "node:fs/promises";
import path from "node:path";

import { eq, sql } from "drizzle-orm";

import type {
  ConsistencyDb,
  ConsistencyTable,
  DatabaseHealth,
  RemoteEntry,
} from "@/lib/data-consistency";
import {
  alertEventSignature,
  alertRuleSignature,
  fundPositionSignature,
  fundWatchlistSignature,
  stockHoldingSignature,
  stockWatchlistSignature,
} from "@/lib/data-consistency-signature";
import { getDb, hasRealDatabaseUrl, schema } from "@/lib/db";
import type {
  AlertEvent,
  AlertRule,
  FundPosition,
  FundPositionCalibration,
  FundPositionManualAnchor,
  FundWatchlistItem,
  StockHolding,
  WatchlistItem,
} from "@/lib/shared/types";

/** 清理必须依赖的表；缺少任一张说明数据库结构落后于当前代码版本。 */
const REQUIRED_TABLES = [
  "watchlist",
  "fund_watchlist",
  "stock_holdings",
  "fund_positions",
  "alert_rules",
  "alert_events",
] as const;

/** 各数据域用于判断「数据库最后改动时间」的时间列。 */
const MODIFIED_COLUMNS: Record<ConsistencyTable, string> = {
  watchlist: "added_at",
  fund_watchlist: "added_at",
  stock_holdings: "updated_at",
  fund_positions: "updated_at",
  alert_rules: "updated_at",
  alert_events: "created_at",
};

/** 统一提取错误信息。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Drizzle 返回值可能是数组或 `{ rows }`，这里统一取出行数组。 */
function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as Array<Record<string, unknown>>;
  }
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

/** 读取本地迁移日志条数，用于判断数据库是否落后于代码。 */
async function countLocalMigrations(rootDir: string): Promise<number> {
  try {
    const content = await readFile(
      path.join(rootDir, "drizzle", "meta", "_journal.json"),
      "utf8",
    );
    const parsed = JSON.parse(content) as { entries?: unknown };
    return Array.isArray(parsed.entries) ? parsed.entries.length : 0;
  } catch {
    return 0;
  }
}

/** 时间字符串安全转换：非法值回落到当前时间，避免写入失败。 */
function toDate(value: string | null | undefined): Date {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();
}

/** 判断字符串是否为可展示的名称。 */
function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** 数据库健康检查：连接、关键表、迁移进度三重校验。 */
async function checkHealth(rootDir: string): Promise<DatabaseHealth> {
  if (!hasRealDatabaseUrl()) {
    return {
      status: "unavailable",
      message: "未配置可用的 DATABASE_URL，本地降级文件是当前唯一存储，不做任何清理。",
      missingTables: [],
      pendingMigrations: 0,
    };
  }

  let db: ReturnType<typeof getDb>;
  try {
    db = getDb();
    await db.execute(sql`select 1`);
  } catch (error) {
    return {
      status: "unavailable",
      message: `数据库连接失败：${messageOf(error)}`,
      missingTables: [],
      pendingMigrations: 0,
    };
  }

  try {
    const tableRows = rowsOf(
      await db.execute(sql`select tablename from pg_tables where schemaname = 'public'`),
    );
    const existing = new Set(tableRows.map((row) => String(row.tablename)));
    const missingTables = REQUIRED_TABLES.filter((table) => !existing.has(table));
    const appliedRows = rowsOf(
      await db.execute(sql`select count(*)::int as count from drizzle.__drizzle_migrations`),
    );
    const applied = Number(appliedRows[0]?.count ?? 0);
    const localCount = await countLocalMigrations(rootDir);
    const pendingMigrations = Math.max(0, localCount - applied);

    if (missingTables.length > 0 || pendingMigrations > 0) {
      const parts: string[] = [];
      if (missingTables.length > 0) {
        parts.push(`缺少数据表 ${missingTables.join("、")}`);
      }
      if (pendingMigrations > 0) {
        parts.push(`有 ${pendingMigrations} 个迁移未应用`);
      }
      return {
        status: "schema_behind",
        message: `数据库结构落后于代码：${parts.join("；")}。请先执行 corepack pnpm db:migrate。`,
        missingTables,
        pendingMigrations,
      };
    }

    return {
      status: "ready",
      message: "数据库连接正常，关键表与迁移均为当前版本。",
      missingTables: [],
      pendingMigrations: 0,
    };
  } catch (error) {
    return {
      status: "schema_behind",
      message: `数据库结构校验失败：${messageOf(error)}。请先执行 corepack pnpm db:migrate。`,
      missingTables: [],
      pendingMigrations: 0,
    };
  }
}

/** 把基金持仓的定投计划转换为数据表列。 */
function planColumns(plan: FundPosition["plan"]): Record<string, unknown> {
  return {
    dcaFrequency: plan?.frequency ?? null,
    dcaWeekday: plan?.weekday ?? null,
    dcaAmount: plan ? plan.amount.toFixed(2) : null,
    dcaStartDate: plan?.start_date ?? null,
  };
}

/** 把基金持仓的校准基线转换为数据表列。 */
function calibrationColumns(
  calibration: FundPositionCalibration | null | undefined,
): Record<string, unknown> {
  return {
    calibNavDate: calibration?.nav_date ?? null,
    calibShares: calibration ? calibration.shares.toFixed(4) : null,
    calibCost: calibration ? calibration.cost.toFixed(2) : null,
    calibNav:
      calibration && calibration.nav !== null ? calibration.nav.toFixed(4) : null,
    calibAnchor: calibration ? calibration.anchor : null,
  };
}

/** 把基金持仓的手动锚点转换为数据表列。 */
function manualAnchorColumns(
  anchor: FundPositionManualAnchor | null | undefined,
): Record<string, unknown> {
  return {
    manualAnchorDate: anchor?.nav_date ?? null,
    manualAnchorNav: anchor && anchor.nav !== null ? anchor.nav.toFixed(4) : null,
    manualAnchorSource: anchor?.source ?? null,
  };
}

/** 创建直连数据库的清理适配层。 */
export function createDrizzleConsistencyDb(rootDir: string): ConsistencyDb {
  const db = () => getDb();

  return {
    health: () => checkHealth(rootDir),

    /**
     * 该数据域在数据库中的最后改动时间。
     * 取时间列的最大值：数据库没有写入过（或读取失败）时返回 null，判定层会保守地不覆盖数据库。
     */
    async getLastModified(table: ConsistencyTable): Promise<string | null> {
      const column = MODIFIED_COLUMNS[table];
      if (!column) {
        return null;
      }
      try {
        const result = await db().execute(
          sql`select max(${sql.identifier(column)}) as modified_at from ${sql.identifier(table)}`,
        );
        const value = rowsOf(result)[0]?.modified_at;
        if (value === null || value === undefined) {
          return null;
        }
        const date = value instanceof Date ? value : new Date(String(value));
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
      } catch {
        return null;
      }
    },

    async listStockWatchlist(): Promise<RemoteEntry[]> {
      const rows = await db().select().from(schema.watchlist);
      return rows.map((row) => ({
        key: row.code,
        id: row.code,
        label: row.name,
        updated_at: row.addedAt.toISOString(),
        signature: stockWatchlistSignature(
          row.code,
          row.name,
          row.exchange,
          row.group,
          row.sortOrder,
          row.note,
        ),
      }));
    },

    async insertStockWatchlist(item: WatchlistItem): Promise<void> {
      await db()
        .insert(schema.watchlist)
        .values({
          code: item.code,
          name: item.name,
          exchange: item.exchange,
          group: item.group || "默认",
          sortOrder: Number.isFinite(item.sort_order) ? item.sort_order : 0,
          note: textOrNull(item.note),
          addedAt: toDate(item.added_at),
        })
        .onConflictDoNothing();
    },

    /** 以本地文件为准覆盖数据库里的同代码条目（数据库版本落后于本地时使用）。 */
    async updateStockWatchlist(item: WatchlistItem): Promise<void> {
      await db()
        .update(schema.watchlist)
        .set({
          name: item.name,
          exchange: item.exchange,
          group: item.group || "默认",
          sortOrder: Number.isFinite(item.sort_order) ? item.sort_order : 0,
          note: textOrNull(item.note),
        })
        .where(eq(schema.watchlist.code, item.code));
    },

    async listFundWatchlist(): Promise<RemoteEntry[]> {
      const rows = await db().select().from(schema.fundWatchlist);
      return rows.map((row) => ({
        key: row.code,
        id: row.code,
        label: row.name,
        updated_at: row.addedAt.toISOString(),
        signature: fundWatchlistSignature(
          row.code,
          row.name,
          row.type,
          row.tradingMode,
          row.group,
          row.sortOrder,
          row.note,
        ),
      }));
    },

    async insertFundWatchlist(item: FundWatchlistItem): Promise<void> {
      await db()
        .insert(schema.fundWatchlist)
        .values({
          code: item.code,
          name: item.name,
          type: item.type,
          tradingMode: item.trading_mode,
          group: item.group || "默认",
          addedAt: toDate(item.added_at),
          sortOrder: Number.isFinite(item.sort_order) ? item.sort_order : 0,
          note: textOrNull(item.note),
        })
        .onConflictDoNothing();
    },

    /** 以本地文件为准覆盖数据库里的同代码条目（数据库版本落后于本地时使用）。 */
    async updateFundWatchlist(item: FundWatchlistItem): Promise<void> {
      await db()
        .update(schema.fundWatchlist)
        .set({
          name: item.name,
          type: item.type,
          tradingMode: item.trading_mode,
          group: item.group || "默认",
          sortOrder: Number.isFinite(item.sort_order) ? item.sort_order : 0,
          note: textOrNull(item.note),
        })
        .where(eq(schema.fundWatchlist.code, item.code));
    },

    async listStockHoldings(): Promise<RemoteEntry[]> {
      const rows = await db().select().from(schema.stockHoldings);
      return rows.map((row) => ({
        key: row.code,
        id: row.id,
        label: row.name,
        updated_at: row.updatedAt.toISOString(),
        signature: stockHoldingSignature(
          row.code,
          row.name,
          row.amount,
          row.profit,
          row.note,
        ),
      }));
    },

    async insertStockHolding(holding: StockHolding): Promise<void> {
      await db()
        .insert(schema.stockHoldings)
        .values({
          id: holding.id,
          code: holding.code,
          name: holding.name,
          amount: holding.amount.toFixed(2),
          profit: holding.profit.toFixed(2),
          note: textOrNull(holding.note),
          createdAt: toDate(holding.created_at),
          updatedAt: toDate(holding.updated_at),
        })
        .onConflictDoNothing();
    },

    async updateStockHolding(id: string, holding: StockHolding): Promise<void> {
      await db()
        .update(schema.stockHoldings)
        .set({
          amount: holding.amount.toFixed(2),
          profit: holding.profit.toFixed(2),
          note: textOrNull(holding.note),
          updatedAt: toDate(holding.updated_at),
        })
        .where(eq(schema.stockHoldings.id, id));
    },

    async listFundPositions(): Promise<RemoteEntry[]> {
      const rows = await db().select().from(schema.fundPositions);
      return rows.map((row) => ({
        key: row.code,
        id: row.id,
        label: row.name,
        updated_at: row.updatedAt.toISOString(),
        signature: fundPositionSignature(
          row.code,
          row.name,
          row.amount,
          row.profit,
          row.profitCaliber,
          row.dcaFrequency
            ? {
                frequency: row.dcaFrequency,
                weekday: row.dcaWeekday,
                amount: row.dcaAmount,
                start_date: row.dcaStartDate,
              }
            : null,
          row.calibNavDate || row.calibAnchor
            ? {
                nav_date: row.calibNavDate,
                shares: row.calibShares,
                cost: row.calibCost,
                nav: row.calibNav,
                anchor: row.calibAnchor,
              }
            : null,
          row.manualAnchorDate || row.manualAnchorSource
            ? {
                nav_date: row.manualAnchorDate,
                nav: row.manualAnchorNav,
                source: row.manualAnchorSource,
              }
            : null,
          row.note,
        ),
      }));
    },

    async insertFundPosition(position: FundPosition): Promise<void> {
      await db()
        .insert(schema.fundPositions)
        .values({
          id: position.id,
          code: position.code,
          name: position.name,
          amount: position.amount.toFixed(2),
          profit: position.profit.toFixed(2),
          profitCaliber: position.profit_caliber,
          ...planColumns(position.plan),
          ...calibrationColumns(position.calibration),
          ...manualAnchorColumns(position.manual_anchor),
          note: textOrNull(position.note),
          createdAt: toDate(position.created_at),
          updatedAt: toDate(position.updated_at),
        })
        .onConflictDoNothing();
    },

    async updateFundPosition(id: string, position: FundPosition): Promise<void> {
      await db()
        .update(schema.fundPositions)
        .set({
          amount: position.amount.toFixed(2),
          profit: position.profit.toFixed(2),
          profitCaliber: position.profit_caliber,
          ...planColumns(position.plan),
          ...calibrationColumns(position.calibration),
          ...manualAnchorColumns(position.manual_anchor),
          note: textOrNull(position.note),
          updatedAt: toDate(position.updated_at),
        })
        .where(eq(schema.fundPositions.id, id));
    },

    async listAlertRules(): Promise<RemoteEntry[]> {
      const rows = await db().select().from(schema.alertRules);
      return rows.map((row) => ({
        key: row.id,
        id: row.id,
        label: `${row.target} ${row.code}`,
        updated_at: row.updatedAt.toISOString(),
        signature: alertRuleSignature(
          row.target,
          row.code,
          row.name,
          row.logic,
          row.conditions,
          row.enabled,
          row.cooldownHours,
        ),
      }));
    },

    async insertAlertRule(rule: AlertRule): Promise<void> {
      await db()
        .insert(schema.alertRules)
        .values({
          id: rule.id,
          target: rule.target,
          code: rule.code,
          name: rule.name,
          logic: rule.logic,
          conditions: rule.conditions,
          enabled: rule.enabled,
          cooldownHours: rule.cooldown_hours,
          createdAt: toDate(rule.created_at),
          updatedAt: toDate(rule.updated_at),
          lastTriggeredAt: rule.last_triggered_at ? toDate(rule.last_triggered_at) : null,
        })
        .onConflictDoNothing();
    },

    /** 以本地文件为准覆盖数据库里的同 id 规则（数据库版本落后于本地时使用）。 */
    async updateAlertRule(id: string, rule: AlertRule): Promise<void> {
      await db()
        .update(schema.alertRules)
        .set({
          target: rule.target,
          code: rule.code,
          name: rule.name,
          logic: rule.logic,
          conditions: rule.conditions,
          enabled: rule.enabled,
          cooldownHours: rule.cooldown_hours,
          updatedAt: toDate(rule.updated_at),
          lastTriggeredAt: rule.last_triggered_at ? toDate(rule.last_triggered_at) : null,
        })
        .where(eq(schema.alertRules.id, id));
    },

    async listAlertEvents(): Promise<RemoteEntry[]> {
      const rows = await db().select().from(schema.alertEvents);
      return rows.map((row) => ({
        key: row.id,
        id: row.id,
        label: `${row.code} ${row.observedAt.toISOString()}`,
        updated_at: row.createdAt.toISOString(),
        signature: alertEventSignature(
          row.ruleId,
          row.target,
          row.code,
          row.name,
          row.logic,
          row.metrics,
          row.hits,
          row.dataSource,
          row.observedAt.toISOString(),
          row.level,
          row.message,
          row.status,
        ),
      }));
    },

    async insertAlertEvents(events: AlertEvent[]): Promise<void> {
      for (const event of events) {
        await db()
          .insert(schema.alertEvents)
          .values({
            id: event.id,
            ruleId: event.rule_id,
            target: event.target,
            code: event.code,
            name: event.name,
            logic: event.logic,
            metrics: event.metrics,
            hits: event.hits,
            dataSource: event.data_source,
            observedAt: toDate(event.observed_at),
            level: event.level,
            message: event.message,
            emailStatus: event.email_status,
            emailReason: textOrNull(event.email_reason),
            status: event.status,
            createdAt: toDate(event.created_at),
          })
          .onConflictDoNothing();
      }
    },
  };
}