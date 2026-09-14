/** 自选（个股/基金）列表的关键字匹配工具，供侧栏搜索框复用。 */

/**
 * 判断一条自选记录是否命中关键字。
 * 关键字会去掉首尾空格并忽略大小写；关键字为空时视为全部命中。
 * 任一字段（代码、名称、备注、分组等）包含关键字即算命中。
 */
export function matchesWatchlistKeyword(
  fields: ReadonlyArray<string | null | undefined>,
  keyword: string,
): boolean {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return fields.some((field) => (field ?? "").toLowerCase().includes(normalized));
}
