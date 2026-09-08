// 基金 AI 分析编排：聚合基金档案、净值、行情/估算、持仓与风险指标后生成教学式报告。
import { getFundProfile } from "@/lib/fund-data";
import { getFundIntraday } from "@/lib/fund-intraday";
import { getFundHoldings } from "@/lib/fund-holdings";
import { getFundMetrics } from "@/lib/fund-metrics";
import { recordExternalCall, recordTaskRun } from "@/lib/observability";
import { fundAiStore } from "@/lib/fund-ai-store";
import type {
  FundAnalysisReport,
  FundAnalysisStreamEvent,
  FundHoldings,
  FundIntraday,
  FundProfile,
  FundRiskMetrics,
} from "@/lib/shared/types";

const DEFAULT_FUND_ANALYSIS_TIMEOUT_MS = 45_000;

function analysisTimeoutMs(): number {
  const configured = Number(process.env.DEEPSEEK_ANALYSIS_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 10_000
    ? configured
    : DEFAULT_FUND_ANALYSIS_TIMEOUT_MS;
}

function deepSeekConfigured(): boolean {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  return Boolean(apiKey && apiKey !== "replace-me");
}

function deepSeekBaseUrl(): string {
  return (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
}

function deepSeekModel(): string {
  return process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
}

function buildReportId(code: string): string {
  return `fund-report-${code}-${Date.now()}`;
}

function percent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "暂无";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function numberText(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "暂无";
  }
  return value.toFixed(digits);
}

function hasForbiddenPromise(text: string): boolean {
  const forbidden = /必然(上涨|下跌|涨|跌)|必(涨|跌)|一定(涨|跌)|稳赚|包赚|保本|稳赢/;
  const disclaimer = /不|非|勿|无|没|未|风险|承诺|免责|请勿|不得|不能|不会|不应|不代表|不构成|不意味着/;
  const sentences = text.split(/(?<=[。！？\n])/);
  return sentences.some((sentence) => !disclaimer.test(sentence) && forbidden.test(sentence));
}

function normalizeForMatch(text: string): string {
  return text.replace(/[,\s，。]/g, "");
}

function includesAnyNumber(content: string, values: number[]): boolean {
  const normalized = normalizeForMatch(content);
  return values.some((value) => {
    if (!Number.isFinite(value)) {
      return false;
    }
    return [value.toFixed(2), value.toFixed(1), value.toFixed(0)].some((candidate) =>
      normalized.includes(candidate),
    );
  });
}

function isConcreteFundAnalysis(content: string, profile: FundProfile, metrics: FundRiskMetrics | null): boolean {
  const hasCodeOrName = content.includes(profile.code) || content.includes(profile.name);
  const dataNumbers = [
    metrics?.max_drawdown_pct ?? 0,
    metrics?.annualized_return_pct ?? 0,
    metrics?.current_drawdown_pct ?? 0,
  ];
  const numericCount = (content.match(/\d+(?:\.\d+)?/g) ?? []).length;
  return hasCodeOrName && numericCount >= 3 && includesAnyNumber(content, dataNumbers);
}

interface FundAnalysisContext {
  profile: FundProfile;
  intraday: FundIntraday;
  holdings: FundHoldings;
  allMetrics: FundRiskMetrics | null;
  oneYearMetrics: FundRiskMetrics | null;
  navCount: number;
  source_refs: Array<{ label: string; value: string }>;
}

async function buildAnalysisContext(code: string): Promise<FundAnalysisContext> {
  const [profile, intraday, holdings, allMetrics, oneYearMetrics] = await Promise.all([
    getFundProfile(code),
    getFundIntraday(code),
    getFundHoldings(code),
    getFundMetrics(code, "all"),
    getFundMetrics(code, "1y"),
  ]);

  const sources = new Map<string, { label: string; value: string }>();
  if (profile.source) {
    sources.set("profile", { label: "基金档案来源", value: profile.source });
  }
  if (intraday.source) {
    sources.set("intraday", { label: "当日行情来源", value: intraday.source });
  }
  if (holdings.source) {
    sources.set("holdings", { label: "持仓数据来源", value: holdings.source });
  }
  if (allMetrics) {
    sources.set("metrics", { label: "风险指标计算", value: `本地累计净值计算，区间 ${allMetrics.start_date} 至 ${allMetrics.end_date}` });
  }

  return {
    profile,
    intraday,
    holdings,
    allMetrics,
    oneYearMetrics,
    navCount: 0,
    source_refs: Array.from(sources.values()),
  };
}

function buildFallbackReport(context: FundAnalysisContext, prompt: string): string {
  const { profile, intraday, holdings, allMetrics, oneYearMetrics } = context;
  const intradayText = intraday.mode === "realtime"
    ? `最新价 ${numberText(intraday.price, 4)}，涨跌幅 ${percent(intraday.change_pct)}`
    : `盘中估算净值 ${numberText(intraday.estimated_nav, 4)}，估算涨跌幅 ${percent(intraday.change_pct)}，非官方净值`;
  const holdingText = holdings.top_holdings.slice(0, 5).map((item, index) =>
    `${index + 1}. ${item.name}（${percent(item.weight_pct)}）`,
  ).join("；") || "暂无前十大持仓明细。";
  const top10 = percent(holdings.top10_weight_pct);
  const top1 = percent(holdings.top1_weight_pct);
  const drawdownText = allMetrics
    ? `最大回撤 ${numberText(allMetrics.max_drawdown_pct)}%（${allMetrics.max_drawdown_start} 至 ${allMetrics.max_drawdown_end}），当前回撤 ${numberText(allMetrics.current_drawdown_pct)}%`
    : "暂无回撤数据。";
  const annualText = oneYearMetrics
    ? `近 1 年年化收益 ${percent(oneYearMetrics.annualized_return_pct)}，年化波动率 ${numberText(oneYearMetrics.annualized_volatility_pct)}%`
    : "暂无近 1 年风险收益数据。";
  const sourceLines = context.source_refs.map((item) => `- ${item.label}：${item.value}`).join("\n");

  return [
    `## ${profile.name}（${profile.code}）基金分析`,
    "",
    "> 本次未生成 AI 报告，以下为本地基金数据摘要，仅供学习参考。",
    "",
    "### 基金概览",
    `- 基金类型：${profile.type}；交易模式：${profile.trading_mode === "exchange" ? "场内交易" : "场外申赎"}。`,
    `- 基金经理：${profile.manager ?? "暂无"}；基金公司：${profile.company ?? "暂无"}。`,
    `- 当日表现：${intradayText}。`,
    "",
    "### 持仓风格",
    `- 最新报告期：${holdings.report_date}；前十大合计占比 ${top10}，第一大重仓 ${top1}。`,
    `- 前五大持仓：${holdingText}。`,
    "",
    "### 风险解读",
    `- ${drawdownText}。`,
    `- ${annualText}。`,
    "",
    "### 数据来源",
    sourceLines,
    "",
    "### 风险提示",
    "本报告不构成投资建议，不构成必然上涨或下跌的预测。基金数据可能滞后或存在估算误差，请独立核验并自行承担盈亏。",
    "",
    "### 用户补充",
    prompt || "无",
  ].join("\n");
}

function buildAnalysisMessages(context: FundAnalysisContext, prompt: string): { system: string; user: string } {
  const { profile, intraday, holdings, allMetrics, oneYearMetrics } = context;
  const system = [
    "你是基金学习与分析助手，使用中文 Markdown 输出。",
    "必须引用给定基金代码、基金名称、最新净值/估算、持仓报告期与回撤指标，禁止只输出通用套话。",
    "持仓数据来自定期报告，存在披露滞后，必须提示报告期，不得描述为当前实时持仓。",
    "必须包含：基金概览、持仓风格、风险解读、数据来源、风险提示；不得输出确定性买卖建议。",
  ].join("\n");
  const user = [
    "请根据以下基金数据生成教学式分析报告：",
    `基金档案：${JSON.stringify(profile)}`,
    `当日行情或估算：${JSON.stringify(intraday)}`,
    `最新季度持仓：${JSON.stringify(holdings)}`,
    `成立以来风险指标：${JSON.stringify(allMetrics)}`,
    `近 1 年风险指标：${JSON.stringify(oneYearMetrics)}`,
    `用户补充：${prompt || "无"}`,
  ].join("\n");
  return { system, user };
}

async function generateWithDeepSeek(context: FundAnalysisContext, prompt: string): Promise<string | null> {
  if (!deepSeekConfigured()) {
    return null;
  }

  const { system, user } = buildAnalysisMessages(context, prompt);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), analysisTimeoutMs());
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
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content?.trim();
    recordExternalCall(true);
    if (!content || hasForbiddenPromise(content) || !isConcreteFundAnalysis(content, context.profile, context.allMetrics)) {
      return null;
    }
    return content;
  } catch {
    recordExternalCall(false);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface DeepSeekStreamResponse {
  choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
}

async function* streamDeepSeekFundAnalysis(messages: { system: string; user: string }, signal?: AbortSignal): AsyncGenerator<string> {
  if (!deepSeekConfigured()) {
    return;
  }
  const controller = new AbortController();
  const abortFromSignal = () => controller.abort();
  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", abortFromSignal, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), analysisTimeoutMs());

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
          { role: "system", content: messages.system },
          { role: "user", content: messages.user },
        ],
        temperature: 0.4,
        max_tokens: 3000,
        stream: true,
      }),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`DeepSeek 响应异常：${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        for (const line of block.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) {
            continue;
          }
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") {
            continue;
          }
          const event = JSON.parse(payload) as DeepSeekStreamResponse;
          const content = event.choices?.[0]?.delta?.content;
          if (content) {
            yield content;
          }
        }
      }
    }
    recordExternalCall(true);
  } catch (error) {
    recordExternalCall(false);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromSignal);
  }
}

function finalizeContent(content: string, context: FundAnalysisContext): string {
  const sourceSection = context.source_refs.map((item) => `- ${item.label}：${item.value}`).join("\n");
  return content.includes("数据来源") ? content : `${content}\n\n### 数据来源\n${sourceSection}`;
}

function buildReport(context: FundAnalysisContext, content: string, reportId = buildReportId(context.profile.code)): FundAnalysisReport {
  return {
    id: reportId,
    code: context.profile.code,
    created_at: new Date().toISOString(),
    data_snapshot: {
      profile: context.profile,
      intraday: context.intraday,
      holdings: context.holdings,
      all_metrics: context.allMetrics,
      one_year_metrics: context.oneYearMetrics,
      nav_count: context.navCount,
    },
    source_refs: context.source_refs,
    content,
    risk_note: "本报告仅供学习参考，不构成投资建议；基金数据可能存在延迟或估算误差，请独立决策并自行承担盈亏。",
  };
}

async function persistReport(report: FundAnalysisReport): Promise<FundAnalysisReport> {
  await fundAiStore.reports.insert(report);
  return report;
}

/** 非流式生成基金 AI 分析。 */
export async function runFundAnalysis(code: string, prompt?: string): Promise<FundAnalysisReport> {
  recordTaskRun("analysis");
  const context = await buildAnalysisContext(code);
  const fallback = buildFallbackReport(context, prompt ?? "");
  const llmContent = await generateWithDeepSeek(context, prompt ?? "");
  const content = finalizeContent(llmContent ?? fallback, context);
  return persistReport(buildReport(context, content));
}

/** 流式生成基金 AI 分析。 */
export async function* streamFundAnalysis(
  code: string,
  prompt?: string,
  signal?: AbortSignal,
): AsyncGenerator<FundAnalysisStreamEvent> {
  recordTaskRun("analysis");
  const context = await buildAnalysisContext(code);
  const reportId = buildReportId(code);
  yield { type: "meta", data: { reportId } };

  const fallback = buildFallbackReport(context, prompt ?? "");
  const messages = buildAnalysisMessages(context, prompt ?? "");
  let llmContent: string | null = null;
  let streamedContent = "";

  if (deepSeekConfigured()) {
    try {
      for await (const chunk of streamDeepSeekFundAnalysis(messages, signal)) {
        streamedContent += chunk;
        yield { type: "delta", content: chunk };
      }
      if (
        streamedContent.trim() &&
        !hasForbiddenPromise(streamedContent) &&
        isConcreteFundAnalysis(streamedContent, context.profile, context.allMetrics)
      ) {
        llmContent = streamedContent;
      }
    } catch {
      llmContent = null;
    }
  }

  const baseContent = llmContent ?? fallback;
  const content = finalizeContent(baseContent, context);
  if (!llmContent) {
    yield { type: "delta", content };
  }
  const report = await persistReport(buildReport(context, content, reportId));
  yield { type: "done", data: { report } };
}

/** 获取基金历史 AI 报告。 */
export async function listFundReports(code: string): Promise<FundAnalysisReport[]> {
  return fundAiStore.reports.listByCode(code);
}

/** 删除基金 AI 报告。 */
export async function deleteFundReport(code: string, reportId: string): Promise<boolean> {
  const reports = await fundAiStore.reports.listByCode(code);
  if (!reports.some((item) => item.id === reportId)) {
    return false;
  }
  await fundAiStore.reports.deleteById(reportId);
  return true;
}
