// 自选池名称自愈：历史数据可能存着「基金 560710」这类本地占位名，
// 读取列表时用上游真实名称回填，避免左侧栏一直显示占位名。

import {
  isPlaceholderName,
  type CodeVerifyResult,
  type VerifyTargetKind,
} from "@/lib/code-verify";

/** 单次读取最多回填的条目数，避免批量上游请求拖慢列表接口。 */
const MAX_NAME_REPAIRS = 5;

/** 可回填名称的最小条目结构。 */
interface NameRepairableItem {
  code: string;
  name: string;
}

/**
 * 回填列表中的占位名称并返回更新后的列表。
 * 上游查不到或不可用时保留原名称，回填失败不阻塞列表返回。
 */
export async function repairWatchlistNames<T extends NameRepairableItem>(
  items: T[],
  kind: VerifyTargetKind,
  verify: (code: string) => Promise<CodeVerifyResult | null>,
  updateName: (code: string, name: string) => Promise<void>,
): Promise<T[]> {
  const targets = items
    .filter((item) => isPlaceholderName(kind, item.name))
    .slice(0, MAX_NAME_REPAIRS);
  if (targets.length === 0) {
    return items;
  }

  const repaired = await Promise.all(
    targets.map(async (item) => {
      try {
        const result = await verify(item.code);
        const name = result && result.status === "ok" && result.name ? result.name.trim() : "";
        if (!name) {
          return null;
        }
        await updateName(item.code, name);
        return { code: item.code, name };
      } catch (error) {
        console.warn(`[watchlist] 自选名称回填失败：${item.code}`, error);
        return null;
      }
    }),
  );

  const byCode = new Map<string, string>();
  for (const entry of repaired) {
    if (entry) {
      byCode.set(entry.code, entry.name);
    }
  }
  if (byCode.size === 0) {
    return items;
  }

  return items.map((item) => {
    const name = byCode.get(item.code);
    return name ? { ...item, name } : item;
  });
}