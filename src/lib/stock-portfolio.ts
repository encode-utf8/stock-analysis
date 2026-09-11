// 个股持仓组合数据访问与口径计算。
// 存储策略与自选池一致：优先 PostgreSQL，失败时回退 .data/stock-portfolio.json，保证重启不丢。
import { asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getDb, schema } from "@/lib/db";
import { getMarketQuote } from "@/lib/market-data";
import { normalizeStockCode, resolveStock } from "@/lib/market";
import type { MarketQuote } from "@/lib/shared/types";
import type {
  StockHolding,
  StockHoldingInput,
  StockHoldingUpdateInput,
  StockHoldingValuation,
  StockPortfolioIndustry,
  StockPortfolioSnapshot,
  StockPortfolioSummary,
  StockPortfolioWeight,
} from "@/lib/shared/types";

/** 本地持久化文件；数据库不可用时保证重启后仍保留。 */
const PORTFOLIO_FILE = path.join(process.cwd(), ".data", "stock-portfolio.json");

/** 金额与收益的取值范围，超出视为脏数据直接拒绝。 */
const AMOUNT_MAX = 1e12;
const PROFIT_ABS_MAX = 1e13;

/** 明细备注长度上限，避免超长文本写库。 */
const NOTE_MAX_LENGTH = 120;

/** 保留两位小数，避免浮点误差扩散到展示层。 */
export function round2(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 100) / 100;
}

/** 解析用户提交的金额/收益数值；非法输入返回 null。 */
export function parseMoney(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/,/g, "");
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** 明细备注归一化：去空白，空串转为 null，超长截断。 */
function normalizeNote(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, NOTE_MAX_LENGTH) : null;
}

/** 校验新增持仓入参。 */
export function validateHoldingInput(
  input: StockHoldingInput,
): { value: { code: string; amount: number; profit: number; note: string | null } } | { error: string } {
  const code = typeof input?.code === "string" ? normalizeStockCode(input.code) : null;
  if (!code) {
    return { error: "请输入合法的沪深北 A 股 6 位代码。" };
  }

  const amount = parseMoney(input.amount);
  if (amount === null || amount <= 0) {
    return { error: "投入金额必须是大于 0 的数字。" };
  }
  if (amount > AMOUNT_MAX) {
    return { error: "投入金额过大，请确认输入是否正确。" };
  }

  const profit = input.profit === undefined || input.profit === null ? 0 : parseMoney(input.profit);
  if (profit === null) {
    return { error: "当前持仓收益必须是数字，可以为负。" };
  }
  if (Math.abs(profit) > PROFIT_ABS_MAX) {
    return { error: "当前持仓收益过大，请确认输入是否正确。" };
  }

  return { value: { code, amount: round2(amount), profit: round2(profit), note: normalizeNote(input.note) } };
}

/** 校验更新持仓入参；只允许调整金额、收益与备注。 */
export function validateHoldingUpdate(
  input: StockHoldingUpdateInput,
): { value: { amount?: number; profit?: number; note?: string | null } } | { error: string } {
  const value: { amount?: number; profit?: number; note?: string | null } = {};

  if (input.amount !== undefined) {
    const amount = parseMoney(input.amount);
    if (amount === null || amount <= 0) {
      return { error: "投入金额必须是大于 0 的数字。" };
    }
    if (amount > AMOUNT_MAX) {
      return { error: "投入金额过大，请确认输入是否正确。" };
    }
    value.amount = round2(amount);
  }

  if (input.profit !== undefined) {
    const profit = parseMoney(input.profit);
    if (profit === null) {
      return { error: "当前持仓收益必须是数字，可以为负。" };
    }
    if (Math.abs(profit) > PROFIT_ABS_MAX) {
      return { error: "当前持仓收益过大，请确认输入是否正确。" };
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

/** 构建可持久化的持仓记录。 */
export function buildHolding(
  input: { code: string; amount: number; profit: number; note: string | null },
  name?: string | null,
): StockHolding {
  const now = new Date().toISOString();
  const fallbackName = resolveStock(input.code).name;
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

/** 按最新行情估算当日盈亏：从市值与当日涨跌幅反推昨收市值。 */
function estimateDayProfit(marketValue: number, changePct: number | null): number | null {
  if (changePct === null || !Number.isFinite(changePct)) {
    return null;
  }
  const factor = 1 + changePct / 100;
  // 涨跌幅异常（跌超 99%）时不反推，避免放大成不可信的数字。
  if (factor <= 0.01) {
    return null;
  }
  return round2(marketValue - marketValue / factor);
}

/** 把持仓与行情合成估值口径。 */
export function valueHolding(
  holding: StockHolding,
  quote: MarketQuote | null,
): StockHoldingValuation {
  const marketValue = round2(holding.amount + holding.profit);
  const profitPct = holding.amount > 0 ? round2((holding.profit / holding.amount) * 100) : null;
  const changePct = quote && Number.isFinite(quote.change_pct) ? quote.change_pct : null;

  return {
    holding,
    market_value: marketValue,
    profit_pct: profitPct,
    day_profit: estimateDayProfit(marketValue, changePct),
    price: quote?.price ?? null,
    change_pct: changePct,
    source: quote?.source ?? null,
    fetched_at: quote?.fetched_at ?? null,
    quote_available: Boolean(quote),
  };
}

/** 汇总组合：总额、权重与行业分布。 */
export function summarizePortfolio(
  valuations: StockHoldingValuation[],
  industryOf: (code: string) => string | null = () => null,
): StockPortfolioSummary {
  const totalAmount = round2(valuations.reduce((sum, item) => sum + item.holding.amount, 0));
  const totalProfit = round2(valuations.reduce((sum, item) => sum + item.holding.profit, 0));
  const totalMarketValue = round2(valuations.reduce((sum, item) => sum + item.market_value, 0));

  const dayProfits = valuations
    .map((item) => item.day_profit)
    .filter((value): value is number => value !== null);
  const dayProfit = dayProfits.length > 0 ? round2(dayProfits.reduce((sum, value) => sum + value, 0)) : null;

  const weights: StockPortfolioWeight[] = [...valuations]
    .sort((left, right) => right.market_value - left.market_value)
    .map((item) => ({
      code: item.holding.code,
      name: item.holding.name,
      market_value: item.market_value,
      weight_pct: totalMarketValue > 0 ? round2((item.market_value / totalMarketValue) * 100) : 0,
    }));

  const industryTotals = new Map<string, number>();
  for (const item of valuations) {
    const industry = industryOf(item.holding.code)?.trim() || "未分类";
    industryTotals.set(industry, (industryTotals.get(industry) ?? 0) + item.market_value);
  }
  const industryAllocation: StockPortfolioIndustry[] = Array.from(industryTotals.entries())
    .map(([industry, marketValue]) => ({
      industry,
      market_value: round2(marketValue),
      weight_pct: totalMarketValue > 0 ? round2((marketValue / totalMarketValue) * 100) : 0,
    }))
    .sort((left, right) => right.market_value - left.market_value);

  return {
    total_amount: totalAmount,
    total_profit: totalProfit,
    total_profit_pct: totalAmount > 0 ? round2((totalProfit / totalAmount) * 100) : null,
    total_market_value: totalMarketValue,
    day_profit: dayProfit,
    holdings_count: valuations.length,
    weights,
    industry_allocation: industryAllocation,
    generated_at: new Date().toISOString(),
  };
}

/** 组装接口返回的组合快照。 */
export function buildPortfolioSnapshot(
  valuations: StockHoldingValuation[],
  sourceNote = "行情来源为本地行情侧车（腾讯 / AkShare），取不到时该条目仅展示手工录入口径。",
): StockPortfolioSnapshot {
  return {
    summary: summarizePortfolio(valuations, (code) => resolveStock(code).industry ?? null),
    holdings: valuations,
    source_note: sourceNote,
  };
}

/**
 * 批量估值：逐条取最新行情，单条取不到时降级为「仅手工口径」，
 * 不让一只票的行情异常拖垮整个组合面板。
 */
export async function valueHoldings(holdings: StockHolding[]): Promise<StockHoldingValuation[]> {
  return Promise.all(
    holdings.map(async (holding) => {
      try {
        const quote = await getMarketQuote(holding.code);
        // 确定性降级数据不参与估值，避免把演示价格当成真实市值展示。
        return valueHolding(
          holding,
          quote.source === "deterministic-fallback" ? null : quote,
        );
      } catch {
        return valueHolding(holding, null);
      }
    }),
  );
}

/** 持仓仓储接口。 */
export interface StockPortfolioRepository {
  list(): Promise<StockHolding[]>;
  getById(id: string): Promise<StockHolding | null>;
  getByCode(code: string): Promise<StockHolding | null>;
  add(holding: StockHolding): Promise<void>;
  update(
    id: string,
    patch: { amount?: number; profit?: number; note?: string | null },
  ): Promise<void>;
  remove(id: string): Promise<void>;
}

/** 将数据库行转换为共享模型（numeric 列以字符串返回，需要显式转数字）。 */
function mapRow(row: typeof schema.stockHoldings.$inferSelect): StockHolding {
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
function isHolding(value: unknown): value is StockHolding {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<StockHolding>;
  return (
    typeof item.id === "string" &&
    typeof item.code === "string" &&
    typeof item.name === "string"
  );
}

/** 从本地 JSON 文件读取持仓；文件不存在或损坏时返回空列表。 */
async function loadPortfolioFile(): Promise<StockHolding[]> {
  try {
    const content = await readFile(PORTFOLIO_FILE, "utf8");
    const parsed = JSON.parse(content) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isHolding);
  } catch {
    return [];
  }
}

/** 将持仓列表写入本地 JSON 文件。 */
async function savePortfolioFile(items: StockHolding[]): Promise<void> {
  await mkdir(path.dirname(PORTFOLIO_FILE), { recursive: true });
  await writeFile(PORTFOLIO_FILE, JSON.stringify(items, null, 2), "utf8");
}

/** 文件持久化持仓仓储。 */
function createFileStockPortfolioRepository(): StockPortfolioRepository {
  const items = new Map<string, StockHolding>();
  let loaded = false;

  const ensureLoaded = async () => {
    if (loaded) {
      return;
    }
    for (const item of await loadPortfolioFile()) {
      items.set(item.id, clone(item));
    }
    loaded = true;
  };

  const persist = async () => {
    const rows = Array.from(items.values())
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((item) => clone(item));
    await savePortfolioFile(rows);
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
    async add(holding) {
      await ensureLoaded();
      items.set(holding.id, clone(holding));
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
function createDrizzleStockPortfolioRepository(): StockPortfolioRepository {
  const db = getDb();

  return {
    async list() {
      const rows = await db
        .select()
        .from(schema.stockHoldings)
        .orderBy(asc(schema.stockHoldings.createdAt));
      return rows.map(mapRow);
    },
    async getById(id) {
      const rows = await db
        .select()
        .from(schema.stockHoldings)
        .where(eq(schema.stockHoldings.id, id))
        .limit(1);
      const row = rows[0];
      return row ? mapRow(row) : null;
    },
    async getByCode(code) {
      const rows = await db
        .select()
        .from(schema.stockHoldings)
        .where(eq(schema.stockHoldings.code, code))
        .limit(1);
      const row = rows[0];
      return row ? mapRow(row) : null;
    },
    async add(holding) {
      await db.insert(schema.stockHoldings).values({
        id: holding.id,
        code: holding.code,
        name: holding.name,
        amount: holding.amount.toFixed(2),
        profit: holding.profit.toFixed(2),
        note: holding.note,
        createdAt: new Date(holding.created_at),
        updatedAt: new Date(holding.updated_at),
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
      await db.update(schema.stockHoldings).set(values).where(eq(schema.stockHoldings.id, id));
    },
    async remove(id) {
      await db.delete(schema.stockHoldings).where(eq(schema.stockHoldings.id, id));
    },
  };
}

/** 带故障回退的持仓仓储：数据库不可用时自动切换本地文件实现。 */
function createResilientStockPortfolioRepository(): StockPortfolioRepository {
  const fallback = createFileStockPortfolioRepository();
  let drizzleRepository: StockPortfolioRepository | null = null;
  let useFallback = false;

  const run = async <T>(method: keyof StockPortfolioRepository, args: unknown[]): Promise<T> => {
    if (useFallback) {
      return (fallback[method] as (...methodArgs: unknown[]) => Promise<T>)(...args);
    }
    try {
      drizzleRepository ??= createDrizzleStockPortfolioRepository();
      return await (drizzleRepository[method] as (...methodArgs: unknown[]) => Promise<T>)(...args);
    } catch (error) {
      useFallback = true;
      console.warn("[stock-portfolio] PostgreSQL 访问失败，本次运行已切换为本地文件存储：", error);
      return (fallback[method] as (...methodArgs: unknown[]) => Promise<T>)(...args);
    }
  };

  return {
    list: () => run("list", []),
    getById: (id) => run("getById", [id]),
    getByCode: (code) => run("getByCode", [code]),
    add: (holding) => run("add", [holding]),
    update: (id, patch) => run("update", [id, patch]),
    remove: (id) => run("remove", [id]),
  };
}

/** 默认持仓仓储单例，供 API 路由统一使用。 */
export const stockPortfolioRepository: StockPortfolioRepository =
  createResilientStockPortfolioRepository();