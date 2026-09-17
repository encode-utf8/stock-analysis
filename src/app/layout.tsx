import type { Metadata } from "next";
import type { ReactNode } from "react";

import { BackgroundCanvas } from "@/components/fx/BackgroundCanvas";
import { InteractionFX } from "@/components/fx/InteractionFX";

import "./globals.css";

export const metadata: Metadata = {
  title: "个股盘面分析",
  description: "本地运行的个股盘面分析与 AI 学习工具（工程骨架）",
};

/**
 * 根布局：中文界面基础框架。
 * 背景画布与交互光效层挂在最外层，业务内容始终渲染在它们之上。
 */
export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">
        <BackgroundCanvas />
        <InteractionFX />
        {children}
      </body>
    </html>
  );
}
