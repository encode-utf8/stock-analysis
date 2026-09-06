"use client";

import { useEffect, useState } from "react";

interface ToastProps {
  message: string;
}

/** 底部居中悬浮提示：显示后渐隐消失。 */
export function Toast({ message }: ToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const showTimer = window.setTimeout(() => setVisible(true), 10);
    const hideTimer = window.setTimeout(() => setVisible(false), 2_200);
    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
    };
  }, [message]);

  return (
    <div
      className={
        "pointer-events-none fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg transition-opacity duration-500 " +
        (visible ? "opacity-100" : "opacity-0")
      }
    >
      {message}
    </div>
  );
}
