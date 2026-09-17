"use client";

import { useState } from "react";

/** 横向模块菜单的选项定义，key 由各工作台自行约束。 */
export interface ModuleMenuOption<K extends string> {
  key: K;
  label: string;
}

interface ModuleMenuBarProps<K extends string> {
  /** 全部可展示模块，展示顺序以 moduleOrder 为准。 */
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
 * 单击切换模块显隐，拖拽调整展示顺序，右端提供全选/清空。
 */
export function ModuleMenuBar<K extends string>({
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
      <div className="flex items-center gap-3">
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

        <div className="flex shrink-0 items-center gap-1 border-l pl-3">
          <button
            type="button"
            onClick={onSelectAll}
            disabled={selectedCount === options.length}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            全选
          </button>
          <button
            type="button"
            onClick={onClearAll}
            disabled={selectedCount === 0}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            清空
          </button>
        </div>
      </div>
    </div>
  );
}
