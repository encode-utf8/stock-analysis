/** 将 ISO 时间字符串格式化为中文本地时间。 */
export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "时间未知";
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

/** 计算行情数据相对当前时间的新鲜度文案。 */
export function freshnessText(value: string): string {
  const age = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(age) || age < 0) {
    return "时间未知";
  }
  const minutes = Math.floor(age / 60_000);
  if (minutes < 1) {
    return "刚刚";
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时前`;
}

/** 将行情来源标识统一转换为中文展示文案。 */
export function sourceLabel(source: string): string {
  if (source === "akshare") {
    return "AkShare 实时行情";
  }
  if (source === "tencent") {
    return "腾讯实时行情";
  }
  if (source === "sina") {
    return "新浪财经盘中估值";
  }
  if (source === "deterministic-fallback") {
    return "确定性降级数据";
  }
  return source;
}
const GARBLED_TEXT_PATTERNS = [
  /ï¿½|Ã|Â|â€|å|ç|æ|ä¸­å›½|è‚¡ç¥¨|æ²ª|æ·±/i,
  /[À-ÿ]{4,}/,
  /[�]{1,}/,
  /(?:[?？]\s*){3,}/,
];

/** 判断文本是否呈现 UTF-8 被误按 Latin-1/GBK 解码后的典型乱码。 */
export function looksGarbledText(value: string): boolean {
  if (!value) {
    return false;
  }
  return GARBLED_TEXT_PATTERNS.some((pattern) => pattern.test(value));
}

/** 对话消息乱码时统一隐藏，避免把损坏内容展示给用户。 */
export function sanitizeChatText(value: string): string {
  return looksGarbledText(value) ? "本条消息内容存在乱码，已隐藏。" : value;
}

/** 判断会话标题是否为开发测试数据或乱码。 */
export function isUnusableConversationTitle(value: string): boolean {
  if (!value) {
    return false;
  }
  const title = value.trim();
  return (
    looksGarbledText(title) ||
    /^(test|测试|调试|演示|demo|示例)(\s|$)/i.test(title)
  );
}

/** 将会话标题统一为可展示文本。 */
export function presentableConversationTitle(value: string): string {
  return isUnusableConversationTitle(value) ? "历史会话" : value;
}
