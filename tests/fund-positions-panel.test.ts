// 「我的持有基金」面板的渲染冒烟测试。
// 仓库没有浏览器测试环境（无 jsdom），这里用服务端渲染兜住渲染期崩溃与默认表单形态。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import { FundPositionsPanel } from "@/components/panels/fund/FundPositionsPanel";

describe("FundPositionsPanel 渲染冒烟", () => {
  it("默认渲染出添加表单：有定投开关，未勾选时不出现计划参数", () => {
    const html = renderToStaticMarkup(createElement(FundPositionsPanel));

    expect(html).toContain("启用定投计划");
    expect(html).toContain("添加持有基金");
    expect(html).toContain("当前持有金额（元）");
    expect(html).toContain("累计收益口径");
    // 未勾选「启用定投计划」时不应出现计划参数输入。
    expect(html).not.toContain("定投频率");
    expect(html).not.toContain("每期金额（元）");
    expect(html).toContain("还没有持有记录");
  });

  it("提供切换入口时渲染点击提示，缺省时不出现该提示", () => {
    const withSwitch = renderToStaticMarkup(
      createElement(FundPositionsPanel, { activeCode: "110022", onSelectTarget: () => {} }),
    );
    expect(withSwitch).toContain("点击基金名称可直接切换当前查询。");
    // 当前查询基金不在持有列表时，提示退化为只显示代码。
    expect(withSwitch).toContain("当前：110022。");

    const withoutSwitch = renderToStaticMarkup(createElement(FundPositionsPanel));
    expect(withoutSwitch).not.toContain("点击基金名称可直接切换当前查询。");
  });
});