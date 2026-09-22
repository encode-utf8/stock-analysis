"use client";

// 数据源故障全站提示条：吸顶展示故障文案与剩余冷却秒数。

import { useDatasourceGuard } from "@/lib/datasource-guard-client";
import { DatasourceUnavailableNotice } from "@/components/panels/DatasourceUnavailableNotice";

/** 全站数据源故障提示：无故障时不渲染。 */
export function DatasourceUnavailableBanner() {
  const datasourceGuard = useDatasourceGuard();
  if (!datasourceGuard.message) {
    return null;
  }
  return (
    <div
      data-testid="datasource-unavailable-banner"
      className="sticky top-[68px] z-20 mx-auto w-full max-w-[1440px] px-4 pt-3"
    >
      <DatasourceUnavailableNotice
        message={datasourceGuard.message}
        remainingSeconds={datasourceGuard.remainingSeconds}
      />
    </div>
  );
}