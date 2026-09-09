"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { FundWatchlistPanel } from "@/components/panels/fund/FundWatchlistPanel";

export const FUND_MODULE_OPTIONS = [
  { key: "profile", label: "基金档案" },
  { key: "nav", label: "净值走势" },
  { key: "intraday", label: "当日行情" },
  { key: "holdings", label: "持仓分析" },
  { key: "risk", label: "回撤与风险指标" },
  { key: "analysis", label: "AI 分析" },
  { key: "chat", label: "对话助手" },
  { key: "replay", label: "历史复盘" },
  { key: "comparison", label: "基金对比" },
  { key: "portfolio", label: "基金组合分析" },
  { key: "dca", label: "定投回测" },
  { key: "news", label: "行业资讯" },
  { key: "style", label: "风格因子分析" },
] as const;

export type FundModuleKey = (typeof FUND_MODULE_OPTIONS)[number]["key"];

const createFundModuleVisibility = (enabled: boolean) =>
  Object.fromEntries(FUND_MODULE_OPTIONS.map(({ key }) => [key, enabled])) as Record<
    FundModuleKey,
    boolean
  >;

export const DEFAULT_FUND_MODULE_VISIBILITY = createFundModuleVisibility(false);
export const ALL_FUND_MODULE_VISIBILITY = createFundModuleVisibility(true);

interface FundOptionsSidebarProps {
  input: string;
  loading: boolean;
  code: string | null;
  enabledModules: Record<FundModuleKey, boolean>;
  moduleOrder: FundModuleKey[];
  onInputChange: (value: string) => void;
  onSearch: () => void;
  onToggleModule: (key: FundModuleKey) => void;
  onReorderModule: (fromKey: FundModuleKey, toKey: FundModuleKey) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onWatchlistSelect: (code: string) => void;
  onWatchlistClearActive: () => void;
  pinned: boolean;
  onToggle: () => void;
}

/** 基金工作台左侧功能选项页：查询基金、勾选展示模块并管理自选基金。 */
export function FundOptionsSidebar({
  input,
  loading,
  code,
  enabledModules,
  moduleOrder,
  onInputChange,
  onSearch,
  onToggleModule,
  onReorderModule,
  onSelectAll,
  onClearAll,
  onWatchlistSelect,
  onWatchlistClearActive,
  pinned,
  onToggle,
}: FundOptionsSidebarProps) {
  const [draggingKey, setDraggingKey] = useState<FundModuleKey | null>(null);
  const selectedCount = Object.values(enabledModules).filter(Boolean).length;

  return (
    <aside className="flex h-screen w-full flex-col bg-white">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">功能选项</h2>
          <p className="text-xs text-muted-foreground">勾选模块后再展示对应信息区</p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-label={pinned ? "收拢功能侧栏" : "固定展开功能侧栏"}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-lg leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <span aria-hidden="true">{pinned ? "«" : "»"}</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <section className="border-b pb-4">
          <FundWatchlistPanel
            activeCode={code}
            onSelect={onWatchlistSelect}
            onClearActive={onWatchlistClearActive}
          />
        </section>

        <section className="space-y-2">
          <label htmlFor="fund-code-input" className="text-sm font-medium">
            基金代码
          </label>
          <input
            id="fund-code-input"
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSearch();
              }
            }}
            placeholder="留空则使用默认 510300"
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            aria-label="基金代码"
          />
          <p className="text-xs text-muted-foreground">留空时自动使用默认代码 510300。</p>
          <Button type="button" className="w-full" onClick={onSearch} disabled={loading}>
            {loading ? "查询中..." : "查询基金"}
          </Button>
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">功能模块</h3>
            <span className="text-xs text-muted-foreground">
              {selectedCount}/{FUND_MODULE_OPTIONS.length} 已选
            </span>
          </div>
          <div className="space-y-2">
            {moduleOrder.map((key) => {
              const option = FUND_MODULE_OPTIONS.find((item) => item.key === key);
              if (!option) {
                return null;
              }
              return (
                <label
                  key={key}
                  draggable
                  onDragStart={() => setDraggingKey(key)}
                  onDragEnd={() => setDraggingKey(null)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (draggingKey) {
                      onReorderModule(draggingKey, key);
                    }
                    setDraggingKey(null);
                  }}
                  className={
                    "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 transition-colors hover:bg-accent " +
                    (draggingKey === key ? "opacity-60" : "")
                  }
                  title="拖拽调整展示顺序"
                >
                  <span aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground">
                    ⠿
                  </span>
                  <input
                    type="checkbox"
                    checked={enabledModules[key]}
                    onChange={() => onToggleModule(key)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                  />
                  <span className="text-sm">{option.label}</span>
                </label>
              );
            })}
          </div>
        </section>

      </div>

      <div className="border-t p-3">
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onSelectAll}>
            全选
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onClearAll}>
            清空
          </Button>
        </div>
      </div>
    </aside>
  );
}
