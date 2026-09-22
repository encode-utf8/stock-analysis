"use client";

import { useState } from "react";

import type { ModuleScope, ModuleScopeOption } from "@/components/panels/module-scope";

/** 横向模块菜单的选项定义，key 由各工作台自行约束。 */
export interface ModuleMenuOption<K extends string> {
  key: K;
  label: string;
}

interface ModuleMenuBarProps<K extends string> {
  /** 分组定义：当前标的 / 持仓与全局工具。 */
  scopes: readonly ModuleScopeOption[];
  activeScope: ModuleScope;
  onScopeChange: (scope: ModuleScope) => void;
  /** 各分组已勾选 / 总数，用于分组 tab 的计数。 */
  scopeStats: Record<ModuleScope, { enabled: number; total: number }>;
  /** 当前分组的说明文案（由工作台按分组与当前标的生成）。 */
  scopeNote?: string;
  /** 当前分组内可展示的模块（已按分组过滤），展示顺序以 moduleOrder 为准。 */
  options: readonly ModuleMenuOption<K>[];
  enabledModules: Record<K, boolean>;
  moduleOrder: K[];
  onToggleModule: (key: K) => void;
  onReorderModule: (fromKey: K, toKey: K) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}

/**
 * 横向功能模块菜单：替代原先侧栏内的纵向勾选列表。
 * 第一行按「是否随当前标的切换」分组切换，第二行单击勾选 / 拖拽排序当前分组的模块。
 */
export function ModuleMenuBar<K extends string>({
  scopes,
  activeScope,
  onScopeChange,
  scopeStats,
  scopeNote,
  options,
  enabledModules,
  moduleOrder,
  onToggleModule,
  onReorderModule,
  onSelectAll,
  onClearAll,
}: ModuleMenuBarProps<K>) {
  const [draggingKey, setDraggingKey] = useState<K | null>(null);
  const selectedCount = options.filter((option) => enabledModules[option.key]).length;

  return (
    <div className="sticky top-[var(--app-header-h)] z-20 rounded-xl border bg-card/80 px-3 py-2 shadow-sm backdrop-blur">
      {/* 分组切换：两类内容分离，避免持仓 / 日报等与标的视图混排。 */}
      <div className="flex flex-wrap items-center gap-2 border-b pb-2">
        <div
          role="tablist"
          aria-label="功能模块分组"
          className="flex shrink-0 items-center gap-0.5 rounded-lg border bg-muted/40 p-0.5"
        >
          {scopes.map((scope) => {
            const active = scope.key === activeScope;
            const stats = scopeStats[scope.key];
            return (
              <button
                key={scope.key}
                type="button"
                role="tab"
                aria-selected={active}
                title={scope.hint}
                onClick={() => onScopeChange(scope.key)}
                className={
                  "flex items-center rounded-md px-3 py-1 text-xs font-medium transition-colors " +
                  (active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground")
                }
              >
                {scope.label}
                <span className="ml-1.5 tabular-nums opacity-80">
                  {stats.enabled}/{stats.total}
                </span>
              </button>
            );
          })}
        </div>

        {scopeNote ? (
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{scopeNote}</p>
        ) : (
          <div className="flex-1" />
        )}

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onSelectAll}
            disabled={selectedCount === options.length}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            全选本组
          </button>
          <button
            type="button"
            onClick={onClearAll}
            disabled={selectedCount === 0}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            清空本组
          </button>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-sm font-semibold">功能模块</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
            {selectedCount}/{options.length}
          </span>
        </div>

        <div className="min-w-0 flex-1 overflow-x-auto">
          <div className="flex items-center gap-1.5 py-0.5">
            {moduleOrder.map((key) => {
              const option = options.find((item) => item.key === key);
              if (!option) {
                return null;
              }
              const enabled = enabledModules[key];
              return (
                <button
                  key={key}
                  type="button"
                  draggable
                  aria-pressed={enabled}
                  title="点击启用/停用该模块，拖拽可调整展示顺序"
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
                  onClick={() => onToggleModule(key)}
                  className={
                    "flex shrink-0 cursor-grab items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
                    (enabled
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground") +
                    (draggingKey === key ? " opacity-60" : "")
                  }
                >
                  {/* 勾选标记占位固定宽度，避免切换时按钮宽度跳动。 */}
                  <span aria-hidden="true" className="w-2.5 text-center">
                    {enabled ? "✓" : ""}
                  </span>
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
