"use client";

import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";

interface NoticeDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  onClose: () => void;
}

/** 单按钮提示弹窗：用于「当前无数据」这类只需告知、无需二次确认的场景。 */
export function NoticeDialog({
  open,
  title,
  description,
  confirmLabel = "知道了",
  onClose,
}: NoticeDialogProps) {
  // 与确认弹窗一致：挂到 body，避免被面板容器的毛玻璃或溢出裁剪影响定位。
  if (!open) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="notice-dialog-title"
        className="tech-panel w-full max-w-md overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-300">
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
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8h.01" />
                <path d="M11 12h1v4h1" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <h2 id="notice-dialog-title" className="text-lg font-semibold tracking-tight text-foreground">
                {title}
              </h2>
              {description ? (
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{description}</p>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex justify-end border-t border-border bg-muted/40 px-6 py-4">
          <Button type="button" onClick={onClose}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
