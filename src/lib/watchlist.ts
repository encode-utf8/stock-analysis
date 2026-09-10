// 自选股数据访问层：优先使用远程 PostgreSQL 的 watchlist 表，否则使用内存 stub。
// 代码校验与市场识别复用 lib/market，保持沪深北 A 股口径一致。
import { asc, eq } from "drizzle-orm";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getDb, schema } from "@/lib/db";
import { detectExchange, normalizeStockCode, resolveStock } from "@/lib/market";
import type { WatchlistItem } from "@/lib/shared/types";

/** 本地持久化自选股文件；数据库不可用时保证重启后仍保留。 */
const WATCHLIST_FILE = path.join(process.cwd(), ".data", "watchlist.json");
const DEFAULT_WATCHLIST_GROUP = "默认";

/** 空分组或旧数据缺省分组统一归入默认分组。 */
function normalizeGroup(group: string | null | undefined): string {
  return group?.trim() || DEFAULT_WATCHLIST_GROUP;
}

/** 自选股新增请求。 */
export interface WatchlistAddInput {
  code: string;
  note?: string | null;
  group?: string | null;
}

/** 自选股备注更新请求。 */
export interface WatchlistNoteInput {
  code: string;
  note: string | null;
}

/** 自选股排序请求。 */
export interface WatchlistReorderInput {
  codes: string[];
}

/** 自选股仓储接口。 */
export interface WatchlistRepository {
  list(): Promise<WatchlistItem[]>;
  getByCode(code: string): Promise<WatchlistItem | null>;
  add(item: WatchlistItem): Promise<void>;
  remove(code: string): Promise<void>;
  updateNote(code: string, note: string | null): Promise<void>;
  updateName(code: string, name: string): Promise<void>;
  reorder(codes: string[]): Promise<void>;
}

/** 将数据库行转换为共享自选股模型。 */
function mapRow(row: typeof schema.watchlist.$inferSelect): WatchlistItem {
  return {
    code: row.code,
    name: row.name,
    exchange: row.exchange,
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

/** 从本地 JSON 文件读取自选股；文件不存在或损坏时返回空列表。 */
async function loadWatchlistFile(): Promise<WatchlistItem[]> {
  try {
    const content = await readFile(WATCHLIST_FILE, "utf8");
    const parsed = JSON.parse(content) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (item): item is WatchlistItem =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as WatchlistItem).code === "string" &&
          typeof (item as WatchlistItem).name === "string",
      )
      .map((item) => ({
        ...item,
        group: normalizeGroup((item as WatchlistItem).group),
      }));
  } catch {
    return [];
  }
}

/** 将自选股列表写入本地 JSON 文件。 */
async function saveWatchlistFile(items: WatchlistItem[]): Promise<void> {
  await mkdir(path.dirname(WATCHLIST_FILE), { recursive: true });
  await writeFile(WATCHLIST_FILE, JSON.stringify(items, null, 2), "utf8");
}

/** 创建文件持久化自选股仓储，用于数据库不可用时的跨重启回退。 */
function createFileWatchlistRepository(): WatchlistRepository {
  const items = new Map<string, WatchlistItem>();
  let loaded = false;

  const ensureLoaded = async () => {
    if (loaded) {
      return;
    }
    const rows = await loadWatchlistFile();
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
    await saveWatchlistFile(rows);
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

/** 创建远程 PostgreSQL 自选股仓储。 */
function createDrizzleWatchlistRepository(): WatchlistRepository {
  const db = getDb();

  return {
    async list() {
      const rows = await db
        .select()
        .from(schema.watchlist)
        .orderBy(asc(schema.watchlist.sortOrder), asc(schema.watchlist.addedAt));
      return rows.map(mapRow);
    },
    async getByCode(code) {
      const rows = await db
        .select()
        .from(schema.watchlist)
        .where(eq(schema.watchlist.code, code))
        .limit(1);
      const row = rows[0];
      return row ? mapRow(row) : null;
    },
    async add(item) {
      await db
        .insert(schema.watchlist)
        .values({
          code: item.code,
          name: item.name,
          exchange: item.exchange,
          group: item.group,
          sortOrder: item.sort_order,
          note: item.note,
          addedAt: new Date(item.added_at),
        })
        .onConflictDoUpdate({
          target: schema.watchlist.code,
          set: {
            name: item.name,
            exchange: item.exchange,
            group: item.group,
            sortOrder: item.sort_order,
            note: item.note,
          },
        });
    },
    async remove(code) {
      await db.delete(schema.watchlist).where(eq(schema.watchlist.code, code));
    },
    async updateNote(code, note) {
      await db
        .update(schema.watchlist)
        .set({ note })
        .where(eq(schema.watchlist.code, code));
    },
    async updateName(code, name) {
      await db
        .update(schema.watchlist)
        .set({ name })
        .where(eq(schema.watchlist.code, code));
    },
    async reorder(codes) {
      await Promise.all(
        codes.map((code, index) =>
          db
            .update(schema.watchlist)
            .set({ sortOrder: index })
            .where(eq(schema.watchlist.code, code)),
        ),
      );
    },
  };
}

/** 创建带故障回退的自选股仓储：数据库不可用时自动切换内存实现。 */
function createResilientWatchlistRepository(): WatchlistRepository {
  const fallback = createFileWatchlistRepository();
  let drizzleRepository: WatchlistRepository | null = null;
  let useFallback = false;

  const run = async <T>(method: keyof WatchlistRepository, args: unknown[]): Promise<T> => {
    if (useFallback) {
      return (fallback[method] as (...methodArgs: unknown[]) => Promise<T>)(...args);
    }

    try {
      drizzleRepository ??= createDrizzleWatchlistRepository();
      return await (drizzleRepository[method] as (...methodArgs: unknown[]) => Promise<T>)(...args);
    } catch (error) {
      useFallback = true;
      console.warn("[watchlist] PostgreSQL 访问失败，本次运行已切换为本地文件存储：", error);
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

/** 校验新增自选股输入并构建可持久化条目。 */
export function buildWatchlistItem(
  input: WatchlistAddInput,
): { item: WatchlistItem } | { error: string } {
  const code = normalizeStockCode(input.code);
  if (!code) {
    return { error: "请输入合法的沪深北 A 股 6 位代码。" };
  }

  const exchange = detectExchange(code);
  if (!exchange) {
    return { error: "暂不支持该市场，请输入沪深北 A 股代码。" };
  }

  const stock = resolveStock(code);
  const note =
    typeof input.note === "string" && input.note.trim()
      ? input.note.trim()
      : null;

  return {
    item: {
      code,
      name: stock.name,
      exchange,
      group: normalizeGroup(input.group),
      added_at: new Date().toISOString(),
      sort_order: 0,
      note,
    },
  };
}

/** 默认自选股仓储单例，供 API 路由统一使用。 */
export const watchlistRepository: WatchlistRepository =
  createResilientWatchlistRepository();
