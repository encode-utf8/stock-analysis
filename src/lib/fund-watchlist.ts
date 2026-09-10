// 自选基金数据访问层：优先使用 PostgreSQL 的 fund_watchlist 表，否则回退本地 JSON 文件。
// 基金代码与档案识别复用 lib/fund-market，确保与基金工作台主查询口径一致。
import { asc, eq } from "drizzle-orm";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getDb, schema } from "@/lib/db";
import { normalizeFundCode, resolveFundProfile } from "@/lib/fund-market";
import type { FundWatchlistItem } from "@/lib/shared/types";

/** 本地持久化自选基金文件；数据库不可用时保证重启后仍保留。 */
const FUND_WATCHLIST_FILE = path.join(process.cwd(), ".data", "fund-watchlist.json");
const DEFAULT_WATCHLIST_GROUP = "默认";

/** 空分组或旧数据缺省分组统一归入默认分组。 */
function normalizeGroup(group: string | null | undefined): string {
  return group?.trim() || DEFAULT_WATCHLIST_GROUP;
}

/** 自选基金新增请求。 */
export interface FundWatchlistAddInput {
  code: string;
  note?: string | null;
  group?: string | null;
}

/** 自选基金备注更新请求。 */
export interface FundWatchlistNoteInput {
  code: string;
  note: string | null;
}

/** 自选基金排序请求。 */
export interface FundWatchlistReorderInput {
  codes: string[];
}

/** 自选基金仓储接口。 */
export interface FundWatchlistRepository {
  list(): Promise<FundWatchlistItem[]>;
  getByCode(code: string): Promise<FundWatchlistItem | null>;
  add(item: FundWatchlistItem): Promise<void>;
  remove(code: string): Promise<void>;
  updateNote(code: string, note: string | null): Promise<void>;
  updateName(code: string, name: string): Promise<void>;
  reorder(codes: string[]): Promise<void>;
}

/** 将数据库行转换为共享自选基金模型。 */
function mapRow(row: typeof schema.fundWatchlist.$inferSelect): FundWatchlistItem {
  return {
    code: row.code,
    name: row.name,
    type: row.type as FundWatchlistItem["type"],
    trading_mode: row.tradingMode as FundWatchlistItem["trading_mode"],
    group: normalizeGroup(row.group),
    added_at: row.addedAt.toISOString(),
    sort_order: row.sortOrder,
    note: row.note,
  };
}

/** 深拷贝，避免外部修改污染内存数据。 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 从本地 JSON 文件读取自选基金；文件不存在或损坏时返回空列表。 */
async function loadFundWatchlistFile(): Promise<FundWatchlistItem[]> {
  try {
    const content = await readFile(FUND_WATCHLIST_FILE, "utf8");
    const parsed = JSON.parse(content) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (item): item is FundWatchlistItem =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as FundWatchlistItem).code === "string" &&
          typeof (item as FundWatchlistItem).name === "string",
      )
      .map((item) => ({
        ...item,
        group: normalizeGroup((item as FundWatchlistItem).group),
      }));
  } catch {
    return [];
  }
}

/** 将自选基金列表写入本地 JSON 文件。 */
async function saveFundWatchlistFile(items: FundWatchlistItem[]): Promise<void> {
  await mkdir(path.dirname(FUND_WATCHLIST_FILE), { recursive: true });
  await writeFile(FUND_WATCHLIST_FILE, JSON.stringify(items, null, 2), "utf8");
}

/** 创建文件持久化自选基金仓储，用于数据库不可用时的跨重启回退。 */
function createFileFundWatchlistRepository(): FundWatchlistRepository {
  const items = new Map<string, FundWatchlistItem>();
  let loaded = false;

  const ensureLoaded = async () => {
    if (loaded) {
      return;
    }
    const rows = await loadFundWatchlistFile();
    for (const item of rows) {
      items.set(item.code, clone(item));
    }
    loaded = true;
  };

  const persist = async () => {
    const rows = Array.from(items.values())
      .sort(
        (a, b) =>
          a.sort_order - b.sort_order || a.added_at.localeCompare(b.added_at),
      )
      .map((item) => clone(item));
    await saveFundWatchlistFile(rows);
  };

  return {
    async list() {
      await ensureLoaded();
      return Array.from(items.values())
        .sort(
          (a, b) =>
            a.sort_order - b.sort_order || a.added_at.localeCompare(b.added_at),
        )
        .map((item) => clone(item));
    },
    async getByCode(code) {
      await ensureLoaded();
      const item = items.get(code);
      return item ? clone(item) : null;
    },
    async add(item) {
      await ensureLoaded();
      items.set(item.code, clone(item));
      await persist();
    },
    async remove(code) {
      await ensureLoaded();
      items.delete(code);
      await persist();
    },
    async updateNote(code, note) {
      await ensureLoaded();
      const item = items.get(code);
      if (item) {
        items.set(code, { ...item, note });
        await persist();
      }
    },
    async updateName(code, name) {
      await ensureLoaded();
      const item = items.get(code);
      if (item) {
        items.set(code, { ...item, name });
        await persist();
      }
    },
    async reorder(codes) {
      await ensureLoaded();
      const ordered = Array.from(items.values()).sort(
        (a, b) =>
          a.sort_order - b.sort_order || a.added_at.localeCompare(b.added_at),
      );
      const byCode = new Map(ordered.map((item) => [item.code, item]));
      let nextOrder = 0;

      for (const code of codes) {
        const item = byCode.get(code);
        if (item) {
          items.set(code, { ...item, sort_order: nextOrder });
          nextOrder += 1;
        }
      }

      for (const item of ordered) {
        if (!codes.includes(item.code)) {
          items.set(item.code, { ...item, sort_order: nextOrder });
          nextOrder += 1;
        }
      }
      await persist();
    },
  };
}

/** 创建远程 PostgreSQL 自选基金仓储。 */
function createDrizzleFundWatchlistRepository(): FundWatchlistRepository {
  const db = getDb();

  return {
    async list() {
      const rows = await db
        .select()
        .from(schema.fundWatchlist)
        .orderBy(asc(schema.fundWatchlist.sortOrder), asc(schema.fundWatchlist.addedAt));
      return rows.map(mapRow);
    },
    async getByCode(code) {
      const rows = await db
        .select()
        .from(schema.fundWatchlist)
        .where(eq(schema.fundWatchlist.code, code))
        .limit(1);
      const row = rows[0];
      return row ? mapRow(row) : null;
    },
    async add(item) {
      await db
        .insert(schema.fundWatchlist)
        .values({
          code: item.code,
          name: item.name,
          type: item.type,
          tradingMode: item.trading_mode,
          group: item.group,
          sortOrder: item.sort_order,
          note: item.note,
          addedAt: new Date(item.added_at),
        })
        .onConflictDoUpdate({
          target: schema.fundWatchlist.code,
          set: {
            name: item.name,
            type: item.type,
            tradingMode: item.trading_mode,
            group: item.group,
            sortOrder: item.sort_order,
            note: item.note,
          },
        });
    },
    async remove(code) {
      await db.delete(schema.fundWatchlist).where(eq(schema.fundWatchlist.code, code));
    },
    async updateNote(code, note) {
      await db
        .update(schema.fundWatchlist)
        .set({ note })
        .where(eq(schema.fundWatchlist.code, code));
    },
    async updateName(code, name) {
      await db
        .update(schema.fundWatchlist)
        .set({ name })
        .where(eq(schema.fundWatchlist.code, code));
    },
    async reorder(codes) {
      await Promise.all(
        codes.map((code, index) =>
          db
            .update(schema.fundWatchlist)
            .set({ sortOrder: index })
            .where(eq(schema.fundWatchlist.code, code)),
        ),
      );
    },
  };
}

/** 创建带故障回退的自选基金仓储：数据库不可用时自动切换本地文件。 */
function createResilientFundWatchlistRepository(): FundWatchlistRepository {
  const fallback = createFileFundWatchlistRepository();
  let drizzleRepository: FundWatchlistRepository | null = null;
  let useFallback = false;

  const run = async <T>(method: keyof FundWatchlistRepository, args: unknown[]): Promise<T> => {
    if (useFallback) {
      return (fallback[method] as (...methodArgs: unknown[]) => Promise<T>)(...args);
    }

    try {
      drizzleRepository ??= createDrizzleFundWatchlistRepository();
      return await (drizzleRepository[method] as (...methodArgs: unknown[]) => Promise<T>)(...args);
    } catch (error) {
      useFallback = true;
      console.warn("[fund-watchlist] PostgreSQL 访问失败，本次运行已切换为本地文件存储：", error);
      return (fallback[method] as (...methodArgs: unknown[]) => Promise<T>)(...args);
    }
  };

  return {
    list: () => run("list", []),
    getByCode: (code) => run("getByCode", [code]),
    add: (item) => run("add", [item]),
    remove: (code) => run("remove", [code]),
    updateNote: (code, note) => run("updateNote", [code, note]),
    updateName: (code, name) => run("updateName", [code, name]),
    reorder: (codes) => run("reorder", [codes]),
  };
}

/** 校验新增自选基金输入并构建可持久化条目。 */
export function buildFundWatchlistItem(
  input: FundWatchlistAddInput,
): { item: FundWatchlistItem } | { error: string } {
  const code = normalizeFundCode(input.code);
  if (!code) {
    return { error: "请输入合法的 6 位基金代码。" };
  }

  const profile = resolveFundProfile(code);
  const note =
    typeof input.note === "string" && input.note.trim()
      ? input.note.trim()
      : null;

  return {
    item: {
      code,
      name: profile.name,
      type: profile.type,
      trading_mode: profile.trading_mode,
      group: normalizeGroup(input.group),
      added_at: new Date().toISOString(),
      sort_order: 0,
      note,
    },
  };
}

/** 默认自选基金仓储单例，供 API 路由统一使用。 */
export const fundWatchlistRepository: FundWatchlistRepository =
  createResilientFundWatchlistRepository();
