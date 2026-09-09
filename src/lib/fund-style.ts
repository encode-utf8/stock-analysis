// 基金风格因子分析：基于真实持仓、行业配置与风险指标计算本地风格标签，并可选调用 DeepSeek 归纳说明。
// 持仓为确定性回退或数据不足时明确不可用，不生成演示风格结论。
import { getFundHoldings } from "@/lib/fund-holdings";
import { getFundMetrics } from "@/lib/fund-metrics";
import { getFundProfile, type FundNavRange } from "@/lib/fund-data";
import { normalizeFundCode } from "@/lib/fund-market";
import { recordExternalCall } from "@/lib/observability";
import type {
  FundHoldings,
  FundProfile,
  FundRiskMetrics,
  FundStyleSnapshot,
} from "@/lib/shared/types";

const VALID_RANGES: FundNavRange[] = ["1m", "3m", "6m", "1y", "3y", "all"];

/** 规范化风格分析基金代码；非法输入返回 null。 */
export function normalizeFundStyleCode(raw: string | null): string | null {
  return raw ? normalizeFundCode(raw) : null;
}

/** 规范化风格分析区间；非法时回退到 1y。 */
export function normalizeFundStyleRange(raw: string | null): FundNavRange {
  return VALID_RANGES.includes(raw as FundNavRange) ? (raw as FundNavRange) : "1y";
}

function hasRealKey(value: string | undefined): boolean {
  return Boolean(value && value !== "replace-me");
}

function round(value: number | null | undefined, digits = 2): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function industryAllocation(holdings: FundHoldings): Array<{ name: string; weight_pct: number }> {
  return Object.entries(holdings.industry_allocation ?? {})
    .filter(([name, weight]) => typeof weight === "number" && weight > 0 && name.trim().length > 0)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([name, weight]) => ({
      name,
      weight_pct: round(weight) ?? 0,
    }));
}

function buildStyleTags(
  profile: FundProfile,
  holdings: FundHoldings,
  metrics: FundRiskMetrics | null,
): string[] {
  const tags: string[] = [];
  if (profile.type === "index") {
    tags.push("指数型");
  }
  if (profile.trading_mode === "exchange") {
    tags.push("场内交易");
  }

  const top10Weight = holdings.top10_weight_pct;
  if (top10Weight !== null && top10Weight >= 60) {
    tags.push("高集中度");
  } else if (top10Weight !== null && top10Weight <= 40) {
    tags.push("持仓分散");
  }

  const topIndustryWeight = Math.max(0, ...industryAllocation(holdings).map((item) => item.weight_pct));
  if (topIndustryWeight >= 50) {
    tags.push("行业主题集中");
  } else if (topIndustryWeight > 0 && topIndustryWeight <= 20) {
    tags.push("行业均衡");
  }

  if (metrics) {
    if ((metrics.annualized_volatility_pct ?? 0) >= 25) {
      tags.push("高波动");
    } else if ((metrics.annualized_volatility_pct ?? 0) <= 10) {
      tags.push("低波动");
    }
    if ((metrics.max_drawdown_pct ?? 0) <= -30) {
      tags.push("深度回撤");
    }
    if ((metrics.sharpe ?? 0) >= 1) {
      tags.push("风险收益较好");
    }
  }

  return Array.from(new Set(tags)).slice(0, 8);
}

function buildLocalNarrative(
  profile: FundProfile,
  holdings: FundHoldings,
  metrics: FundRiskMetrics | null,
  tags: string[],
): string {
  const top10 = holdings.top10_weight_pct;
  const top1 = holdings.top1_weight_pct;
  const industry = industryAllocation(holdings)
    .map((item) => `${item.name} ${item.weight_pct.toFixed(2)}%`)
    .join("、");

  const parts = [
    `${profile.name}（${profile.code}）的风格标签为：${tags.join("、") || "暂无显著标签"}。`,
    `前十大持仓合计${top10 === null ? "暂无数据" : `${top10.toFixed(2)}%`}，第一大持仓${top1 === null ? "暂无数据" : `${top1.toFixed(2)}%`}。`,
    `行业配置${industry ? `：${industry}` : "暂无行业分布数据"}。`,
  ];

  if (metrics) {
    parts.push(
      `区间年化收益${metrics.annualized_return_pct === null ? "暂无" : `${metrics.annualized_return_pct.toFixed(2)}%`}，年化波动${metrics.annualized_volatility_pct === null ? "暂无" : `${metrics.annualized_volatility_pct.toFixed(2)}%`}，最大回撤${metrics.max_drawdown_pct.toFixed(2)}%。`,
    );
  }

  return `${parts.join("")} 以上为本地规则归纳，仅供学习参考。`;
}

async function inferStyleNarrativeWithDeepSeek(
  profile: FundProfile,
  holdings: FundHoldings,
  metrics: FundRiskMetrics | null,
  tags: string[],
): Promise<string | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!hasRealKey(apiKey)) {
    return null;
  }

  const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
  const system = [
    "你是专业的基金风格分析助手。",
    "请基于给定的基金档案、持仓、行业配置和风险指标，用 3-5 句话概括该基金的风格特征。",
    "只输出分析文字，不要输出 Markdown 标题、列表或确定性买卖建议。",
  ].join("\n");
  const user = [
    `基金：${profile.name}（${profile.code}）`,
    `类型：${profile.type}，交易模式：${profile.trading_mode}`,
    `本地风格标签：${tags.join("、") || "暂无"}`,
    `持仓报告期：${holdings.report_date}`,
    `前十大持仓：${holdings.top_holdings.map((item) => `${item.name} ${item.weight_pct.toFixed(2)}%`).join("、")}`,
    `行业配置：${industryAllocation(holdings).map((item) => `${item.name} ${item.weight_pct.toFixed(2)}%`).join("、")}`,
    `风险指标：年化收益 ${metrics?.annualized_return_pct?.toFixed(2) ?? "暂无"}%，年化波动 ${metrics?.annualized_volatility_pct?.toFixed(2) ?? "暂无"}%，最大回撤 ${metrics?.max_drawdown_pct?.toFixed(2) ?? "暂无"}%，夏普 ${metrics?.sharpe?.toFixed(2) ?? "暂无"}。`,
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.3,
        max_tokens: 800,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      recordExternalCall(false);
      return null;
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    recordExternalCall(true);
    const content = payload.choices?.[0]?.message?.content?.trim();
    return content ? content.slice(0, 1200) : null;
  } catch {
    recordExternalCall(false);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function unavailableSnapshot(
  code: string,
  name: string,
  range: FundNavRange,
  source: string,
  reason: string,
  now = new Date(),
): FundStyleSnapshot {
  return {
    code,
    name,
    range,
    available: false,
    reason,
    analysis_source: "local",
    tags: [],
    risk_return: {
      annualized_return_pct: null,
      annualized_volatility_pct: null,
      sharpe: null,
      sortino: null,
      calmar: null,
      max_drawdown_pct: null,
      current_drawdown_pct: null,
    },
    concentration: {
      top10_weight_pct: null,
      top1_weight_pct: null,
      holding_count: 0,
      industry_count: 0,
    },
    industry_allocation: [],
    narrative: null,
    source,
    generated_at: now.toISOString(),
  };
}

/** 计算基金风格因子快照。 */
export async function getFundStyle(
  code: string,
  range: FundNavRange,
  now = new Date(),
): Promise<FundStyleSnapshot> {
  const [profile, holdings, metrics] = await Promise.all([
    getFundProfile(code),
    getFundHoldings(code),
    getFundMetrics(code, range),
  ]);
  const source = holdings.source === "deterministic-fallback" ? profile.source : holdings.source;

  if (holdings.source === "deterministic-fallback" || holdings.top_holdings.length === 0) {
    return unavailableSnapshot(
      code,
      profile.name,
      range,
      source,
      "基金持仓数据暂不可用，无法进行风格因子分析。",
      now,
    );
  }

  const industries = industryAllocation(holdings);
  const tags = buildStyleTags(profile, holdings, metrics);
  const aiNarrative = await inferStyleNarrativeWithDeepSeek(profile, holdings, metrics, tags);
  const analysisSource = aiNarrative ? "ai" : "local";
  const narrative = aiNarrative ?? buildLocalNarrative(profile, holdings, metrics, tags);

  return {
    code,
    name: profile.name,
    range,
    available: true,
    reason: null,
    analysis_source: analysisSource,
    tags,
    risk_return: {
      annualized_return_pct: metrics ? round(metrics.annualized_return_pct) : null,
      annualized_volatility_pct: metrics ? round(metrics.annualized_volatility_pct) : null,
      sharpe: metrics ? round(metrics.sharpe) : null,
      sortino: metrics ? round(metrics.sortino) : null,
      calmar: metrics ? round(metrics.calmar) : null,
      max_drawdown_pct: metrics ? round(metrics.max_drawdown_pct) : null,
      current_drawdown_pct: metrics ? round(metrics.current_drawdown_pct) : null,
    },
    concentration: {
      top10_weight_pct: round(holdings.top10_weight_pct),
      top1_weight_pct: round(holdings.top1_weight_pct),
      holding_count: holdings.top_holdings.length,
      industry_count: industries.length,
    },
    industry_allocation: industries,
    narrative,
    source,
    generated_at: now.toISOString(),
  };
}
