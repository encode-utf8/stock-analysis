"use client";

// 数据源故障提示：统一展示提示文案与剩余冷却秒数，供各功能入口复用。
// 视觉采用高对比错误色 + 警告图标：与页内常态信息提示明确区分，故障语义一眼可辨。

interface DatasourceUnavailableNoticeProps {
  /** 提示文案；为空时不渲染。 */
  message: string | null;
  /** 剩余冷却秒数；大于 0 时展示倒计时。 */
  remainingSeconds: number;
  /** 追加的样式类名。 */
  className?: string;
}

/** 警告三角图标：内联 SVG，避免额外资源依赖。 */
function DatasourceWarnIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={className}>
      <path
        fillRule="evenodd"
        d="M10 2.6c.4 0 .77.21.97.56l7 12A1.12 1.12 0 0 1 17 16.85H3a1.12 1.12 0 0 1-.97-1.69l7-12c.2-.35.57-.56.97-.56Zm0 4.15a.9.9 0 0 0-.9.9v3.6a.9.9 0 0 0 1.8 0v-3.6a.9.9 0 0 0-.9-.9Zm0 8.3a1.05 1.05 0 1 0 0-2.1 1.05 1.05 0 0 0 0 2.1Z"
        clipRule="evenodd"
      />
    </svg>
  );
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
        "flex items-center gap-2.5 rounded-xl border-2 border-red-400/70 bg-red-600 " +
        "px-3.5 py-2 text-sm font-medium text-white shadow-lg shadow-red-950/50 " +
        (className ?? "")
      }
    >
      <DatasourceWarnIcon className="h-4 w-4 shrink-0 text-red-50" />
      <p className="min-w-0 flex-1 leading-5">{message}</p>
      {remainingSeconds > 0 ? (
        <span className="shrink-0 rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold tabular-nums">
          {remainingSeconds} 秒后可重试
        </span>
      ) : null}
    </div>
  );
}