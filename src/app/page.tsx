"use client";

import { useState } from "react";

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
    <main className="min-h-screen bg-muted/40 text-foreground">
      <div className="sticky top-0 z-20 flex justify-center border-b border-border bg-white/95 px-4 py-3 backdrop-blur">
        <WorkbenchSwitcher value={workbench} onChange={setWorkbench} />
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
