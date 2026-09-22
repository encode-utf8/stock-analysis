// 工作台模块分组：校验分组划分、默认模块与顶部菜单的分组渲染。
// 仓库没有浏览器测试环境（无 jsdom），菜单部分用服务端渲染兜住渲染期崩溃与分组语义。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_MODULE_VISIBILITY,
  MODULE_OPTIONS,
  MODULE_SCOPES,
  type ModuleKey,
} from "@/components/panels/FunctionOptionsSidebar";
import {
  FUND_MODULE_OPTIONS,
  FUND_MODULE_SCOPES,
} from "@/components/panels/fund/FundOptionsSidebar";
import { ModuleMenuBar } from "@/components/panels/ModuleMenuBar";
import {
  hasEnabledInScope,
  moduleOptionsForScope,
  moduleVisibilityForScope,
  primaryModuleForScope,
} from "@/components/panels/module-scope";

/** 取分组下的模块键，便于与期望集合比对。 */
const keysOf = <K extends string>(options: readonly { key: K }[]): K[] => options.map((option) => option.key);

describe("模块分组划分", () => {
  it("个股工作台：随标的切换 8 项，与标的无关 5 项（数据源状态已移至右上角入口）", () => {
    expect(keysOf(moduleOptionsForScope(MODULE_OPTIONS, "target"))).toEqual([
      "quote",
      "chart",
      "indicators",
      "news",
      "analysis",
      "chat",
      "timeline",
      "replay",
    ]);
    expect(keysOf(moduleOptionsForScope(MODULE_OPTIONS, "global"))).toEqual([
      "portfolio",
      "backtest",
      "alerts",
      "daily-report",
      "observability",
    ]);
  });

  it("基金工作台：随标的切换 9 项（含行业资讯），与标的无关 7 项", () => {
    expect(keysOf(moduleOptionsForScope(FUND_MODULE_OPTIONS, "target"))).toEqual([
      "profile",
      "nav",
      "intraday",
      "holdings",
      "news",
      "risk",
      "analysis",
      "chat",
      "replay",
    ]);
    expect(keysOf(moduleOptionsForScope(FUND_MODULE_OPTIONS, "global"))).toEqual([
      "positions",
      "comparison",
      "portfolio",
      "dca",
      "style",
      "alerts",
      "daily-report",
    ]);
    // 行业资讯属于「当前标的」类：跟随当前基金取数，不再归入工具组。
    expect(FUND_MODULE_OPTIONS.find((option) => option.key === "news")?.scope).toBe("target");
  });

  it("分组无重复、无遗漏，且分组标签固定", () => {
    const all = keysOf(MODULE_OPTIONS);
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(
      moduleOptionsForScope(MODULE_OPTIONS, "target").length +
        moduleOptionsForScope(MODULE_OPTIONS, "global").length,
    );
    expect(MODULE_SCOPES.map((scope) => scope.label)).toEqual(["当前标的", "持仓与全局工具"]);
    expect(FUND_MODULE_SCOPES.map((scope) => scope.key)).toEqual(["target", "global"]);
  });

  it("默认模块取各分组第一个：个股行情概览 / 我的持仓组合，基金档案 / 持有基金", () => {
    expect(primaryModuleForScope(MODULE_OPTIONS, "target")?.key).toBe("quote");
    expect(primaryModuleForScope(MODULE_OPTIONS, "global")?.key).toBe("portfolio");
    expect(primaryModuleForScope(FUND_MODULE_OPTIONS, "target")?.key).toBe("profile");
    expect(primaryModuleForScope(FUND_MODULE_OPTIONS, "global")?.key).toBe("positions");
  });
});

describe("分组可见性与判定", () => {
  it("按组生成勾选集合时只包含本组模块", () => {
    const target = moduleVisibilityForScope(MODULE_OPTIONS, "target", true);
    expect(Object.keys(target).sort()).toEqual(
      keysOf(moduleOptionsForScope(MODULE_OPTIONS, "target")).sort(),
    );
    expect(Object.values(target).every(Boolean)).toBe(true);

    const cleared = moduleVisibilityForScope(MODULE_OPTIONS, "global", false);
    expect(Object.values(cleared).every((value) => value === false)).toBe(true);
    expect(Object.keys(cleared)).not.toContain("quote");
  });

  it("hasEnabledInScope 区分分组", () => {
    expect(hasEnabledInScope(MODULE_OPTIONS, "target", DEFAULT_MODULE_VISIBILITY)).toBe(false);
    expect(hasEnabledInScope(MODULE_OPTIONS, "global", DEFAULT_MODULE_VISIBILITY)).toBe(false);

    const onlyQuote: Record<ModuleKey, boolean> = { ...DEFAULT_MODULE_VISIBILITY, quote: true };
    expect(hasEnabledInScope(MODULE_OPTIONS, "target", onlyQuote)).toBe(true);
    expect(hasEnabledInScope(MODULE_OPTIONS, "global", onlyQuote)).toBe(false);
  });
});

describe("ModuleMenuBar 分组渲染", () => {
  const renderBar = (scope: "target" | "global", enabledModules: Record<ModuleKey, boolean>) =>
    renderToStaticMarkup(
      createElement(ModuleMenuBar, {
        scopes: MODULE_SCOPES,
        activeScope: scope,
        onScopeChange: () => {},
        scopeStats: { target: { enabled: 1, total: 8 }, global: { enabled: 2, total: 6 } },
        scopeNote: "当前标的：贵州茅台（600519）",
        options: moduleOptionsForScope(MODULE_OPTIONS, scope),
        enabledModules,
        moduleOrder: MODULE_OPTIONS.map((option) => option.key),
        onToggleModule: () => {},
        onReorderModule: () => {},
        onSelectAll: () => {},
        onClearAll: () => {},
      }),
    );

  it("渲染分组 tab 与分组计数，并只展示当前分组的模块", () => {
    const html = renderBar("target", { ...DEFAULT_MODULE_VISIBILITY, quote: true });

    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="功能模块分组"');
    expect(html).toContain("当前标的");
    expect(html).toContain("持仓与全局工具");
    expect(html).toContain("1/8");
    expect(html).toContain("2/6");
    expect(html).toContain("当前标的：贵州茅台（600519）");
    expect(html).toContain("行情概览");
    expect(html).toContain("历史复盘");
    // 全局分组模块不出现在当前分组的菜单里。
    expect(html).not.toContain("我的持仓组合");
    expect(html).not.toContain("AI 股市日报");
    // 本组计数与全选 / 清空文案。
    expect(html).toContain("全选本组");
    expect(html).toContain("清空本组");
  });

  it("切到全局分组后只展示与标的无关的模块", () => {
    const html = renderBar("global", DEFAULT_MODULE_VISIBILITY);

    expect(html).toContain("我的持仓组合");
    expect(html).toContain("AI 股市日报");
    expect(html).not.toContain("行情概览");
    expect(html).not.toContain("K 线走势");
  });
});
