// 基金基础数据持久化仓库：优先 PostgreSQL，数据库不可用时回退内存。
import { and, asc, desc, eq, sql } from "drizzle-orm";

import { getDb, hasRealDatabaseUrl, schema } from "@/lib/db";
import type {
  FundHoldings,
  FundNavPoint,
  FundProfile,
  FundRiskMetrics,
} from "@/lib/shared/types";

interface FundProfileRepository {
  getByCode(code: string): Promise<FundProfile | null>;
  upsert(profile: FundProfile): Promise<void>;
}

interface FundNavRepository {
  list(code: string): Promise<FundNavPoint[]>;
  insertMany(nav: FundNavPoint[]): Promise<void>;
}

interface FundHoldingsRepository {
  getLatest(code: string): Promise<FundHoldings | null>;
  upsert(holdings: FundHoldings): Promise<void>;
}

interface FundRiskMetricsRepository {
  getByRange(code: string, range: string): Promise<FundRiskMetrics | null>;
  upsert(metrics: FundRiskMetrics): Promise<void>;
}

interface FundDataStore {
  profiles: FundProfileRepository;
  navs: FundNavRepository;
  holdings: FundHoldingsRepository;
  metrics: FundRiskMetricsRepository;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function toDate(value: string): Date {
  return new Date(value);
}

function navDateToDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function mapFundProfile(row: typeof schema.fundProfiles.$inferSelect): FundProfile {
  return {
    code: row.code,
    name: row.name,
    type: row.type as FundProfile["type"],
    trading_mode: row.tradingMode as FundProfile["trading_mode"],
    manager: row.manager,
    company: row.company,
    benchmark: row.benchmark,
    establish_date: row.establishDate,
    scale: row.scale,
    risk_level: row.riskLevel,
    source: row.source,
    fetched_at: row.fetchedAt.toISOString(),
  };
}

function mapFundNav(row: typeof schema.fundNavs.$inferSelect): FundNavPoint {
  return {
    code: row.code,
    nav_date: row.navDate.toISOString().slice(0, 10),
    unit_nav: row.unitNav,
    cumulative_nav: row.cumulativeNav,
    daily_change_pct: row.dailyChangePct,
    source: row.source,
    fetched_at: row.fetchedAt.toISOString(),
  };
}

function mapFundHoldings(row: typeof schema.fundHoldings.$inferSelect): FundHoldings {
  return {
    code: row.code,
    report_date: row.reportDate,
    published_at: row.publishedAt?.toISOString() ?? null,
    top_holdings: row.topHoldings ?? [],
    asset_allocation: row.assetAllocation ?? {},
    industry_allocation: row.industryAllocation ?? {},
    top10_weight_pct: row.top10WeightPct,
    top1_weight_pct: row.top1WeightPct,
    source: row.source,
    fetched_at: row.fetchedAt.toISOString(),
  };
}

function mapFundMetrics(row: typeof schema.fundRiskMetrics.$inferSelect): FundRiskMetrics {
  return {
    code: row.code,
    range: row.range,
    start_date: row.startDate,
    end_date: row.endDate,
    max_drawdown_pct: row.maxDrawdownPct,
    max_drawdown_start: row.maxDrawdownStart,
    max_drawdown_end: row.maxDrawdownEnd,
    current_drawdown_pct: row.currentDrawdownPct,
    max_drawdown_recovery_start: row.maxDrawdownRecoveryStart,
    max_drawdown_recovery_end: row.maxDrawdownRecoveryEnd,
    max_drawdown_recovery_complete: row.maxDrawdownRecoveryComplete,
    longest_recovery_days: row.longestRecoveryDays,
    average_recovery_days: row.averageRecoveryDays,
    current_recovery_progress_pct: row.currentRecoveryProgressPct,
    annualized_return_pct: row.annualizedReturnPct,
    annualized_volatility_pct: row.annualizedVolatilityPct,
    sharpe: row.sharpe,
    sortino: row.sortino,
    calmar: row.calmar,
    updated_at: row.updatedAt.toISOString(),
  };
}

function createMemoryFundDataStore(): FundDataStore {
  const profiles = new Map<string, FundProfile>();
  const navs = new Map<string, FundNavPoint[]>();
  const holdings = new Map<string, FundHoldings>();
  const metrics = new Map<string, FundRiskMetrics>();

  return {
    profiles: {
      async getByCode(code) {
        const item = profiles.get(code);
        return item ? clone(item) : null;
      },
      async upsert(profile) {
        profiles.set(profile.code, clone(profile));
      },
    },
    navs: {
      async list(code) {
        const items = navs.get(code) ?? [];
        return items
          .slice()
          .sort((left, right) => left.nav_date.localeCompare(right.nav_date))
          .map((item) => clone(item));
      },
      async insertMany(items) {
        for (const item of items) {
          const list = navs.get(item.code) ?? [];
          list.push(clone(item));
          navs.set(item.code, list);
        }
      },
    },
    holdings: {
      async getLatest(code) {
        const items = Array.from(holdings.values()).filter((item) => item.code === code);
        items.sort((left, right) => right.fetched_at.localeCompare(left.fetched_at));
        return items[0] ? clone(items[0]) : null;
      },
      async upsert(item) {
        holdings.set(`${item.code}:${item.report_date}`, clone(item));
      },
    },
    metrics: {
      async getByRange(code, range) {
        const item = metrics.get(`${code}:${range}`);
        return item ? clone(item) : null;
      },
      async upsert(item) {
        metrics.set(`${item.code}:${item.range}`, clone(item));
      },
    },
  };
}

function createDrizzleFundDataStore(): FundDataStore {
  const db = getDb();

  return {
    profiles: {
      async getByCode(code) {
        const rows = await db
          .select()
          .from(schema.fundProfiles)
          .where(eq(schema.fundProfiles.code, code))
          .limit(1);
        return rows[0] ? mapFundProfile(rows[0]) : null;
      },
      async upsert(profile) {
        await db
          .insert(schema.fundProfiles)
          .values({
            code: profile.code,
            name: profile.name,
            type: profile.type,
            tradingMode: profile.trading_mode,
            manager: profile.manager,
            company: profile.company,
            benchmark: profile.benchmark,
            establishDate: profile.establish_date,
            scale: profile.scale,
            riskLevel: profile.risk_level,
            source: profile.source,
            fetchedAt: toDate(profile.fetched_at),
          })
          .onConflictDoUpdate({
            target: schema.fundProfiles.code,
            set: {
              name: profile.name,
              type: profile.type,
              tradingMode: profile.trading_mode,
              manager: profile.manager,
              company: profile.company,
              benchmark: profile.benchmark,
              establishDate: profile.establish_date,
              scale: profile.scale,
              riskLevel: profile.risk_level,
              source: profile.source,
              fetchedAt: toDate(profile.fetched_at),
            },
          });
      },
    },
    navs: {
      async list(code) {
        const rows = await db
          .select()
          .from(schema.fundNavs)
          .where(eq(schema.fundNavs.code, code))
          .orderBy(asc(schema.fundNavs.navDate));
        return rows.map(mapFundNav);
      },
      async insertMany(items) {
        if (items.length === 0) {
          return;
        }
        await db
          .insert(schema.fundNavs)
          .values(
            items.map((item) => ({
              code: item.code,
              navDate: navDateToDate(item.nav_date),
              unitNav: item.unit_nav,
              cumulativeNav: item.cumulative_nav,
              dailyChangePct: item.daily_change_pct,
              source: item.source,
              fetchedAt: toDate(item.fetched_at),
            })),
          )
          .onConflictDoUpdate({
            target: [schema.fundNavs.code, schema.fundNavs.navDate],
            set: {
              unitNav: sql`excluded.unit_nav`,
              cumulativeNav: sql`excluded.cumulative_nav`,
              dailyChangePct: sql`excluded.daily_change_pct`,
              source: sql`excluded.source`,
              fetchedAt: sql`excluded.fetched_at`,
            },
          });
      },
    },
    holdings: {
      async getLatest(code) {
        const rows = await db
          .select()
          .from(schema.fundHoldings)
          .where(eq(schema.fundHoldings.code, code))
          .orderBy(desc(schema.fundHoldings.fetchedAt))
          .limit(1);
        return rows[0] ? mapFundHoldings(rows[0]) : null;
      },
      async upsert(item) {
        await db
          .insert(schema.fundHoldings)
          .values({
            code: item.code,
            reportDate: item.report_date,
            publishedAt: item.published_at ? toDate(item.published_at) : null,
            topHoldings: item.top_holdings,
            assetAllocation: item.asset_allocation,
            industryAllocation: item.industry_allocation,
            top10WeightPct: item.top10_weight_pct,
            top1WeightPct: item.top1_weight_pct,
            source: item.source,
            fetchedAt: toDate(item.fetched_at),
          })
          .onConflictDoUpdate({
            target: [schema.fundHoldings.code, schema.fundHoldings.reportDate],
            set: {
              publishedAt: item.published_at ? toDate(item.published_at) : null,
              topHoldings: item.top_holdings,
              assetAllocation: item.asset_allocation,
              industryAllocation: item.industry_allocation,
              top10WeightPct: item.top10_weight_pct,
              top1WeightPct: item.top1_weight_pct,
              source: item.source,
              fetchedAt: toDate(item.fetched_at),
            },
          });
      },
    },
    metrics: {
      async getByRange(code, range) {
        const rows = await db
          .select()
          .from(schema.fundRiskMetrics)
          .where(and(eq(schema.fundRiskMetrics.code, code), eq(schema.fundRiskMetrics.range, range)))
          .limit(1);
        return rows[0] ? mapFundMetrics(rows[0]) : null;
      },
      async upsert(item) {
        await db
          .insert(schema.fundRiskMetrics)
          .values({
            code: item.code,
            range: item.range,
            startDate: item.start_date,
            endDate: item.end_date,
            maxDrawdownPct: item.max_drawdown_pct,
            maxDrawdownStart: item.max_drawdown_start,
            maxDrawdownEnd: item.max_drawdown_end,
            currentDrawdownPct: item.current_drawdown_pct,
            maxDrawdownRecoveryStart: item.max_drawdown_recovery_start,
            maxDrawdownRecoveryEnd: item.max_drawdown_recovery_end,
            maxDrawdownRecoveryComplete: item.max_drawdown_recovery_complete,
            longestRecoveryDays: item.longest_recovery_days,
            averageRecoveryDays: item.average_recovery_days,
            currentRecoveryProgressPct: item.current_recovery_progress_pct,
            annualizedReturnPct: item.annualized_return_pct,
            annualizedVolatilityPct: item.annualized_volatility_pct,
            sharpe: item.sharpe,
            sortino: item.sortino,
            calmar: item.calmar,
            updatedAt: toDate(item.updated_at),
          })
          .onConflictDoUpdate({
            target: [schema.fundRiskMetrics.code, schema.fundRiskMetrics.range],
            set: {
              startDate: item.start_date,
              endDate: item.end_date,
              maxDrawdownPct: item.max_drawdown_pct,
              maxDrawdownStart: item.max_drawdown_start,
              maxDrawdownEnd: item.max_drawdown_end,
              currentDrawdownPct: item.current_drawdown_pct,
              maxDrawdownRecoveryStart: item.max_drawdown_recovery_start,
              maxDrawdownRecoveryEnd: item.max_drawdown_recovery_end,
              maxDrawdownRecoveryComplete: item.max_drawdown_recovery_complete,
              longestRecoveryDays: item.longest_recovery_days,
              averageRecoveryDays: item.average_recovery_days,
              currentRecoveryProgressPct: item.current_recovery_progress_pct,
              annualizedReturnPct: item.annualized_return_pct,
              annualizedVolatilityPct: item.annualized_volatility_pct,
              sharpe: item.sharpe,
              sortino: item.sortino,
              calmar: item.calmar,
              updatedAt: toDate(item.updated_at),
            },
          });
      },
    },
  };
}

function createRepositoryWithFallback<T extends object>(
  memoryRepository: T,
  getPersistedRepository: () => T,
  fallbackState: { enabled: boolean },
): T {
  const handler: ProxyHandler<T> = {
    get(_target, property, receiver) {
      const memoryValue = Reflect.get(memoryRepository, property, receiver);
      if (typeof memoryValue !== "function") {
        return memoryValue;
      }

      return async (...args: unknown[]) => {
        if (fallbackState.enabled) {
          return Reflect.apply(memoryValue, memoryRepository, args);
        }
        try {
          const persistedRepository = getPersistedRepository();
          const persistedValue = Reflect.get(persistedRepository, property, receiver);
          return await Reflect.apply(
            persistedValue as (...persistedArgs: unknown[]) => Promise<unknown>,
            persistedRepository,
            args,
          );
        } catch (error) {
          fallbackState.enabled = true;
          console.warn("[fund-data-store] PostgreSQL 访问失败，本次运行已切换为内存存储：", error);
          return Reflect.apply(memoryValue, memoryRepository, args);
        }
      };
    },
  };

  return new Proxy(memoryRepository, handler) as T;
}

function createResilientFundDataStore(): FundDataStore {
  const memory = createMemoryFundDataStore();
  const fallbackState = { enabled: false };
  let drizzleStore: FundDataStore | null = null;
  const getPersisted = () => {
    drizzleStore ??= createDrizzleFundDataStore();
    return drizzleStore;
  };

  return {
    profiles: createRepositoryWithFallback(memory.profiles, () => getPersisted().profiles, fallbackState),
    navs: createRepositoryWithFallback(memory.navs, () => getPersisted().navs, fallbackState),
    holdings: createRepositoryWithFallback(memory.holdings, () => getPersisted().holdings, fallbackState),
    metrics: createRepositoryWithFallback(memory.metrics, () => getPersisted().metrics, fallbackState),
  };
}

/** 默认基金基础数据仓库。 */
export const fundDataStore: FundDataStore = hasRealDatabaseUrl()
  ? createResilientFundDataStore()
  : createMemoryFundDataStore();
