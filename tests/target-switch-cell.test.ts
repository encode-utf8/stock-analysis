// 共享组件 TargetSwitchCell 的渲染冒烟：可点击形态、静态形态与「当前」标记。
// 仓库没有浏览器测试环境（无 jsdom），这里用服务端渲染兜住渲染期崩溃与关键语义。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import { TargetSwitchCell } from "@/components/panels/TargetSwitchCell";

describe("TargetSwitchCell 渲染冒烟", () => {
  it("传入切换回调时渲染为可点击按钮，并带无障碍文案", () => {
    const html = renderToStaticMarkup(
      createElement(TargetSwitchCell, {
        code: "600519",
        name: "贵州茅台",
        onSelect: () => {},
      }),
    );

    expect(html).toContain("<button");
    expect(html).toContain('aria-label="切换到 贵州茅台（600519）"');
    expect(html).toContain('title="切换到 贵州茅台（600519）"');
    expect(html).toContain("贵州茅台");
    expect(html).toContain("600519");
  });

  it("未传切换回调时退化为静态文本，不渲染按钮", () => {
    const html = renderToStaticMarkup(
      createElement(TargetSwitchCell, { code: "600519", name: "贵州茅台" }),
    );

    expect(html).not.toContain("<button");
    expect(html).toContain("贵州茅台");
    expect(html).toContain("600519");
  });

  it("命中当前标的时展示「当前」标记，并渲染补充徽标与说明", () => {
    const html = renderToStaticMarkup(
      createElement(TargetSwitchCell, {
        code: "110022",
        name: "易方达消费行业",
        active: true,
        onSelect: () => {},
        badges: createElement("span", null, "定投"),
        extra: createElement("div", null, "备注：长期持有"),
      }),
    );

    expect(html).toContain("当前");
    expect(html).toContain("定投");
    expect(html).toContain("备注：长期持有");
  });

  it("非当前标的时不展示「当前」标记", () => {
    const html = renderToStaticMarkup(
      createElement(TargetSwitchCell, {
        code: "110022",
        name: "易方达消费行业",
        onSelect: () => {},
      }),
    );

    expect(html).not.toContain("当前");
    expect(html).toContain("<button");
  });
});
