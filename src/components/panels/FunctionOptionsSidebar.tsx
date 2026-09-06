"use client";

import { Button } from "@/components/ui/button";
import { WatchlistSidebar } from "@/components/panels/WatchlistSidebar";

export const MODULE_OPTIONS = [
  { key: "quote", label: "行情概览" },
  { key: "chart", label: "K 线走势" },
  { key: "indicators", label: "技术指标" },
  { key: "news", label: "资讯搜索" },
  { key: "analysis", label: "周期内 AI 分析" },
  { key: "chat", label: "对话助手" },
  { key: "timeline", label: "历史会话时间线" },
  { key: "observability", label: "系统可观测性" },
  { key: "replay", label: "历史复盘" },
  { key: "datasource", label: "数据源与调度" },
] as const;

export type ModuleKey = (typeof MODULE_OPTIONS)[number]["key"];

const createModuleVisibility = (enabled: boolean) =>
  Object.fromEntries(MODULE_OPTIONS.map(({ key }) => [key, enabled])) as Record<
    ModuleKey,
    boolean
  >;

export const DEFAULT_MODULE_VISIBILITY = createModuleVisibility(false);
export const ALL_MODULE_VISIBILITY = createModuleVisibility(true);

interface FunctionOptionsSidebarProps {
  input: string;
  loading: boolean;
  code: string | null;
  activeCode: string | null;
  enabledModules: Record<ModuleKey, boolean>;
  onInputChange: (value: string) => void;
  onSearch: () => void;
  onRefresh: () => void;
  onCleanup: () => void;
  onToggleModule: (key: ModuleKey) => void;
  onWatchlistSelect: (code: string) => void;
  onWatchlistClearActive: () => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  pinned: boolean;
  onToggle: () => void;
}

/** 左侧可隐藏功能选项页：顶部查询股票，下方勾选展示模块。 */
export function FunctionOptionsSidebar({
  input,
  loading,
  code,
  activeCode,
  enabledModules,
  onInputChange,
  onSearch,
  onRefresh,
  onCleanup,
  onToggleModule,
  onWatchlistSelect,
  onWatchlistClearActive,
  onSelectAll,
  onClearAll,
  pinned,
  onToggle,
}: FunctionOptionsSidebarProps) {
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
        <section className="space-y-2">
          <label htmlFor="stock-code-input" className="text-sm font-medium">
            股票代码
          </label>
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
            placeholder="留空则使用默认 600519"
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            aria-label="股票代码"
          />
          <p className="text-xs text-muted-foreground">留空时自动使用默认代码 600519。</p>
          <Button type="button" className="w-full" onClick={onSearch} disabled={loading}>
            {loading ? "查询中..." : "查询股票"}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={!code || loading}
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

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">功能模块</h3>
            <span className="text-xs text-muted-foreground">
              {selectedCount}/{MODULE_OPTIONS.length} 已选
            </span>
          </div>
          <div className="space-y-2">
            {MODULE_OPTIONS.map((option) => (
              <label
                key={option.key}
                className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 transition-colors hover:bg-accent"
              >
                <input
                  type="checkbox"
                  checked={enabledModules[option.key]}
                  onChange={() => onToggleModule(option.key)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                />
                <span className="text-sm">{option.label}</span>
              </label>
            ))}
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
