"use client";

// 轨迹设置入口：顶部设置栏按钮 + 下拉选项，控制执行轨迹结束后的留存方式。
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useAgentTracePolicy } from "@/lib/agent-trace-client";
import type { AgentTracePolicy } from "@/lib/shared/types";

/** 可选项定义：默认结束后清除，也可切换为折叠保留。 */
const POLICY_OPTIONS: Array<{ value: AgentTracePolicy; label: string; hint: string }> = [
  {
    value: "ephemeral",
    label: "结束后自动清除",
    hint: "默认：执行结束后移除轨迹，只保留最终结果。",
  },
  {
    value: "keep-collapsed",
    label: "结束后折叠保留",
    hint: "保留折叠的步骤与耗时摘要，可随时展开回看。",
  },
];

/** 轨迹留存策略设置入口。 */
export function AgentTraceSettingsEntry() {
  const [policy, setPolicy] = useAgentTracePolicy();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 点击面板外部或按 Esc 关闭下拉，避免遮挡其它设置。
  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        aria-haspopup="true"
      >
        轨迹显示
      </Button>
      {open ? (
        <div className="absolute right-0 top-[calc(100%+6px)] z-40 w-72 rounded-xl border border-border bg-card/95 p-3 text-xs shadow-lg backdrop-blur">
          <p className="font-medium text-foreground">执行轨迹留存</p>
          <div className="mt-2 space-y-1">
            {POLICY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPolicy(option.value)}
                aria-pressed={policy === option.value}
                className={
                  "w-full rounded-lg border px-2 py-1.5 text-left transition-colors " +
                  (policy === option.value
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-accent")
                }
              >
                <span className="flex items-center gap-2 font-medium text-foreground">
                  <span aria-hidden="true">{policy === option.value ? "●" : "○"}</span>
                  {option.label}
                </span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {option.hint}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}