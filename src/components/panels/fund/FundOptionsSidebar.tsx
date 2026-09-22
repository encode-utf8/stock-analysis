"use client";

import { createModuleScopes } from "@/components/panels/module-scope";
import { Button } from "@/components/ui/button";
import { FundWatchlistPanel } from "@/components/panels/fund/FundWatchlistPanel";

/**
 * 基金工作台模块：`scope` 区分是否随当前基金切换。
 * 顺序即默认展示顺序，各分组的第一个模块作为该组默认视图（基金档案 / 持有基金）。
 */
export const FUND_MODULE_OPTIONS = [
  { key: "profile", label: "基金档案", scope: "target" },
  { key: "nav", label: "净值走势", scope: "target" },
  { key: "intraday", label: "当日行情", scope: "target" },
  { key: "holdings", label: "持仓分析", scope: "target" },
  { key: "news", label: "行业资讯", scope: "target" },
  { key: "risk", label: "回撤与风险指标", scope: "target" },
  { key: "analysis", label: "AI 分析", scope: "target" },
  { key: "chat", label: "对话助手", scope: "target" },
  { key: "replay", label: "历史复盘", scope: "target" },
  { key: "positions", label: "持有基金", scope: "global" },
  { key: "comparison", label: "基金对比", scope: "global" },
  { key: "portfolio", label: "基金组合分析", scope: "global" },
  { key: "dca", label: "定投回测", scope: "global" },
  { key: "style", label: "风格因子分析", scope: "global" },
  { key: "alerts", label: "预警中心", scope: "global" },
  { key: "daily-report", label: "AI 基金日报", scope: "global" },
] as const;

export type FundModuleKey = (typeof FUND_MODULE_OPTIONS)[number]["key"];

/** 基金工作台的分组说明（tab 悬浮提示）。 */
export const FUND_MODULE_SCOPES = createModuleScopes({
  target: "随当前基金切换：档案、净值、当日行情、持仓、行业资讯、风险、AI 分析、对话与复盘",
  global: "与当前基金无关：持有基金、对比 / 组合 / 定投 / 风格（自带代码输入）与预警、日报",
});

const createFundModuleVisibility = (enabled: boolean) =>
  Object.fromEntries(FUND_MODULE_OPTIONS.map(({ key }) => [key, enabled])) as Record<
    FundModuleKey,
    boolean
  >;

export const DEFAULT_FUND_MODULE_VISIBILITY = createFundModuleVisibility(false);

interface FundOptionsSidebarProps {
  input: string;
  loading: boolean;
  code: string | null;
  onInputChange: (value: string) => void;
  onSearch: () => void;
  onWatchlistSelect: (code: string) => void;
  onWatchlistClearActive: () => void;
  /** 数据源故障冷却中：禁用查询按钮，避免连续点击。 */
  blocked?: boolean;
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
  blocked = false,
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
              disabled={loading || blocked}
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
