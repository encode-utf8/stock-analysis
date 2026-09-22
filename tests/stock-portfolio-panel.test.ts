// 「我的持仓组合」面板的渲染冒烟测试。
// 仓库没有浏览器测试环境（无 jsdom），这里用服务端渲染兜住渲染期崩溃、默认表单形态与切换提示。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import { StockPortfolioPanel } from "@/components/panels/stock/StockPortfolioPanel";

describe("StockPortfolioPanel 渲染冒烟", () => {
  it("默认渲染出添加表单，且不出现切换提示", () => {
    const html = renderToStaticMarkup(createElement(StockPortfolioPanel));

    expect(html).toContain("我的持仓组合");
    expect(html).toContain("添加持仓");
    expect(html).toContain("还没有持仓记录");
    expect(html).not.toContain("点击标的名称可直接切换当前查询");
  });

  it("提供切换入口时渲染点击提示", () => {
    const html = renderToStaticMarkup(
      createElement(StockPortfolioPanel, { activeCode: "600000", onSelectTarget: () => {} }),
    );

    expect(html).toContain("点击标的名称可直接切换当前查询。");
    expect(html).toContain("当前：600000。");
  });
});
