"use client";

import type { ReactNode } from "react";

interface TargetSwitchCellProps {
  /** 标的代码：点击后作为新的查询目标。 */
  code: string;
  /** 标的名称：用于展示与无障碍提示。 */
  name: string;
  /** 是否为当前正在查询的标的。 */
  active?: boolean;
  /** 切换回调；缺省时退化为静态文本，保持其它复用场景不变。 */
  onSelect?: (code: string) => void;
  /** 名称行的补充徽标（如「定投」）。 */
  badges?: ReactNode;
  /** 名称与代码下方的补充说明（定投计划描述、备注等）。 */
  extra?: ReactNode;
}

/**
 * 持仓 / 持有列表的标的单元格：点击名称即可切换到该标的的当前查询，
 * 并高亮当前查询项；未提供切换回调时退化为静态文本。
 */
export function TargetSwitchCell({
  code,
  name,
  active = false,
  onSelect,
  badges,
  extra,
}: TargetSwitchCellProps) {
  const nameRow = (nameClass: string) => (
    <div className="flex items-center gap-1.5">
      <span className={nameClass}>{name}</span>
      {badges}
      {active ? (
        <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
          当前
        </span>
      ) : null}
    </div>
  );

  const detail = (
    <>
      <div className="text-xs text-muted-foreground">{code}</div>
      {extra}
    </>
  );

  if (!onSelect) {
    return (
      <div>
        {nameRow("font-medium")}
        {detail}
      </div>
    );
  }

  const label = `切换到 ${name}（${code}）`;
  return (
    <button
      type="button"
      onClick={() => onSelect(code)}
      title={label}
      aria-label={label}
      className={
        "group -mx-1 block w-full rounded-md px-1 py-0.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
        (active ? "bg-primary/5 ring-1 ring-primary/40" : "")
      }
    >
      {nameRow("font-medium group-hover:text-primary")}
      {detail}
    </button>
  );
}
