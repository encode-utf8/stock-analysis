"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

interface ToastProps {
  message: string;
}

/** 空订阅：仅用于区分服务端与客户端快照，不监听任何外部事件。 */
function subscribeNever(): () => void {
  return () => {};
}

/** 底部居中悬浮提示：显示后渐隐消失。 */
export function Toast({ message }: ToastProps) {
  const [visible, setVisible] = useState(false);
  // 通过外部存储订阅判断是否已到客户端：SSR 阶段不渲染 Portal。
  const mounted = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  useEffect(() => {
    const showTimer = window.setTimeout(() => setVisible(true), 10);
    const hideTimer = window.setTimeout(() => setVisible(false), 2_200);
    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
    };
  }, [message]);

  if (!mounted) {
    return null;
  }

  return createPortal(
    <div
      className={
        "pointer-events-none fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-lg border border-border bg-popover px-4 py-2 text-sm text-popover-foreground shadow-lg shadow-cyan-500/10 backdrop-blur transition-opacity duration-500 " +
        (visible ? "opacity-100" : "opacity-0")
      }
    >
      {message}
    </div>,
    document.body,
  );
}
