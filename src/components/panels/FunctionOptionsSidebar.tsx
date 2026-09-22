"use client";

import { createModuleScopes } from "@/components/panels/module-scope";
import { Button } from "@/components/ui/button";
import { WatchlistSidebar } from "@/components/panels/WatchlistSidebar";

/**
 * 个股工作台模块：`scope` 区分是否随当前股票切换。
 * 顺序即默认展示顺序，各分组的第一个模块作为该组默认视图（行情概览 / 我的持仓组合）。
 */
export const MODULE_OPTIONS = [
  { key: "quote", label: "行情概览", scope: "target" },
  { key: "chart", label: "K 线走势", scope: "target" },
  { key: "indicators", label: "技术指标", scope: "target" },
  { key: "news", label: "资讯搜索", scope: "target" },
  { key: "analysis", label: "周期内 AI 分析", scope: "target" },
  { key: "chat", label: "对话助手", scope: "target" },
  { key: "timeline", label: "历史会话时间线", scope: "target" },
  { key: "replay", label: "历史复盘", scope: "target" },
  { key: "portfolio", label: "我的持仓组合", scope: "global" },
  { key: "backtest", label: "策略回测", scope: "global" },
  { key: "datasource", label: "数据源与调度", scope: "global" },
  { key: "alerts", label: "预警中心", scope: "global" },
  { key: "daily-report", label: "AI 股市日报", scope: "global" },
  { key: "observability", label: "系统可观测性", scope: "global" },
] as const;

export type ModuleKey = (typeof MODULE_OPTIONS)[number]["key"];

/** 个股工作台的分组说明（tab 悬浮提示）。 */
export const MODULE_SCOPES = createModuleScopes({
  target: "随当前股票切换：行情、K 线、指标、资讯、AI 分析、对话与复盘",
  global: "与当前股票无关：持仓、回测、预警、日报、数据源与可观测性",
});

const createModuleVisibility = (enabled: boolean) =>
  Object.fromEntries(MODULE_OPTIONS.map(({ key }) => [key, enabled])) as Record<
    ModuleKey,
    boolean
  >;

export const DEFAULT_MODULE_VISIBILITY = createModuleVisibility(false);

interface FunctionOptionsSidebarProps {
  input: string;
  loading: boolean;
  code: string | null;
  activeCode: string | null;
  onInputChange: (value: string) => void;
  onSearch: () => void;
  onRefresh: () => void;
  onCleanup: () => void;
  onWatchlistSelect: (code: string) => void;
  onWatchlistClearActive: () => void;
  pinned: boolean;
  onToggle: () => void;
  /** 数据源故障冷却中：禁用查询与刷新，避免连续点击。 */
  blocked?: boolean;
}

/**
 * 左侧自选与查询栏：顶部查询股票，下方管理自选股。
 * 模块切换已移至内容区顶部的横向菜单（ModuleMenuBar），侧栏不再承载模块列表。
 */
export function FunctionOptionsSidebar({
  input,
  loading,
  code,
  activeCode,
  onInputChange,
  onSearch,
  onRefresh,
  onCleanup,
  onWatchlistSelect,
  onWatchlistClearActive,
  pinned,
  onToggle,
  blocked = false,
}: FunctionOptionsSidebarProps) {
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
          <label htmlFor="stock-code-input" className="text-sm font-medium">
            股票代码
          </label>
          {/* 输入框与查询按钮同行，压缩侧栏高度。 */}
          <div className="flex gap-2">
            <input
              id="stock-code-input"
              value={input}
              onChange={(event) => onInputChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onSearch();
                }
              }}
              placeholder="留空使用 600519"
              className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
              aria-label="股票代码"
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
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={!code || loading || blocked}
            >
              强制刷新
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onCleanup}>
              清理到期资讯
            </Button>
          </div>
        </section>

        <section className="border-t pt-4">
          <WatchlistSidebar
            activeCode={activeCode}
            onSelect={onWatchlistSelect}
            onClearActive={onWatchlistClearActive}
          />
        </section>
      </div>
    </aside>
  );
}
