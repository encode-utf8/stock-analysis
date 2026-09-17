"use client";

import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 页面正中间的自定义确认弹窗。 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "确认删除",
  cancelLabel = "取消",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // 弹窗统一挂到 body：避免被带毛玻璃/溢出裁剪的面板容器限制定位。
  // 弹窗只在用户交互后渲染（open 为 true），因此不存在服务端渲染阶段访问 document 的问题。
  if (!open) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="tech-panel w-full max-w-md overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-300">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-6 w-6"
                aria-hidden="true"
              >
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <h2 id="confirm-dialog-title" className="text-lg font-semibold tracking-tight text-foreground">
                {title}
              </h2>
              {description ? (
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{description}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onCancel}
              aria-label="关闭"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
                aria-hidden="true"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-border bg-muted/40 px-6 py-4">
          <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            className="bg-red-600 text-white hover:bg-red-500"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "处理中..." : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
