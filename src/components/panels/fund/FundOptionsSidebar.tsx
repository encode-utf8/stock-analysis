"use client";

import { Button } from "@/components/ui/button";
import { FundWatchlistPanel } from "@/components/panels/fund/FundWatchlistPanel";

export const FUND_MODULE_OPTIONS = [
  { key: "positions", label: "持有基金" },
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
  { key: "alerts", label: "预警中心" },
  { key: "daily-report", label: "AI 基金日报" },
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
  onInputChange: (value: string) => void;
  onSearch: () => void;
  onWatchlistSelect: (code: string) => void;
  onWatchlistClearActive: () => void;
  pinned: boolean;
  onToggle: () => void;
}

/**
 * 基金工作台左侧自选与查询栏：查询基金代码并管理自选基金。
 * 模块切换已移至内容区顶部的横向菜单（ModuleMenuBar），侧栏不再承载模块列表。
 */
export function FundOptionsSidebar({
  input,
  loading,
  code,
  onInputChange,
  onSearch,
  onWatchlistSelect,
  onWatchlistClearActive,
  pinned,
  onToggle,
}: FundOptionsSidebarProps) {
  return (
    <aside className="flex h-full w-full flex-col bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">自选与查询</h2>
          <p className="text-xs text-muted-foreground">模块切换见顶部「功能模块」菜单</p>
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

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section className="space-y-2">
          <label htmlFor="fund-code-input" className="text-sm font-medium">
            基金代码
          </label>
          {/* 输入框与查询按钮同行，压缩侧栏高度。 */}
          <div className="flex gap-2">
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
              placeholder="留空使用 510300"
              className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
              aria-label="基金代码"
            />
            <Button
              type="button"
              className="shrink-0"
              onClick={onSearch}
              disabled={loading}
            >
              {loading ? "查询中..." : "查询"}
            </Button>
          </div>
        </section>

        <section className="border-t pt-4">
          <FundWatchlistPanel
            activeCode={code}
            onSelect={onWatchlistSelect}
            onClearActive={onWatchlistClearActive}
          />
        </section>
      </div>
    </aside>
  );
}
