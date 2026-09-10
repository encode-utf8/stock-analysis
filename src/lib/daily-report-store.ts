// AI 收盘日报持久化：R2 云端优先，未配置或写入失败时落本地 .data/daily-reports/。
// 每类日报各维护一份 index.json 摘要索引，列表只需读取索引即可按日期倒序展示。

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  getJsonObject,
  isR2Configured,
  putJsonObject,
  withR2Timeout,
} from "@/lib/r2";
import type {
  DailyReport,
  DailyReportKind,
  DailyReportListResult,
  DailyReportStorage,
  DailyReportSummary,
} from "@/lib/shared/types";

const LOCAL_ROOT = path.join(process.cwd(), ".data", "daily-reports");
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 全部日报类型，供接口与面板遍历。 */
export const DAILY_REPORT_KINDS: readonly DailyReportKind[] = ["stock", "fund"];

/** 校验日报类型；非法值返回 null。 */
export function normalizeDailyReportKind(value: unknown): DailyReportKind | null {
  return value === "stock" || value === "fund" ? value : null;
}

/** 校验日期键（YYYY-MM-DD）；非法值返回 null。 */
export function normalizeDailyReportDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return DATE_PATTERN.test(trimmed) ? trimmed : null;
}

/** R2 对象键：daily-reports/{kind}/{date}.json */
export function dailyReportObjectKey(kind: DailyReportKind, date: string): string {
  return `daily-reports/${kind}/${date}.json`;
}

/** R2 索引对象键：daily-reports/{kind}/index.json */
export function dailyReportIndexKey(kind: DailyReportKind): string {
  return `daily-reports/${kind}/index.json`;
}

function localDir(kind: DailyReportKind): string {
  return path.join(LOCAL_ROOT, kind);
}

function localFilePath(kind: DailyReportKind, date: string): string {
  return path.join(localDir(kind), `${date}.json`);
}

function localIndexPath(kind: DailyReportKind): string {
  return path.join(localDir(kind), "index.json");
}

/** 从完整日报中提取列表摘要，避免列表接口下发正文。 */
export function toDailyReportSummary(report: DailyReport): DailyReportSummary {
  return {
    kind: report.kind,
    date: report.date,
    generated_at: report.generated_at,
    source: report.source,
    storage: report.storage,
    title: report.title,
    headline: report.headline,
    metrics: report.metrics,
  };
}

/** 摘要排序：日期倒序（越新越靠前），同日期按生成时间倒序。 */
export function sortDailyReportSummaries(list: DailyReportSummary[]): DailyReportSummary[] {
  return [...list].sort((a, b) => {
    if (a.date !== b.date) {
      return a.date < b.date ? 1 : -1;
    }
    return a.generated_at < b.generated_at ? 1 : -1;
  });
}

/** 按日期去重；同日期保留生成时间更新的一条。 */
export function dedupeDailyReportSummaries(list: DailyReportSummary[]): DailyReportSummary[] {
  const map = new Map<string, DailyReportSummary>();
  for (const item of list) {
    const existing = map.get(item.date);
    if (!existing || existing.generated_at < item.generated_at) {
      map.set(item.date, item);
    }
  }
  return sortDailyReportSummaries([...map.values()]);
}

function isDailyReportSummary(value: unknown): value is DailyReportSummary {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<DailyReportSummary>;
  return (
    (item.kind === "stock" || item.kind === "fund") &&
    typeof item.date === "string" &&
    typeof item.generated_at === "string" &&
    typeof item.title === "string" &&
    Array.isArray(item.metrics)
  );
}

function isDailyReport(value: unknown): value is DailyReport {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<DailyReport>;
  return (
    (item.kind === "stock" || item.kind === "fund") &&
    typeof item.date === "string" &&
    typeof item.markdown === "string" &&
    Array.isArray(item.metrics)
  );
}

async function readLocalIndex(kind: DailyReportKind): Promise<DailyReportSummary[]> {
  try {
    const content = await readFile(localIndexPath(kind), "utf8");
    const parsed = JSON.parse(content) as { reports?: unknown };
    return Array.isArray(parsed.reports) ? parsed.reports.filter(isDailyReportSummary) : [];
  } catch {
    return [];
  }
}

async function writeLocalIndex(
  kind: DailyReportKind,
  reports: DailyReportSummary[],
): Promise<void> {
  await mkdir(localDir(kind), { recursive: true });
  await writeFile(
    localIndexPath(kind),
    JSON.stringify({ updated_at: new Date().toISOString(), reports }, null, 2),
    "utf8",
  );
}

/** 索引缺失时扫描本地目录重建摘要，避免手工放入的日报不可见。 */
async function scanLocalIndex(kind: DailyReportKind): Promise<DailyReportSummary[]> {
  try {
    const files = await readdir(localDir(kind));
    const summaries: DailyReportSummary[] = [];
    for (const file of files) {
      if (!file.endsWith(".json") || file === "index.json") {
        continue;
      }
      try {
        const content = await readFile(path.join(localDir(kind), file), "utf8");
        const parsed = JSON.parse(content) as unknown;
        if (isDailyReport(parsed)) {
          summaries.push({ ...toDailyReportSummary(parsed), storage: "local" });
        }
      } catch {
        continue;
      }
    }
    return summaries;
  } catch {
    return [];
  }
}

/** 读取 R2 上的摘要索引；未配置或读取失败返回空数组。 */
async function readRemoteIndex(kind: DailyReportKind): Promise<DailyReportSummary[]> {
  if (!isR2Configured()) {
    return [];
  }
  try {
    const payload = await withR2Timeout(
      getJsonObject<{ reports?: unknown }>(dailyReportIndexKey(kind)),
    );
    const reports = payload?.reports;
    return Array.isArray(reports) ? reports.filter(isDailyReportSummary) : [];
  } catch {
    return [];
  }
}

/** 合并写入本地索引（始终写）与 R2 索引（配置且可用时写）。 */
async function mergeIndex(kind: DailyReportKind, summary: DailyReportSummary): Promise<void> {
  const localMerged = dedupeDailyReportSummaries([
    summary,
    ...(await readLocalIndex(kind)),
  ]);
  await writeLocalIndex(kind, localMerged);

  if (!isR2Configured()) {
    return;
  }
  try {
    const remoteMerged = dedupeDailyReportSummaries([
      summary,
      ...(await readRemoteIndex(kind)),
    ]);
    await withR2Timeout(
      putJsonObject(dailyReportIndexKey(kind), {
        updated_at: new Date().toISOString(),
        reports: remoteMerged,
      }),
    );
  } catch {
    // 索引写入失败不影响主流程：详情对象已单独写入。
  }
}

/** 保存日报：R2 优先，未配置或写入失败时落本地；返回实际存储位置。 */
export async function saveDailyReport(report: DailyReport): Promise<DailyReportStorage> {
  let storage: DailyReportStorage = "local";

  if (isR2Configured()) {
    try {
      await withR2Timeout(
        putJsonObject(dailyReportObjectKey(report.kind, report.date), report),
      );
      storage = "r2";
    } catch {
      storage = "local";
    }
  }

  if (storage === "local") {
    await mkdir(localDir(report.kind), { recursive: true });
    await writeFile(localFilePath(report.kind, report.date), JSON.stringify(report, null, 2), "utf8");
  }

  await mergeIndex(report.kind, { ...toDailyReportSummary(report), storage });
  return storage;
}

/** 读取某天日报：先查 R2，再查本地；都不存在返回 null。 */
export async function getDailyReport(
  kind: DailyReportKind,
  date: string,
): Promise<{ report: DailyReport; storage: DailyReportStorage } | null> {
  if (isR2Configured()) {
    try {
      const remote = await withR2Timeout(
        getJsonObject<unknown>(dailyReportObjectKey(kind, date)),
      );
      if (isDailyReport(remote)) {
        return { report: remote, storage: "r2" };
      }
    } catch {
      // 忽略远端异常，继续尝试本地兜底。
    }
  }

  try {
    const content = await readFile(localFilePath(kind, date), "utf8");
    const parsed = JSON.parse(content) as unknown;
    if (isDailyReport(parsed)) {
      return { report: parsed, storage: "local" };
    }
  } catch {
    return null;
  }
  return null;
}

/** 列出某类日报摘要：R2 索引与本地索引合并，按日期倒序。 */
export async function listDailyReports(kind: DailyReportKind): Promise<DailyReportListResult> {
  const remote = (await readRemoteIndex(kind)).map((item) => ({
    ...item,
    storage: "r2" as const,
  }));

  const localIndexed = await readLocalIndex(kind);
  const local =
    localIndexed.length > 0
      ? localIndexed.map((item) => ({ ...item, storage: "local" as const }))
      : (await scanLocalIndex(kind)).map((item) => ({ ...item, storage: "local" as const }));

  return {
    kind,
    storage: isR2Configured() ? "r2" : "local",
    reports: dedupeDailyReportSummaries([...remote, ...local]),
  };
}

/** 判断某天日报是否已生成（读索引，避免下载正文）。 */
export async function dailyReportExists(
  kind: DailyReportKind,
  date: string,
): Promise<boolean> {
  const { reports } = await listDailyReports(kind);
  return reports.some((item) => item.date === date);
}