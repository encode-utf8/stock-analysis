// AI 收盘日报共享契约：列表用摘要，详情用完整对象。
// date 为北京时间交易日（YYYY-MM-DD），是列表排序与去重的唯一键。

/** 日报类型：股市日报 / 基金日报。 */
export type DailyReportKind = "stock" | "fund";

/** 日报正文来源：AI 生成或确定性模板降级。 */
export type DailyReportSource = "deepseek" | "template";

/** 日报存储位置：云端 R2 或本地文件兜底。 */
export type DailyReportStorage = "r2" | "local";

/** 指标涨跌色调，用于面板着色。 */
export type DailyReportTone = "up" | "down" | "flat";

/** 关键指标卡片。 */
export interface DailyReportMetric {
  label: string;
  value: string;
  change_pct: number | null;
  tone: DailyReportTone;
}

/** 大盘指数快照（侧车 /index/quote）。 */
export interface IndexQuoteSnapshot {
  code: string;
  name: string;
  price: number;
  change: number;
  change_pct: number;
  amount: number;
  source: string;
  fetched_at: string;
}

/** 指数单日 K 线（侧车 /index/kline）。 */
export interface IndexKlineDay {
  date: string;
  open: number | null;
  close: number;
  high: number | null;
  low: number | null;
}

/** 指数日线序列。 */
export interface IndexKlineSeries {
  code: string;
  name: string;
  days: IndexKlineDay[];
  source: string;
  fetched_at: string;
}

/** 全市场涨跌家数（侧车 /market/breadth）。 */
export interface MarketBreadthSnapshot {
  up: number;
  down: number;
  flat: number;
  limit_up: number;
  limit_down: number;
  suspended: number;
  activity_pct: number | null;
  stat_date: string | null;
  source: string;
  fetched_at: string;
}

/** 行业板块单项（侧车 /market/sectors）。 */
export interface MarketSectorItem {
  name: string;
  change_pct: number;
  companies: number;
  amount: number;
  leader: string | null;
}

/** 行业板块涨跌榜。 */
export interface MarketSectorsSnapshot {
  top: MarketSectorItem[];
  bottom: MarketSectorItem[];
  total: number;
  source: string;
  fetched_at: string;
}

/** 自选池表现项：股票取行情快照，基金取当日实时价或估算净值。 */
export interface DailyReportHolding {
  code: string;
  name: string;
  change_pct: number | null;
  price: number | null;
  /** 净值日期：场外基金为官方净值日期，股票为 null。 */
  nav_date: string | null;
  note: string | null;
  source: string;
}

/** 日报引用的当日资讯。 */
export interface DailyReportNewsRef {
  title: string;
  source: string;
  url: string;
  published_at: string;
}

/** 日报依赖的数据快照；缺失项在 missing 中列明原因。 */
export interface DailyReportData {
  trade_date: string;
  indices: IndexQuoteSnapshot[];
  breadth: MarketBreadthSnapshot | null;
  sectors: MarketSectorsSnapshot | null;
  holdings: DailyReportHolding[];
  news: DailyReportNewsRef[];
  missing: string[];
}

/** 列表项：只含摘要，避免一次拉取全量正文。 */
export interface DailyReportSummary {
  kind: DailyReportKind;
  date: string;
  generated_at: string;
  source: DailyReportSource;
  storage: DailyReportStorage;
  title: string;
  headline: string;
  metrics: DailyReportMetric[];
}

/** 完整日报：摘要 + 正文 + 数据快照。 */
export interface DailyReport extends DailyReportSummary {
  markdown: string;
  data: DailyReportData;
  model: string | null;
}

/** 日报任务结果：手动生成与定时探测共用同一结构。 */
export interface DailyReportJobResult {
  kind: DailyReportKind;
  date: string;
  status: "generated" | "skipped";
  reason: string;
  storage: DailyReportStorage | null;
  report_source: DailyReportSource | null;
}

/** 列表接口返回结构。 */
export interface DailyReportListResult {
  kind: DailyReportKind;
  storage: DailyReportStorage;
  reports: DailyReportSummary[];
}