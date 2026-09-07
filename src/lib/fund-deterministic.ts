// 基金确定性降级数据生成器：在外部数据源不可用时提供稳定的演示数据。

import { resolveFundProfile } from "@/lib/fund-market";
import type { FundNavPoint, FundProfile } from "@/lib/shared/types";

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
