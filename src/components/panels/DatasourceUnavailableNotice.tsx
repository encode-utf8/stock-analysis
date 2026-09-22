"use client";

// 数据源故障提示：统一展示提示文案与剩余冷却秒数，供各功能入口复用。

interface DatasourceUnavailableNoticeProps {
  /** 提示文案；为空时不渲染。 */
  message: string | null;
  /** 剩余冷却秒数；大于 0 时展示倒计时。 */
  remainingSeconds: number;
  /** 追加的样式类名。 */
  className?: string;
}

/** 数据源故障提示条。 */
export function DatasourceUnavailableNotice({
  message,
  remainingSeconds,
  className,
}: DatasourceUnavailableNoticeProps) {
  if (!message) {
    return null;
  }
  return (
    <div
      role="status"
      aria-live="polite"
      className={
        "rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200 " +
        (className ?? "")
      }
    >
      {message}
      {remainingSeconds > 0 ? `（${remainingSeconds} 秒后可重试）` : null}
    </div>
  );
}