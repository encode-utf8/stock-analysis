// 基金持有组合数据访问与估值编排。
// 存储策略与自选池、个股持仓一致：优先 PostgreSQL，失败时回退 .data/fund-positions.json。
// 录入口径为极简三项（代码、当前持有金额、当前累计收益），当日收益由盘中涨跌幅推导，
// 数值计算全部复用纯函数 fund-position-calc。
import { asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getDb, schema } from "@/lib/db";
import { getFundNav } from "@/lib/fund-data";
import { getFundIntraday } from "@/lib/fund-intraday";
import { normalizeFundCode, resolveFundProfile } from "@/lib/fund-market";
import {
  computeFundPositionMath,
  computeWeights,
  parseNumericInput,
  round2,
  sumValuations,
} from "@/lib/fund-position-calc";
import type {
  FundIntraday,
  FundNavPoint,
  FundPosition,
  FundPositionInput,
  FundPositionNavMode,
  FundPositionSnapshot,
  FundPositionSummary,
  FundPositionUpdateInput,
  FundPositionValuation,
} from "@/lib/shared/types";

/** 本地持久化文件；数据库不可用时保证重启后仍保留。 */
const POSITION_FILE = path.join(process.cwd(), ".data", "fund-positions.json");

/** 持有金额与累计收益的取值范围，超出视为脏数据直接拒绝。 */
const AMOUNT_MAX = 1e12;
const PROFIT_ABS_MAX = 1e13;

/** 备注长度上限，避免超长文本写库。 */
const NOTE_MAX_LENGTH = 120;

/** 界面统一展示的数据来源与口径说明。 */
const DEFAULT_SOURCE_NOTE =
  "当日涨跌幅与实时估值来自本地行情侧车（场内实时价 / 场外盘中估算净值，60 秒缓存），昨收净值取最新公布单位净值；取不到时对应字段显示为空。";

/** 明细备注归一化：去空白，空串转为 null，超长截断。 */
function normalizeNote(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, NOTE_MAX_LENGTH) : null;
}

/** 校验新增持仓入参：只接受代码、当前持有金额与当前累计收益。 */
export function validateFundPositionInput(
  input: FundPositionInput,
): { value: { code: string; amount: number; profit: number; note: string | null } } | { error: string } {
  const code = typeof input?.code === "string" ? normalizeFundCode(input.code) : null;
  if (!code) {
    return { error: "请输入 6 位基金代码。" };
  }

  const amount = parseNumericInput(input?.amount);
  if (amount === null || amount <= 0) {
    return { error: "当前持有金额必须是大于 0 的数字。" };
  }
  if (amount > AMOUNT_MAX) {
    return { error: "当前持有金额过大，请确认输入是否正确。" };
  }

  const profit = input.profit === undefined || input.profit === null ? 0 : parseNumericInput(input.profit);
  if (profit === null) {
    return { error: "当前累计收益必须是数字，可以为负。" };
  }
  if (Math.abs(profit) > PROFIT_ABS_MAX) {
    return { error: "当前累计收益过大，请确认输入是否正确。" };
  }

  return {
    value: { code, amount: round2(amount), profit: round2(profit), note: normalizeNote(input.note) },
  };
}

/** 校验更新持仓入参；只允许调整持有金额、累计收益与备注。 */
export function validateFundPositionUpdate(
  input: FundPositionUpdateInput,
): { value: { amount?: number; profit?: number; note?: string | null } } | { error: string } {
  const value: { amount?: number; profit?: number; note?: string | null } = {};

  if (input.amount !== undefined) {
    const amount = parseNumericInput(input.amount);
    if (amount === null || amount <= 0) {
      return { error: "当前持有金额必须是大于 0 的数字。" };
    }
    if (amount > AMOUNT_MAX) {
      return { error: "当前持有金额过大，请确认输入是否正确。" };
    }
    value.amount = round2(amount);
  }

  if (input.profit !== undefined) {
    const profit = parseNumericInput(input.profit);
    if (profit === null) {
      return { error: "当前累计收益必须是数字，可以为负。" };
    }
    if (Math.abs(profit) > PROFIT_ABS_MAX) {
      return { error: "当前累计收益过大，请确认输入是否正确。" };
    }
    value.profit = round2(profit);
  }

  if (input.note !== undefined) {
    value.note = normalizeNote(input.note);
  }

  if (Object.keys(value).length === 0) {
    return { error: "没有需要更新的字段。" };
  }

  return { value };
}

/** 构建可持久化的持仓记录；名称优先取上游校验结果，其次本地档案。 */
export function buildFundPosition(
  input: { code: string; amount: number; profit: number; note: string | null },
  name?: string | null,
): FundPosition {
  const now = new Date().toISOString();
  const fallbackName = resolveFundProfile(input.code).name;
  return {
    id: randomUUID(),
    code: input.code,
    name: name?.trim() || fallbackName,
    amount: input.amount,
    profit: input.profit,
    note: input.note,
    created_at: now,
    updated_at: now,
  };
}

/** 判断来源是否可用于估值；确定性降级数据只保证页面可渲染，不参与估值。 */
function isUsableSource(source: string | null | undefined): boolean {
  return typeof source === "string" && source.length > 0 && source !== "deterministic-fallback";
}

/** 计价来源：当前用于推导当日收益的涨跌幅及其口径。 */
export interface PricingSource {
  nav: number;
  changePct: number | null;
  mode: FundPositionNavMode;
  source: string | null;
  fetchedAt: string | null;
}

/** 官方最新单位净值（展示为「上一个交易日收盘净值」）。 */
export interface OfficialNav {
  nav: number;
  source: string | null;
  fetchedAt: string | null;
}

/** 从历史净值中挑出最新一条官方单位净值；整体不可用时退回盘中行情自带的官方净值。 */
export function resolveOfficialNav(
  points: FundNavPoint[],
  intraday: FundIntraday | null,
): OfficialNav | null {
  const usable = points.filter(
    (point) => isUsableSource(point.source) && Number.isFinite(point.unit_nav) && point.unit_nav > 0,
  );
  if (usable.length > 0) {
    const latest = usable.reduce((left, right) => (left.nav_date >= right.nav_date ? left : right));
    return { nav: latest.unit_nav, source: latest.source, fetchedAt: latest.fetched_at };
  }

  if (
    intraday &&
    isUsableSource(intraday.source) &&
    typeof intraday.official_nav === "number" &&
    Number.isFinite(intraday.official_nav) &&
    intraday.official_nav > 0
  ) {
    return { nav: intraday.official_nav, source: intraday.source, fetchedAt: intraday.fetched_at };
  }

  return null;
}

/** 确定计价来源：优先场内实时价 / 场外估算净值，其次官方净值，最后视为不可用。 */
export function resolvePricingSource(
  intraday: FundIntraday | null,
  official: OfficialNav | null,
): PricingSource | null {
  if (intraday && isUsableSource(intraday.source)) {
    const changePct =
      typeof intraday.change_pct === "number" && Number.isFinite(intraday.change_pct)
        ? intraday.change_pct
        : null;
    const estimate = intraday.mode === "realtime" ? intraday.price : intraday.estimated_nav;
    if (typeof estimate === "number" && Number.isFinite(estimate) && estimate > 0) {
      return {
        nav: estimate,
        changePct,
        mode: intraday.mode === "realtime" ? "realtime" : "estimate",
        source: intraday.source,
        fetchedAt: intraday.fetched_at,
      };
    }
    if (typeof intraday.official_nav === "number" && intraday.official_nav > 0) {
      // 实时估值退回官方净值展示，但当日涨跌幅若上游给出仍可用于推导当日收益。
      return {
        nav: intraday.official_nav,
        changePct,
        mode: "nav",
        source: intraday.source,
        fetchedAt: intraday.fetched_at,
      };
    }
  }

  if (official) {
    return {
      nav: official.nav,
      changePct: null,
      mode: "nav",
      source: official.source,
      fetchedAt: official.fetchedAt,
    };
  }

  return null;
}

/** 把录入的持有金额/累计收益与盘中估值合成为面板展示口径。 */
export function valueFundPosition(
  position: FundPosition,
  pricing: PricingSource | null,
  official: OfficialNav | null,
): FundPositionValuation {
  const changePct = pricing?.changePct ?? null;
  const math = computeFundPositionMath({
    marketValue: position.amount,
    totalProfit: position.profit,
    changePct,
  });

  return {
    position,
    market_value: round2(position.amount),
    cost_amount: math.costAmount,
    total_profit: math.totalProfit,
    total_profit_pct: math.totalProfitPct,
    day_profit: math.dayProfit,
    prev_total_profit: math.prevTotalProfit,
    change_pct: changePct,
    // 只有估算/实时口径才展示实时估值；回退官方净值时保持空值，避免误读。
    estimated_nav: pricing && pricing.mode !== "nav" ? round2(pricing.nav) : null,
    prev_nav: official ? round2(official.nav) : null,
    weight_pct: 0,
    nav_mode: pricing?.mode ?? "unavailable",
    quote_available: changePct !== null,
    source: pricing?.source ?? official?.source ?? null,
    fetched_at: pricing?.fetchedAt ?? official?.fetchedAt ?? null,
  };
}

/**
 * 批量估值：逐只取盘中行情与历史净值，单只失败只降级该条目，
 * 全部估值完成后统一按持有金额计算持仓占比。
 */
export async function valueFundPositions(
  positions: FundPosition[],
): Promise<FundPositionValuation[]> {
  const valued = await Promise.all(
    positions.map(async (position) => {
      const [intraday, navPoints] = await Promise.all([
        getFundIntraday(position.code).catch((): FundIntraday | null => null),
        getFundNav(position.code, "1m", "unit").catch((): FundNavPoint[] => []),
      ]);
      const usableIntraday = intraday && isUsableSource(intraday.source) ? intraday : null;
      const official = resolveOfficialNav(navPoints, usableIntraday);
      return valueFundPosition(position, resolvePricingSource(usableIntraday, official), official);
    }),
  );

  const weights = computeWeights(valued.map((item) => item.market_value));
  return valued.map((item, index) => ({ ...item, weight_pct: weights[index] ?? 0 }));
}

/** 组装接口返回的持仓快照。 */
export function buildFundPositionSnapshot(
  valuations: FundPositionValuation[],
  generatedAt: string = new Date().toISOString(),
): FundPositionSnapshot {
  const totals = sumValuations(
    valuations.map((item) => ({
      market_value: item.market_value,
      total_profit: item.total_profit,
      day_profit: item.day_profit,
    })),
  );

  const summary: FundPositionSummary = {
    ...totals,
    holdings_count: valuations.length,
    generated_at: generatedAt,
  };

  return { summary, holdings: valuations, source_note: DEFAULT_SOURCE_NOTE };
}

/** 基金持仓仓储接口。 */
export interface FundPositionRepository {
  list(): Promise<FundPosition[]>;
  getById(id: string): Promise<FundPosition | null>;
  getByCode(code: string): Promise<FundPosition | null>;
  add(position: FundPosition): Promise<void>;
  update(
    id: string,
    patch: { amount?: number; profit?: number; note?: string | null },
  ): Promise<void>;
  remove(id: string): Promise<void>;
}

/** 将数据库行转换为共享模型（numeric 列以字符串返回，需要显式转数字）。 */
function mapRow(row: typeof schema.fundPositions.$inferSelect): FundPosition {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    amount: Number(row.amount),
    profit: Number(row.profit),
    note: row.note,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

/** 深拷贝，避免外部修改污染内存数据。 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 判断 JSON 文件中的条目是否结构可用。 */
function isFundPosition(value: unknown): value is FundPosition {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<FundPosition>;
  return (
    typeof item.id === "string" &&
    typeof item.code === "string" &&
    typeof item.name === "string"
  );
}

/** 从本地 JSON 文件读取持仓；文件不存在或损坏时返回空列表。 */
async function loadPositionFile(): Promise<FundPosition[]> {
  try {
    const content = await readFile(POSITION_FILE, "utf8");
    const parsed = JSON.parse(content) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isFundPosition);
  } catch {
    return [];
  }
}

/** 将持仓列表写入本地 JSON 文件。 */
async function savePositionFile(items: FundPosition[]): Promise<void> {
  await mkdir(path.dirname(POSITION_FILE), { recursive: true });
  await writeFile(POSITION_FILE, JSON.stringify(items, null, 2), "utf8");
}

/** 文件持久化持仓仓储。 */
function createFileFundPositionRepository(): FundPositionRepository {
  const items = new Map<string, FundPosition>();
  let loaded = false;

  const ensureLoaded = async () => {
    if (loaded) {
      return;
    }
    for (const item of await loadPositionFile()) {
      items.set(item.id, clone(item));
    }
    loaded = true;
  };

  const persist = async () => {
    const rows = Array.from(items.values())
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((item) => clone(item));
    await savePositionFile(rows);
  };

  return {
    async list() {
      await ensureLoaded();
      return Array.from(items.values())
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((item) => clone(item));
    },
    async getById(id) {
      await ensureLoaded();
      const item = items.get(id);
      return item ? clone(item) : null;
    },
    async getByCode(code) {
      await ensureLoaded();
      const item = Array.from(items.values()).find((row) => row.code === code);
      return item ? clone(item) : null;
    },
    async add(position) {
      await ensureLoaded();
      items.set(position.id, clone(position));
      await persist();
    },
    async update(id, patch) {
      await ensureLoaded();
      const item = items.get(id);
      if (!item) {
        return;
      }
      items.set(id, { ...item, ...patch, updated_at: new Date().toISOString() });
      await persist();
    },
    async remove(id) {
      await ensureLoaded();
      items.delete(id);
      await persist();
    },
  };
}

/** PostgreSQL 持仓仓储。 */
function createDrizzleFundPositionRepository(): FundPositionRepository {
  const db = getDb();

  return {
    async list() {
      const rows = await db
        .select()
        .from(schema.fundPositions)
        .orderBy(asc(schema.fundPositions.createdAt));
      return rows.map(mapRow);
    },
    async getById(id) {
      const rows = await db
        .select()
        .from(schema.fundPositions)
        .where(eq(schema.fundPositions.id, id))
        .limit(1);
      const row = rows[0];
      return row ? mapRow(row) : null;
    },
    async getByCode(code) {
      const rows = await db
        .select()
        .from(schema.fundPositions)
        .where(eq(schema.fundPositions.code, code))
        .limit(1);
      const row = rows[0];
      return row ? mapRow(row) : null;
    },
    async add(position) {
      await db.insert(schema.fundPositions).values({
        id: position.id,
        code: position.code,
        name: position.name,
        amount: position.amount.toFixed(2),
        profit: position.profit.toFixed(2),
        note: position.note,
        createdAt: new Date(position.created_at),
        updatedAt: new Date(position.updated_at),
      });
    },
    async update(id, patch) {
      const values: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.amount !== undefined) {
        values.amount = patch.amount.toFixed(2);
      }
      if (patch.profit !== undefined) {
        values.profit = patch.profit.toFixed(2);
      }
      if (patch.note !== undefined) {
        values.note = patch.note;
      }
      await db.update(schema.fundPositions).set(values).where(eq(schema.fundPositions.id, id));
    },
    async remove(id) {
      await db.delete(schema.fundPositions).where(eq(schema.fundPositions.id, id));
    },
  };
}

/** 带故障回退的持仓仓储：数据库不可用时自动切换本地文件实现。 */
function createResilientFundPositionRepository(): FundPositionRepository {
  const fallback = createFileFundPositionRepository();
  let drizzleRepository: FundPositionRepository | null = null;
  let useFallback = false;

  const run = async <T>(method: keyof FundPositionRepository, args: unknown[]): Promise<T> => {
    if (useFallback) {
      return (fallback[method] as (...methodArgs: unknown[]) => Promise<T>)(...args);
    }
    try {
      drizzleRepository ??= createDrizzleFundPositionRepository();
      return await (drizzleRepository[method] as (...methodArgs: unknown[]) => Promise<T>)(...args);
    } catch (error) {
      useFallback = true;
      console.warn("[fund-position] PostgreSQL 访问失败，本次运行已切换为本地文件存储：", error);
      return (fallback[method] as (...methodArgs: unknown[]) => Promise<T>)(...args);
    }
  };

  return {
    list: () => run("list", []),
    getById: (id) => run("getById", [id]),
    getByCode: (code) => run("getByCode", [code]),
    add: (position) => run("add", [position]),
    update: (id, patch) => run("update", [id, patch]),
    remove: (id) => run("remove", [id]),
  };
}

/** 默认持仓仓储单例，供 API 路由统一使用。 */
export const fundPositionRepository: FundPositionRepository = createResilientFundPositionRepository();