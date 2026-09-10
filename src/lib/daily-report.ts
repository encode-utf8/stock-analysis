// AI 收盘日报：数据采集、就绪判定、Prompt 生成与模板降级。
// 触发采用探测式：数据源就绪后立即生成，当天每类日报只生成一次。

import { deepSeekBaseUrl, deepSeekConfigured, deepSeekModel } from "@/lib/analysis";
import { recordExternalCall } from "@/lib/observability";
import { dailyReportExists, saveDailyReport } from "@/lib/daily-report-store";
import {
  fetchIndexKlineFromSidecar,
  fetchIndexQuotesFromSidecar,
  fetchMarketBreadthFromSidecar,
  fetchMarketSectorsFromSidecar,
} from "@/lib/data-service";
import { getFundNav } from "@/lib/fund-data";
import { getFundIndustryNews } from "@/lib/fund-news";
import { getFundIntraday } from "@/lib/fund-intraday";
import { SAMPLE_FUND_CODES, resolveFundProfile } from "@/lib/fund-market";
import { fundWatchlistRepository } from "@/lib/fund-watchlist";
import { getKlines, getMarketQuote } from "@/lib/market-data";
import { SAMPLE_CODES, resolveStock } from "@/lib/market";
import { getNews } from "@/lib/news";
import { beijingDateKey, getTradingCalendar } from "@/lib/trading-calendar";
import { watchlistRepository } from "@/lib/watchlist";
import type {
  DailyReport,
  DailyReportData,
  DailyReportHolding,
  DailyReportJobResult,
  DailyReportKind,
  DailyReportMetric,
  DailyReportNewsRef,
  DailyReportTone,
  IndexQuoteSnapshot,
  Kline,
  NewsItem,
} from "@/lib/shared/types";

/** 日报固定跟踪的三大指数（均在侧车白名单内）。 */
export const DAILY_REPORT_INDEX_CODES = ["sh000001", "sz399001", "sz399006"] as const;

/** 日报类型名称，用于标题与面板展示。 */
export const DAILY_REPORT_KIND_LABELS: Record<DailyReportKind, string> = {
  stock: "AI 股市日报",
  fund: "AI 基金日报",
};

/** 自选池为空时的兜底标的，保证日报始终有内容。 */
export const FALLBACK_STOCK_CODES: readonly string[] = SAMPLE_CODES.slice(0, 3);
export const FALLBACK_FUND_CODES: readonly string[] = SAMPLE_FUND_CODES.slice(0, 3);

/** 日报引用的资讯条数上限。 */
const MAX_NEWS_ITEMS = 5;
/** 参与资讯聚合的自选标的数量上限，避免逐只抓取导致耗时过长。 */
const MAX_NEWS_CODES = 3;
/** 单个日报最多纳入的自选标的数量，控制采集耗时。 */
const MAX_HOLDINGS = 10;
/** 生成日报时的模型超时。 */
const REPORT_TIMEOUT_MS = Number(process.env.DAILY_REPORT_TIMEOUT_MS ?? 60_000);
/** A 股收盘时间（北京时间 15:00）对应的分钟数。 */
const CHINA_CLOSE_MINUTE = 15 * 60;

/** 北京时间的日期键与分钟数，避免依赖服务器时区。 */
export function beijingClock(now: Date = new Date()): { date: string; minutes: number } {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return {
    date: shifted.toISOString().slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** 是否已过当日 A 股收盘时间（北京时间 15:00）。 */
export function isAfterChinaClose(now: Date = new Date()): boolean {
  return beijingClock(now).minutes >= CHINA_CLOSE_MINUTE;
}

/** 归一化涨跌色调，供面板着色。 */
export function toneOf(changePct: number | null): DailyReportTone {
  if (changePct === null || !Number.isFinite(changePct) || changePct === 0) {
    return "flat";
  }
  return changePct > 0 ? "up" : "down";
}

/** 格式化带符号百分比。 */
export function formatChangePct(changePct: number | null): string {
  if (changePct === null || !Number.isFinite(changePct)) {
    return "—";
  }
  const sign = changePct > 0 ? "+" : "";
  return `${sign}${changePct.toFixed(2)}%`;
}

/** 汇总涨跌：平均涨跌幅与上涨/下跌数量。 */
export function summarizeChanges(values: (number | null)[]): {
  average: number | null;
  up: number;
  down: number;
} {
  const valid = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  if (valid.length === 0) {
    return { average: null, up: 0, down: 0 };
  }
  const sum = valid.reduce((total, value) => total + value, 0);
  return {
    average: Number((sum / valid.length).toFixed(2)),
    up: valid.filter((value) => value > 0).length,
    down: valid.filter((value) => value < 0).length,
  };
}

/** 采集大盘指数：当天取实时快照，历史日期取指数日线收盘与前收。 */
async function collectIndices(
  date: string,
  isToday: boolean,
): Promise<{ indices: IndexQuoteSnapshot[]; missing: string[] }> {
  if (isToday) {
    const quotes = await fetchIndexQuotesFromSidecar([...DAILY_REPORT_INDEX_CODES]);
    return {
      indices: quotes,
      missing: quotes.length > 0 ? [] : ["大盘指数（行情侧车暂不可用）"],
    };
  }

  const series = await Promise.all(
    DAILY_REPORT_INDEX_CODES.map((code) => fetchIndexKlineFromSidecar(code, 60)),
  );
  const indices: IndexQuoteSnapshot[] = [];
  for (const item of series) {
    if (!item) {
      continue;
    }
    const position = item.days.findIndex((day) => day.date === date);
    if (position <= 0) {
      continue;
    }
    const current = item.days[position];
    const previous = item.days[position - 1];
    if (!previous || previous.close <= 0) {
      continue;
    }
    const change = current.close - previous.close;
    indices.push({
      code: item.code,
      name: item.name,
      price: current.close,
      change: Number(change.toFixed(2)),
      change_pct: Number(((change / previous.close) * 100).toFixed(2)),
      amount: 0,
      source: item.source,
      fetched_at: item.fetched_at,
    });
  }

  return {
    indices,
    missing: indices.length > 0 ? [] : [`大盘指数（${date} 超出指数日线覆盖范围）`],
  };
}

/** 从 K 线中取某个日期的收盘涨跌（需要前一交易日收盘价）。 */
export function changeFromKlines(
  klines: Kline[],
  date: string,
): { price: number; changePct: number | null } | null {
  const position = klines.findIndex((item) => item.ts.slice(0, 10) === date);
  if (position < 0) {
    return null;
  }
  const current = klines[position];
  const previous = position > 0 ? klines[position - 1] : null;
  if (!previous || previous.close <= 0) {
    return { price: current.close, changePct: null };
  }
  return {
    price: current.close,
    changePct: Number((((current.close - previous.close) / previous.close) * 100).toFixed(2)),
  };
}

/** 采集自选股表现：当天取行情快照，历史日期取日线。 */
async function collectStockHoldings(
  date: string,
  isToday: boolean,
): Promise<DailyReportHolding[]> {
  const items = await watchlistRepository.list();
  const targets =
    items.length > 0
      ? items.slice(0, MAX_HOLDINGS).map((item) => ({
          code: item.code,
          name: item.name,
          note: item.note,
        }))
      : FALLBACK_STOCK_CODES.map((code) => ({
          code,
          name: resolveStock(code).name,
          note: null,
        }));

  const holdings = await Promise.all(
    targets.map(async (target): Promise<DailyReportHolding> => {
      if (isToday) {
        const quote = await getMarketQuote(target.code);
        return {
          code: target.code,
          name: target.name,
          change_pct: quote.change_pct,
          price: quote.price,
          nav_date: null,
          note: target.note,
          source: quote.source,
        };
      }
      const klines = await getKlines(target.code, "day", "qfq", 60);
      const snapshot = changeFromKlines(klines, date);
      return {
        code: target.code,
        name: target.name,
        change_pct: snapshot?.changePct ?? null,
        price: snapshot?.price ?? null,
        nav_date: null,
        note: target.note,
        source: klines[0]?.source ?? "unknown",
      };
    }),
  );

  return holdings;
}

/** 采集自选基金表现：当天取实时价/估算净值，历史日期取官方净值。 */
async function collectFundHoldings(
  date: string,
  isToday: boolean,
): Promise<DailyReportHolding[]> {
  const items = await fundWatchlistRepository.list();
  const targets =
    items.length > 0
      ? items.slice(0, MAX_HOLDINGS).map((item) => ({
          code: item.code,
          name: item.name,
          note: item.note,
        }))
      : FALLBACK_FUND_CODES.map((code) => ({
          code,
          name: resolveFundProfile(code).name,
          note: null,
        }));

  const holdings = await Promise.all(
    targets.map(async (target): Promise<DailyReportHolding> => {
      if (isToday) {
        const intraday = await getFundIntraday(target.code);
        return {
          code: target.code,
          name: target.name,
          change_pct: intraday.change_pct,
          price: intraday.price ?? intraday.estimated_nav,
          nav_date: intraday.official_nav_date,
          note: target.note,
          source: intraday.source,
        };
      }

      const navPoints = await getFundNav(target.code, "1y", "unit");
      const position = navPoints.findIndex((point) => point.nav_date === date);
      if (position < 0) {
        return {
          code: target.code,
          name: target.name,
          change_pct: null,
          price: null,
          nav_date: null,
          note: target.note,
          source: navPoints[0]?.source ?? "unknown",
        };
      }
      const current = navPoints[position];
      const previous = position > 0 ? navPoints[position - 1] : null;
      const changePct =
        current.daily_change_pct ??
        (previous && previous.unit_nav > 0
          ? Number((((current.unit_nav - previous.unit_nav) / previous.unit_nav) * 100).toFixed(2))
          : null);
      return {
        code: target.code,
        name: target.name,
        change_pct: changePct,
        price: current.unit_nav,
        nav_date: current.nav_date,
        note: target.note,
        source: current.source,
      };
    }),
  );

  return holdings;
}

/** 把资讯条目裁剪为日报引用的精简结构。 */
function toNewsRefs(items: NewsItem[], date: string): DailyReportNewsRef[] {
  return items
    .filter((item) => item.published_at.slice(0, 10) === date)
    .sort((a, b) => (a.published_at < b.published_at ? 1 : -1))
    .slice(0, MAX_NEWS_ITEMS)
    .map((item) => ({
      title: item.title,
      source: item.source,
      url: item.url,
      published_at: item.published_at,
    }));
}

/** 采集当日资讯：股市取自选股资讯，基金取行业资讯。 */
async function collectNews(
  kind: DailyReportKind,
  date: string,
  holdingCodes: string[],
): Promise<DailyReportNewsRef[]> {
  if (kind === "fund") {
    const code = holdingCodes[0];
    if (!code) {
      return [];
    }
    try {
      const snapshot = await getFundIndustryNews(code);
      return toNewsRefs(snapshot.news, date);
    } catch {
      return [];
    }
  }

  const codes = holdingCodes.slice(0, MAX_NEWS_CODES);
  const results = await Promise.all(
    codes.map(async (code) => {
      try {
        return await getNews(code);
      } catch {
        return [] as NewsItem[];
      }
    }),
  );
  const seen = new Set<string>();
  const merged: NewsItem[] = [];
  for (const item of results.flat()) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    merged.push(item);
  }
  return toNewsRefs(merged, date);
}

/** 采集日报所需的全部数据快照；缺失项写进 missing 供正文与面板提示。 */
export async function collectDailyReportData(
  kind: DailyReportKind,
  date: string,
  now: Date = new Date(),
): Promise<DailyReportData> {
  const isToday = beijingDateKey(now) === date;
  const missing: string[] = [];

  const [{ indices, missing: indexMissing }, breadthPart, sectorPart, holdings] =
    await Promise.all([
      collectIndices(date, isToday),
      (async () => {
        if (!isToday) {
          return {
            breadth: null,
            missing: ["全市场涨跌家数（上游仅提供当日数据，历史日期不可回补）"],
          };
        }
        const breadth = await fetchMarketBreadthFromSidecar();
        return {
          breadth,
          missing: breadth ? [] : ["全市场涨跌家数（行情侧车暂不可用）"],
        };
      })(),
      (async () => {
        if (!isToday) {
          return {
            sectors: null,
            missing: ["行业板块涨跌（上游仅提供当日数据，历史日期不可回补）"],
          };
        }
        const sectors = await fetchMarketSectorsFromSidecar();
        return {
          sectors,
          missing: sectors ? [] : ["行业板块涨跌（行情侧车暂不可用）"],
        };
      })(),
      kind === "stock" ? collectStockHoldings(date, isToday) : collectFundHoldings(date, isToday),
    ]);

  missing.push(...indexMissing, ...breadthPart.missing, ...sectorPart.missing);

  // 剔除确定性降级数据，避免把演示数值写进正式日报。
  const usableHoldings = holdings.filter((item) => item.source !== "deterministic-fallback");
  const droppedCount = holdings.length - usableHoldings.length;
  if (droppedCount > 0) {
    missing.push(`自选标的降级数据 ${droppedCount} 个（未纳入日报）`);
  }

  const news = await collectNews(
    kind,
    date,
    usableHoldings.map((item) => item.code),
  );

  return {
    trade_date: date,
    indices,
    breadth: breadthPart.breadth,
    sectors: sectorPart.sectors,
    holdings: usableHoldings,
    news,
    missing,
  };
}
/** 判定数据是否已就绪：就绪即生成，避免产出半成品日报。 */
export function evaluateDailyReportReadiness(
  kind: DailyReportKind,
  date: string,
  data: DailyReportData,
  now: Date = new Date(),
): { ready: boolean; reason: string } {
  if (beijingDateKey(now) !== date) {
    // 历史日期补生成：只要采集到任何当日数据即可生成，缺失项会在正文中标注。
    const hasAny = data.indices.length > 0 || data.holdings.length > 0;
    return hasAny
      ? { ready: true, reason: "历史日期补生成" }
      : { ready: false, reason: `${date} 未采集到任何数据，无法生成日报。` };
  }

  if (kind === "stock") {
    const statDate = data.breadth?.stat_date ?? null;
    if (statDate && statDate.startsWith(date)) {
      return { ready: true, reason: "收盘涨跌家数已更新" };
    }
    if (data.indices.length === 0) {
      return { ready: false, reason: "大盘指数尚未取到，等待下一次探测。" };
    }
    if (!isAfterChinaClose(now)) {
      return { ready: false, reason: "未到 A 股收盘时间（15:00 之后生成）。" };
    }
    return { ready: true, reason: "已收盘且指数可用" };
  }

  if (data.holdings.some((item) => item.nav_date === date)) {
    return { ready: true, reason: "当日基金净值已公布" };
  }
  if (data.holdings.length === 0) {
    return { ready: false, reason: "尚未取到自选基金当日行情，等待下一次探测。" };
  }
  if (!isAfterChinaClose(now)) {
    return { ready: false, reason: "未到收盘时间，等待净值更新。" };
  }
  return { ready: true, reason: "已收盘且取到当日涨跌" };
}

/** 构造面板顶部的关键指标卡片。 */
export function buildDailyReportMetrics(
  kind: DailyReportKind,
  data: DailyReportData,
): DailyReportMetric[] {
  const metrics: DailyReportMetric[] = [];

  for (const index of data.indices.slice(0, 3)) {
    metrics.push({
      label: index.name,
      value: index.price.toFixed(2),
      change_pct: index.change_pct,
      tone: toneOf(index.change_pct),
    });
  }

  if (kind === "stock" && data.breadth) {
    const breadth = data.breadth;
    metrics.push({
      label: "涨跌家数",
      value: `${breadth.up} / ${breadth.down}`,
      change_pct: null,
      tone: breadth.up > breadth.down ? "up" : breadth.up < breadth.down ? "down" : "flat",
    });
  }

  if (data.holdings.length > 0) {
    const changes = summarizeChanges(data.holdings.map((item) => item.change_pct));
    metrics.push({
      label: kind === "stock" ? "自选股平均" : "自选基金平均",
      value: formatChangePct(changes.average),
      change_pct: changes.average,
      tone: toneOf(changes.average),
    });
    metrics.push({
      label: "上涨 / 下跌",
      value: `${changes.up} / ${changes.down}`,
      change_pct: null,
      tone: changes.up > changes.down ? "up" : changes.up < changes.down ? "down" : "flat",
    });
  }

  const leader = data.sectors?.top[0];
  const laggard = data.sectors?.bottom[0];
  if (leader) {
    metrics.push({
      label: "领涨板块",
      value: `${leader.name} ${formatChangePct(leader.change_pct)}`,
      change_pct: leader.change_pct,
      tone: toneOf(leader.change_pct),
    });
  }
  if (laggard) {
    metrics.push({
      label: "领跌板块",
      value: `${laggard.name} ${formatChangePct(laggard.change_pct)}`,
      change_pct: laggard.change_pct,
      tone: toneOf(laggard.change_pct),
    });
  }

  if (kind === "fund") {
    const ranked = data.holdings
      .filter((item) => item.change_pct !== null)
      .sort((a, b) => (b.change_pct ?? 0) - (a.change_pct ?? 0));
    const best = ranked[0];
    const worst = ranked[ranked.length - 1];
    // 只有一只基金时不区分领涨/领跌，避免口径歧义。
    if (best && ranked.length > 1) {
      metrics.push({
        label: "领涨基金",
        value: `${best.name} ${formatChangePct(best.change_pct)}`,
        change_pct: best.change_pct,
        tone: toneOf(best.change_pct),
      });
    }
    if (worst && ranked.length > 1) {
      metrics.push({
        label: "领跌基金",
        value: `${worst.name} ${formatChangePct(worst.change_pct)}`,
        change_pct: worst.change_pct,
        tone: toneOf(worst.change_pct),
      });
    }
  }

  return metrics;
}

/** 生成一句话摘要，用于列表项与面板头部。 */
export function buildDailyReportHeadline(
  kind: DailyReportKind,
  data: DailyReportData,
): string {
  const parts: string[] = [];
  const index = data.indices[0];
  if (index) {
    parts.push(`${index.name} ${index.price.toFixed(2)}（${formatChangePct(index.change_pct)}）`);
  }
  if (kind === "stock" && data.breadth) {
    parts.push(`全市场 ${data.breadth.up} 家上涨 / ${data.breadth.down} 家下跌`);
  }
  if (data.holdings.length > 0) {
    const changes = summarizeChanges(data.holdings.map((item) => item.change_pct));
    if (changes.average !== null) {
      parts.push(
        `${kind === "stock" ? "自选股" : "自选基金"}平均 ${formatChangePct(changes.average)}`,
      );
    }
  }
  const leader = data.sectors?.top[0];
  if (leader) {
    parts.push(`领涨板块 ${leader.name} ${formatChangePct(leader.change_pct)}`);
  }
  if (parts.length === 0) {
    return data.missing.length > 0
      ? `本日数据缺失：${data.missing.join("；")}`
      : "本日暂无可用数据。";
  }
  return parts.join("，");
}

/** 日报正文的固定章节；股市与基金各一套。 */
export const REPORT_SECTIONS: Record<DailyReportKind, string[]> = {
  stock: [
    "## 一、市场概况",
    "## 二、全市场涨跌结构",
    "## 三、板块表现",
    "## 四、自选池复盘",
    "## 五、明日关注",
    "## 六、风险提示",
  ],
  fund: [
    "## 一、市场背景",
    "## 二、自选基金表现",
    "## 三、结构与风格",
    "## 四、下一步观察",
    "## 五、风险提示",
  ],
};

const REPORT_SYSTEM_HEADER = [
  "你是职业投资研究者，负责为初学者撰写当日收盘日报。",
  "硬性要求：",
  "1. 必须引用给定数据中的具体数字（指数点位与涨跌幅、涨跌家数、板块涨跌幅、自选标的涨跌幅），禁止只写空泛套话。",
  "2. 只使用给定数据分析，禁止编造未提供的数据；数据缺失时必须在对应章节明确写出「本日该数据不可用」。",
  "3. 禁止出现「必涨、必跌、稳赚、包赚」等确定性收益承诺，必须给出风险提示。",
  "4. 使用中文 Markdown 输出，不要输出 JSON，也不要用代码块包裹全文。",
].join("\n");

/** 构造日报提示词：股市与基金共用同一份「只依据给定数据」约束。 */
export function buildDailyReportMessages(
  kind: DailyReportKind,
  date: string,
  data: DailyReportData,
): { system: string; user: string } {
  const label = kind === "stock" ? "股市日报" : "基金日报";
  const system = [
    REPORT_SYSTEM_HEADER,
    `本日报为${label}，必须严格按以下结构输出：`,
    REPORT_SECTIONS[kind].join("\n"),
  ].join("\n");

  const user = [
    `日报日期：${date}`,
    `日报类型：${label}`,
    `缺失数据项：${data.missing.length > 0 ? data.missing.join("；") : "无"}`,
    `数据（JSON）：${JSON.stringify(data)}`,
    "请按上述结构与硬性要求生成日报正文。",
  ].join("\n");

  return { system, user };
}

function indexBlockLines(data: DailyReportData): string[] {
  if (data.indices.length === 0) {
    return ["- 本日大盘指数数据不可用。"];
  }
  return [
    "| 指数 | 收盘 | 涨跌幅 |",
    "| --- | --- | --- |",
    ...data.indices.map(
      (index) => `| ${index.name} | ${index.price.toFixed(2)} | ${formatChangePct(index.change_pct)} |`,
    ),
  ];
}

function holdingBlockLines(kind: DailyReportKind, data: DailyReportData): string[] {
  if (data.holdings.length === 0) {
    return [kind === "stock" ? "- 自选股池为空，且未取到兜底标的行情。" : "- 自选基金池为空，且未取到兜底基金净值。"];
  }
  return data.holdings.map((item) => {
    const priceText = item.price === null ? "无最新价" : item.price.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
    const navText = item.nav_date ? `，净值日期 ${item.nav_date}` : "";
    const noteText = item.note ? `，备注：${item.note}` : "";
    return `- ${item.name}（${item.code}）：${formatChangePct(item.change_pct)}，最新价 ${priceText}${navText}${noteText}`;
  });
}

function newsBlockLines(data: DailyReportData): string[] {
  if (data.news.length === 0) {
    return ["- 当日未检索到相关资讯。"];
  }
  return data.news.map(
    (item) => `- ${item.title}（${item.source}，${item.published_at.slice(0, 10)}）`,
  );
}

function sectorBlockLines(data: DailyReportData): string[] {
  if (!data.sectors) {
    return ["- 本日行业板块数据不可用。"];
  }
  return [
    `- 领涨板块：${data.sectors.top.map((item) => `${item.name} ${formatChangePct(item.change_pct)}`).join("、")}`,
    `- 领跌板块：${data.sectors.bottom.map((item) => `${item.name} ${formatChangePct(item.change_pct)}`).join("、")}`,
    `- 统计口径：共 ${data.sectors.total} 个行业板块。`,
  ];
}

function breadthBlockLines(data: DailyReportData): string[] {
  const breadth = data.breadth;
  if (!breadth) {
    return ["- 本日全市场涨跌家数不可用。"];
  }
  return [
    `- 上涨 ${breadth.up} 家，下跌 ${breadth.down} 家，平盘 ${breadth.flat} 家。`,
    `- 涨停 ${breadth.limit_up} 家，跌停 ${breadth.limit_down} 家，停牌 ${breadth.suspended} 家。`,
    breadth.activity_pct === null
      ? "- 市场活跃度数据不可用。"
      : `- 市场活跃度 ${breadth.activity_pct}%。`,
  ];
}

/** 未配置模型或调用失败时的确定性日报正文。 */
export function buildTemplateDailyReport(
  kind: DailyReportKind,
  date: string,
  data: DailyReportData,
): string {
  const headings = REPORT_SECTIONS[kind];
  const blocks: { heading: string; lines: string[] }[] =
    kind === "stock"
      ? [
          { heading: headings[0], lines: indexBlockLines(data) },
          { heading: headings[1], lines: breadthBlockLines(data) },
          { heading: headings[2], lines: sectorBlockLines(data) },
          { heading: headings[3], lines: holdingBlockLines(kind, data) },
          { heading: headings[4], lines: newsBlockLines(data) },
          {
            heading: headings[5],
            lines: ["- 本日报由确定性模板生成，仅用于学习参考，不构成任何投资建议。"],
          },
        ]
      : [
          { heading: headings[0], lines: indexBlockLines(data) },
          { heading: headings[1], lines: holdingBlockLines(kind, data) },
          { heading: headings[2], lines: sectorBlockLines(data) },
          { heading: headings[3], lines: newsBlockLines(data) },
          {
            heading: headings[4],
            lines: [
              "- 基金净值存在滞后与估算偏差，历史业绩不代表未来收益。",
              "- 本日报由确定性模板生成，仅用于学习参考，不构成任何投资建议。",
            ],
          },
        ];

  const lines: string[] = [`# ${date} ${DAILY_REPORT_KIND_LABELS[kind]}`];
  if (data.missing.length > 0) {
    lines.push(`> 数据缺失说明：${data.missing.join("；")}`);
  }
  for (const block of blocks) {
    lines.push("", block.heading, ...block.lines);
  }
  return lines.join("\n");
}

/** 调用 DeepSeek 生成日报正文；未配置密钥或调用失败时返回 null。 */
async function generateWithDeepSeek(
  system: string,
  user: string,
): Promise<{ markdown: string; model: string } | null> {
  if (!deepSeekConfigured()) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REPORT_TIMEOUT_MS);
  try {
    const response = await fetch(`${deepSeekBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: deepSeekModel(),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.4,
        max_tokens: 3000,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      recordExternalCall(false);
      return null;
    }
    const payload = (await response.json()) as {
      choices?: { message?: { content?: unknown } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length < 40) {
      recordExternalCall(false);
      return null;
    }
    recordExternalCall(true);
    return { markdown: content.trim(), model: deepSeekModel() };
  } catch {
    recordExternalCall(false);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 由已采集的数据构造完整日报；模型不可用时自动降级为模板正文。 */
export async function buildDailyReport(
  kind: DailyReportKind,
  date: string,
  data: DailyReportData,
  now: Date = new Date(),
): Promise<DailyReport> {
  const messages = buildDailyReportMessages(kind, date, data);
  const generated = await generateWithDeepSeek(messages.system, messages.user);

  return {
    kind,
    date,
    generated_at: now.toISOString(),
    source: generated ? "deepseek" : "template",
    storage: "local",
    title: `${date} ${DAILY_REPORT_KIND_LABELS[kind]}`,
    headline: buildDailyReportHeadline(kind, data),
    metrics: buildDailyReportMetrics(kind, data),
    markdown: generated?.markdown ?? buildTemplateDailyReport(kind, date, data),
    data,
    model: generated?.model ?? null,
  };
}

/** 日报任务选项。 */
export interface DailyReportJobOptions {
  date?: string;
  force?: boolean;
  source?: "manual" | "cron";
}

/** 日报任务结果，用于 job_runs 记录（契约定义在共享类型）。 */
export type { DailyReportJobResult };

/** 执行一次日报任务：交易日校验 → 幂等校验 → 就绪判定 → 生成 → 保存。 */
export async function runDailyReportJob(
  kind: DailyReportKind,
  options: DailyReportJobOptions = {},
): Promise<DailyReportJobResult> {
  const now = new Date();
  const date = options.date ?? beijingDateKey(now);
  const force = options.force ?? false;
  const skipped = (reason: string): DailyReportJobResult => ({
    kind,
    date,
    status: "skipped",
    reason,
    storage: null,
    report_source: null,
  });

  const calendar = await getTradingCalendar();
  if (!calendar.isTradingDay(date)) {
    return skipped(`${date} 不是交易日，无需生成日报。`);
  }

  if (!force && (await dailyReportExists(kind, date))) {
    return skipped(`${date} 日报已存在，跳过重复生成。`);
  }

  const data = await collectDailyReportData(kind, date, now);
  const readiness = evaluateDailyReportReadiness(kind, date, data, now);
  if (!force && !readiness.ready) {
    return skipped(readiness.reason);
  }

  const report = await buildDailyReport(kind, date, data, now);
  const storage = await saveDailyReport(report);
  return {
    kind,
    date,
    status: "generated",
    reason: readiness.ready ? readiness.reason : "手动强制生成",
    storage,
    report_source: report.source,
  };
}