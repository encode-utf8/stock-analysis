"use client";

import { useState } from "react";

import { BackgroundSettingsEntry } from "@/components/panels/BackgroundSettingsEntry";
import { DataConsistencyEntry } from "@/components/panels/DataConsistencyEntry";
import FundWorkbench from "@/components/workbench/FundWorkbench";
import StockWorkbench from "@/components/workbench/StockWorkbench";
import {
  WorkbenchSwitcher,
  type WorkbenchId,
} from "@/components/workbench/WorkbenchSwitcher";

/** 页面 Shell：承载个股/基金工作台切换，两个工作台保持挂载以保留各自状态。 */
export default function Home() {
  const [workbench, setWorkbench] = useState<WorkbenchId>("stock");

  return (
    <main className="min-h-screen text-foreground">
      {/* 顶部条固定 68px 高（对应 CSS 变量 --app-header-h），工作台吸顶元素据此对齐。 */}
      <div className="sticky top-0 z-30 flex h-[68px] items-center justify-center border-b border-border bg-card/70 px-4 backdrop-blur-xl">
        <WorkbenchSwitcher value={workbench} onChange={setWorkbench} />
        {/* 右上角：背景与光效设置、数据一致性清理入口。 */}
        <div className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-2">
          <BackgroundSettingsEntry />
          <DataConsistencyEntry />
        </div>
        {/* 底部青光分隔线：强化顶部的科技层次。 */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent"
        />
      </div>

      <div className={workbench === "stock" ? "" : "hidden"}>
        <StockWorkbench />
      </div>
      <div className={workbench === "fund" ? "" : "hidden"}>
        <FundWorkbench />
      </div>
    </main>
  );
}
