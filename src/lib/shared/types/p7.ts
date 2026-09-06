// 下一阶段公共底座契约：仅新增，不修改既有字段语义。
// DataSourceStatus 与 SchedulerJob 继续复用 next-phase.ts 中已冻结的契约，
// 后续功能分支如需扩展，应先在本文件新增并保持向后兼容。

/** 自选股条目。 */
export interface WatchlistItem {
  code: string;
  name: string;
  exchange: string;
  group: string;
  added_at: string;
  sort_order: number;
  note: string | null;
}

/** 复盘统计摘要。 */
export interface ReplaySummary {
  code: string;
  period_start: string;
  period_end: string;
  total_analysis: number;
  total_chats: number;
  positive_hits: number;
  negative_hits: number;
  neutral_hits: number;
  hit_rate: number;
  sample_size: number;
  generated_at: string;
}
