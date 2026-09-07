// 基金确定性降级数据生成器：在外部数据源不可用时提供稳定的演示数据。

import {
  classifyFundTradingMode,
  classifyFundType,
  resolveFundProfile,
} from "@/lib/fund-market";
import type {
  FundHoldings,
  FundIntraday,
  FundNavPoint,
  FundProfile,
} from "@/lib/shared/types";

/** 将字符串转为 32 位无符号整数种子。 */
function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** 简单可复现伪随机数生成器。 */
function mulberry32(seed: number): () => number {
  let value = seed;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

/** 生成确定性基金档案。 */
export function buildDeterministicFundProfile(code: string): FundProfile {
  return resolveFundProfile(code, "deterministic-fallback");
}

/** 生成确定性历史净值，字段结构与真实侧车保持一致。 */
export function buildDeterministicFundNav(
  code: string,
  startDate?: string,
  endDate?: string,
  limit = 365,
): FundNavPoint[] {
  const seed = hashSeed(`fund:nav:${code}`);
  const random = mulberry32(seed);
  const baseNav = 1 + random() * 4;
  const drift = (random() - 0.42) * 0.0006;
  const end = endDate ? new Date(`${endDate}T00:00:00Z`) : new Date();
  const start = startDate
    ? new Date(`${startDate}T00:00:00Z`)
    : addDays(end, -(limit - 1));

  const points: FundNavPoint[] = [];
  let cursor = new Date(start);
  let unitNav = round(baseNav * 0.88, 4);
  let cumulativeNav = unitNav;
  let previousNav = unitNav;
  const fetchedAt = new Date().toISOString();

  while (cursor <= end && points.length < Math.max(limit, 366 * 3)) {
    if (cursor.getDay() !== 0 && cursor.getDay() !== 6) {
      const wave = (random() - 0.5) * 0.018;
      const dailyReturn = drift + wave;
      previousNav = unitNav;
      unitNav = round(Math.max(0.5, unitNav * (1 + dailyReturn)), 4);
      cumulativeNav = round(Math.max(0.5, cumulativeNav * (1 + dailyReturn)), 4);
      points.push({
        code,
        nav_date: toDateOnly(cursor),
        unit_nav: unitNav,
        cumulative_nav: cumulativeNav,
        daily_change_pct:
          previousNav > 0 ? round((unitNav / previousNav - 1) * 100, 2) : null,
        source: "deterministic-fallback",
        fetched_at: fetchedAt,
      });
    }
    cursor = addDays(cursor, 1);
  }

  return points.slice(-limit);
}

/** 生成确定性当日行情或盘中估算。 */
export function buildDeterministicFundIntraday(code: string): FundIntraday {
  const type = classifyFundType(code);
  const tradingMode = classifyFundTradingMode(code, type);
  const random = mulberry32(hashSeed(`fund:intraday:${code}`));
  const now = new Date().toISOString();
  const fetchedAt = now;

  if (tradingMode === "exchange") {
    const price = round(0.8 + random() * 4.5, 4);
    const changePct = round((random() - 0.48) * 2.6, 2);
    const previousClose = price / (1 + changePct / 100);
    const open = round(previousClose * (1 + (random() - 0.5) * 0.012), 4);
    const high = round(Math.max(price, open, previousClose) * (1 + random() * 0.008), 4);
    const low = round(Math.min(price, open, previousClose) * (1 - random() * 0.008), 4);
    const iopv = round(price * (1 + (random() - 0.5) * 0.004), 4);
    return {
      code,
      mode: "realtime",
      ts: now,
      price,
      estimated_nav: iopv,
      change_pct: changePct,
      open,
      high,
      low,
      volume: Math.floor(random() * 8_000_000),
      amount: Math.floor(random() * 3_000_000_000),
      iopv,
      premium_rate: iopv ? round((price / iopv - 1) * 100, 2) : null,
      official_nav: null,
      official_nav_date: null,
      source: "deterministic-fallback",
      fetched_at: fetchedAt,
    };
  }

  const estimatedNav = round(1 + random() * 3.2, 4);
  const changePct = round((random() - 0.48) * 2.2, 2);
  return {
    code,
    mode: "estimate",
    ts: now,
    price: null,
    estimated_nav: estimatedNav,
    change_pct: changePct,
    open: null,
    high: null,
    low: null,
    volume: null,
    amount: null,
    iopv: null,
    premium_rate: null,
    official_nav: round(estimatedNav / (1 + changePct / 100), 4),
    official_nav_date: null,
    source: "deterministic-fallback",
    fetched_at: fetchedAt,
  };
}

/** 生成确定性最新季度持仓。 */
export function buildDeterministicFundHoldings(code: string): FundHoldings {
  const random = mulberry32(hashSeed(`fund:holdings:${code}`));
  const nowDate = new Date();
  const quarterStartMonth = Math.floor(nowDate.getUTCMonth() / 3) * 3;
  const reportDate = new Date(
    Date.UTC(nowDate.getUTCFullYear(), quarterStartMonth, 0),
  )
    .toISOString()
    .slice(0, 10);

  const names = [
    "示例重仓资产一",
    "示例重仓资产二",
    "示例重仓资产三",
    "示例重仓资产四",
    "示例重仓资产五",
    "示例重仓资产六",
    "示例重仓资产七",
    "示例重仓资产八",
    "示例重仓资产九",
    "示例重仓资产十",
  ];
  const rawWeights = names.map(() => 1 + random() * 5);
  const total = rawWeights.reduce((sum, value) => sum + value, 0) || 1;
  const weighted = names
    .map((name, index) => ({ name, weight: round((rawWeights[index] / total) * 58, 2) }))
    .sort((left, right) => right.weight - left.weight);
  const topHoldings = weighted.map((item) => ({
    code: null,
    name: item.name,
    weight_pct: item.weight,
    change_pct: null,
    industry: null,
  }));
  const weights = weighted.map((item) => item.weight);
  const now = new Date().toISOString();

  return {
    code,
    report_date: reportDate,
    published_at: null,
    top_holdings: topHoldings,
    asset_allocation: {},
    industry_allocation: {},
    top10_weight_pct: round(weights.reduce((sum, value) => sum + value, 0), 2),
    top1_weight_pct: weights.length > 0 ? round(Math.max(...weights), 2) : null,
    source: "deterministic-fallback",
    fetched_at: now,
  };
}
