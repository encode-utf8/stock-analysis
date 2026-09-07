// 基金代码校验、类型识别与本地默认基金解析。
// 无外部数据源时使用本模块生成可读的确定性基金档案。

import type {
  FundProfile,
  FundTradingMode,
  FundType,
} from "@/lib/shared/types";

/** F1 默认展示基金代码。 */
export const DEFAULT_FUND_CODE = "510300";

/** 建议验收的基金样例：场内指数、场外混合、场外股票、债券。 */
export const SAMPLE_FUND_CODES = ["510300", "000001", "110022", "003376"] as const;

/** 已知基金本地档案，便于无外部数据源时展示可读信息。 */
const KNOWN_FUNDS: Record<
  string,
  Pick<FundProfile, "name" | "type" | "trading_mode">
> = {
  "510300": { name: "沪深300ETF", type: "index", trading_mode: "exchange" },
  "000001": { name: "华夏成长混合", type: "hybrid", trading_mode: "otc" },
  "110022": { name: "易方达消费行业股票", type: "stock", trading_mode: "otc" },
  "161725": { name: "招商中证白酒指数(LOF)", type: "index", trading_mode: "exchange" },
  "003376": { name: "广发中债7-10年国开债指数A", type: "bond", trading_mode: "otc" },
};

/** 基金类型中文展示文案。 */
export const FUND_TYPE_LABELS: Record<FundType, string> = {
  stock: "股票型",
  hybrid: "混合型",
  index: "指数型",
  bond: "债券型",
  qdii: "QDII",
  fof: "FOF",
  reits: "REITs",
  other: "其他",
};

/** 基金交易模式中文展示文案。 */
export const FUND_TRADING_MODE_LABELS: Record<FundTradingMode, string> = {
  otc: "场外申赎",
  exchange: "场内交易",
};

/** 规范化并校验基金代码；非法输入返回 null。 */
export function normalizeFundCode(input: string): string | null {
  const code = input.trim();
  if (!/^\d{6}$/.test(code)) {
    return null;
  }
  return code;
}

/** 根据基金类型文案或基金代码识别基金类型。 */
export function classifyFundType(
  code: string,
  typeLabel?: string | null,
): FundType {
  const known = KNOWN_FUNDS[code];
  if (known) {
    return known.type;
  }

  const label = (typeLabel ?? "").toUpperCase();
  if (label.includes("债券")) {
    return "bond";
  }
  if (label.includes("指数")) {
    return "index";
  }
  if (label.includes("混合")) {
    return "hybrid";
  }
  if (label.includes("股票") || label.includes("股权")) {
    return "stock";
  }
  if (label.includes("QDII")) {
    return "qdii";
  }
  if (label.includes("FOF")) {
    return "fof";
  }
  if (label.includes("REIT")) {
    return "reits";
  }
  if (/^(50|51|56|58|159)/.test(code)) {
    return "index";
  }
  return "other";
}

/** 根据基金代码与类型识别交易模式。 */
export function classifyFundTradingMode(
  code: string,
  type?: FundType,
): FundTradingMode {
  const known = KNOWN_FUNDS[code];
  if (known) {
    return known.trading_mode;
  }
  if (/^(50|51|52|53|54|55|56|57|58|159|16)/.test(code)) {
    return "exchange";
  }
  if (type === "reits") {
    return "exchange";
  }
  return "otc";
}

/** 根据基金代码生成本地基金档案。 */
export function resolveFundProfile(
  code: string,
  source = "本地识别",
): FundProfile {
  const known = KNOWN_FUNDS[code];
  const type = classifyFundType(code);
  const tradingMode = classifyFundTradingMode(code, type);

  return {
    code,
    name: known?.name ?? `基金 ${code}`,
    type,
    trading_mode: tradingMode,
    manager: null,
    company: null,
    benchmark: null,
    establish_date: null,
    scale: null,
    risk_level: null,
    source,
    fetched_at: new Date().toISOString(),
  };
}
