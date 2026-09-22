"use client";

// 数据源故障全站提示条：固定在顶栏下方悬浮展示，滚动时始终位于页内内容之上。
// 提示条自身脱离文档流，改由 CSS 变量 --app-banner-h 驱动占位高度与页内吸顶偏移，
// 避免与模块菜单栏等吸顶元素同层互相遮挡。

import { useEffect, useLayoutEffect, useRef } from "react";

import { DatasourceUnavailableNotice } from "@/components/panels/DatasourceUnavailableNotice";
import { useDatasourceGuard } from "@/lib/datasource-guard-client";

/** 提示条高度（含下方留白）写入的 CSS 变量；0px 表示当前无提示。 */
const BANNER_HEIGHT_VAR = "--app-banner-h";

// 服务端渲染时 useLayoutEffect 会告警：服务端退化为 useEffect，客户端保持绘制前测量。
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** 全站数据源故障提示：无故障时不渲染。 */
export function DatasourceUnavailableBanner() {
  const datasourceGuard = useDatasourceGuard();
  const visible = Boolean(datasourceGuard.message);
  const bannerRef = useRef<HTMLDivElement | null>(null);

  // 量取提示条实际高度写入根元素：内容区据此占位、吸顶元素据此下移，
  // 文案换行或窗口尺寸变化时由 ResizeObserver 同步更新。
  useIsomorphicLayoutEffect(() => {
    const root = document.documentElement;
    const node = bannerRef.current;
    if (!visible || !node) {
      root.style.setProperty(BANNER_HEIGHT_VAR, "0px");
      return;
    }
    const sync = () => {
      root.style.setProperty(BANNER_HEIGHT_VAR, `${node.offsetHeight}px`);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.setProperty(BANNER_HEIGHT_VAR, "0px");
    };
  }, [visible]);

  if (!visible || !datasourceGuard.message) {
    return null;
  }
  return (
    <div
      ref={bannerRef}
      data-testid="datasource-unavailable-banner"
      className="fixed inset-x-0 top-[var(--app-header-h)] z-[60] mx-auto w-full max-w-[1440px] px-4 pb-3"
    >
      <DatasourceUnavailableNotice
        message={datasourceGuard.message}
        remainingSeconds={datasourceGuard.remainingSeconds}
      />
    </div>
  );
}