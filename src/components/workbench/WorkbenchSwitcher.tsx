"use client";

export type WorkbenchId = "stock" | "fund";

interface WorkbenchSwitcherProps {
  value: WorkbenchId;
  onChange: (value: WorkbenchId) => void;
}

const WORKBENCH_OPTIONS: Array<{ id: WorkbenchId; label: string }> = [
  { id: "stock", label: "个股工作台" },
  { id: "fund", label: "基金工作台" },
];

/** 顶部全局工作台切换控件。 */
export function WorkbenchSwitcher({ value, onChange }: WorkbenchSwitcherProps) {
  return (
    <div
      role="tablist"
      aria-label="工作台切换"
      className="inline-flex rounded-lg border bg-white p-1 shadow-sm"
    >
      {WORKBENCH_OPTIONS.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.id)}
            className={
              "rounded-md px-4 py-2 text-sm font-medium transition-colors " +
              (active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-foreground")
            }
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
