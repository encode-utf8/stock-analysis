// 基金资讯：确定性生成 + 到期清理。长期公告/定期报告使用 pinned 或“长期”标签保留。
import { fundNewsStore } from "@/lib/fund-news-store";
import type { FundNewsItem, NewsSentiment, NewsStatus } from "@/lib/shared/types";

const LONG_TERM_TAG = "长期";
const DAY_MS = 24 * 60 * 60_000;

function shortId(code: string, type: string, index: number): string {
  return `fund-news-${code}-${type}-${index}`;
}

function item(
  code: string,
  type: FundNewsItem["news_type"],
  index: number,
  title: string,
  summary: string,
  source: string,
  sentiment: NewsSentiment,
  impactDays: number,
  tags: string[],
  pinned = false,
): FundNewsItem {
  const now = Date.now();
  return {
    id: shortId(code, type, index),
    code,
    title,
    summary,
    url: "",
    source,
    published_at: new Date(now - DAY_MS * index).toISOString(),
    fetched_at: new Date().toISOString(),
    sentiment,
    confidence: 0.8,
    impact_days: impactDays,
    expire_at: new Date(now + impactDays * DAY_MS).toISOString(),
    tags,
    status: "active",
    pinned,
    news_type: type,
  };
}

/** 生成本地确定性基金资讯，保证无外部数据源时仍有可清理的演示数据。 */
export function buildDeterministicFundNews(code: string): FundNewsItem[] {
  return [
    item(
      code,
      "report",
      0,
      "基金定期报告",
      "基金最新定期报告摘要，用于观察持仓与规模变化。",
      "基金确定性数据",
      "neutral",
      30,
      [LONG_TERM_TAG, "定期报告"],
      true,
    ),
    item(
      code,
      "announcement",
      1,
      "基金经理变更公告",
      "基金经理或基金公司重要公告，属于长期关注信息。",
      "基金确定性数据",
      "neutral",
      30,
      [LONG_TERM_TAG, "公告"],
      true,
    ),
    item(
      code,
      "market",
      2,
      "基金相关市场资讯",
      "短期市场资讯，仅用于观察近期情绪。",
      "基金确定性数据",
      "neutral",
      7,
      ["短期"],
    ),
  ];
}

/** 获取基金资讯；当前先使用确定性数据，并写入基金资讯仓库。 */
export async function getFundNews(code: string, forceRefresh = false): Promise<FundNewsItem[]> {
  const saved = await fundNewsStore.news.listByCode(code);
  if (!forceRefresh && saved.length > 0) {
    return saved;
  }

  const news = buildDeterministicFundNews(code);
  for (const entry of news) {
    await fundNewsStore.news.insert(entry);
  }
  return news;
}

/** 清理到期基金资讯；保留 pinned 与“长期”标签条目。 */
export async function cleanupExpiredFundNews(now = new Date().toISOString(), dryRun = false): Promise<number> {
  const expired = await fundNewsStore.news.listExpired(now);
  const candidates = expired.filter((entry) => {
    return entry.status === "active" && !entry.pinned && !entry.tags.includes(LONG_TERM_TAG);
  });
  if (!dryRun) {
    for (const entry of candidates) {
      await fundNewsStore.news.updateStatus(entry.id, "expired" as NewsStatus);
    }
  }
  return candidates.length;
}

