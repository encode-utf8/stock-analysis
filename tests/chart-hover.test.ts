// 图表悬停坐标换算测试：覆盖宽高比不一致产生的居中留白，以及尺寸异常与边界钳制。
import { describe, expect, it } from "vitest";

import { resolveHoverIndex, resolveMeetTransform } from "@/lib/chart-hover";

// 与 BacktestEquityChart 保持一致：viewBox 900×320，绘图区左右内边距 78/18。
const VIEW_BOX_WIDTH = 900;
const VIEW_BOX_HEIGHT = 320;
const PADDING_LEFT = 78;
const PADDING_RIGHT = 18;
const POINT_COUNT = 100;
/** 绘图区宽度：900 - 78 - 18。 */
const PLOT_WIDTH = VIEW_BOX_WIDTH - PADDING_LEFT - PADDING_RIGHT;

/** 把绘图区内的相对位置换算成视口 X 坐标，便于编写断言。 */
function clientXAtRatio(box: { left: number; width: number; height: number }, ratio: number): number {
  const scale = Math.min(box.width / VIEW_BOX_WIDTH, box.height / VIEW_BOX_HEIGHT);
  const offsetX = (box.width - VIEW_BOX_WIDTH * scale) / 2;
  const contentX = PADDING_LEFT + ratio * PLOT_WIDTH;
  return box.left + offsetX + contentX * scale;
}

describe("resolveMeetTransform", () => {
  it("元素比 viewBox 更宽时，等比缩放后左右居中留白", () => {
    // h-72(288px) + w-full(1096px)：受高度限制按 288/320 缩放，内容只有 810px 宽。
    const transform = resolveMeetTransform({ width: 1096, height: 288 }, VIEW_BOX_WIDTH, VIEW_BOX_HEIGHT);

    expect(transform).not.toBeNull();
    expect(transform?.scale).toBeCloseTo(0.9, 6);
    expect(transform?.offsetX).toBeCloseTo(143, 6);
    expect(transform?.offsetY).toBeCloseTo(0, 6);
  });

  it("元素比 viewBox 更窄时，等比缩放后上下居中留白", () => {
    const transform = resolveMeetTransform({ width: 450, height: 288 }, VIEW_BOX_WIDTH, VIEW_BOX_HEIGHT);

    expect(transform?.scale).toBeCloseTo(0.5, 6);
    expect(transform?.offsetX).toBeCloseTo(0, 6);
    expect(transform?.offsetY).toBeCloseTo(64, 6);
  });

  it("尺寸非法时返回 null", () => {
    expect(resolveMeetTransform({ width: 0, height: 288 }, VIEW_BOX_WIDTH, VIEW_BOX_HEIGHT)).toBeNull();
    expect(resolveMeetTransform({ width: 1096, height: 0 }, VIEW_BOX_WIDTH, VIEW_BOX_HEIGHT)).toBeNull();
    expect(resolveMeetTransform({ width: 1096, height: 288 }, 0, VIEW_BOX_HEIGHT)).toBeNull();
    expect(resolveMeetTransform({ width: Number.NaN, height: 288 }, VIEW_BOX_WIDTH, VIEW_BOX_HEIGHT)).toBeNull();
  });
});

describe("resolveHoverIndex：左右留白（宽屏固定高度）", () => {
  const box = { left: 0, top: 0, width: 1096, height: 288 };

  it("绘图区左边缘取到首个数据点，而不是被留白挤到中间", () => {
    // 修复前按整幅 1096px 线性映射，同一光标会落到第 12 个点，产生明显错位。
    const index = resolveHoverIndex({
      clientX: clientXAtRatio(box, 0),
      box,
      viewBoxWidth: VIEW_BOX_WIDTH,
      viewBoxHeight: VIEW_BOX_HEIGHT,
      paddingLeft: PADDING_LEFT,
      paddingRight: PADDING_RIGHT,
      count: POINT_COUNT,
    });

    expect(index).toBe(0);
  });

  it("绘图区右边缘取到末个数据点", () => {
    const index = resolveHoverIndex({
      clientX: clientXAtRatio(box, 1),
      box,
      viewBoxWidth: VIEW_BOX_WIDTH,
      viewBoxHeight: VIEW_BOX_HEIGHT,
      paddingLeft: PADDING_LEFT,
      paddingRight: PADDING_RIGHT,
      count: POINT_COUNT,
    });

    expect(index).toBe(POINT_COUNT - 1);
  });

  it("绘图区中点取到中间数据点", () => {
    const index = resolveHoverIndex({
      clientX: clientXAtRatio(box, 0.5),
      box,
      viewBoxWidth: VIEW_BOX_WIDTH,
      viewBoxHeight: VIEW_BOX_HEIGHT,
      paddingLeft: PADDING_LEFT,
      paddingRight: PADDING_RIGHT,
      count: POINT_COUNT,
    });

    expect(index).toBe(50);
  });

  it("四分位点与数据点索引成比例", () => {
    const index = resolveHoverIndex({
      clientX: clientXAtRatio(box, 0.25),
      box,
      viewBoxWidth: VIEW_BOX_WIDTH,
      viewBoxHeight: VIEW_BOX_HEIGHT,
      paddingLeft: PADDING_LEFT,
      paddingRight: PADDING_RIGHT,
      count: POINT_COUNT,
    });

    expect(index).toBe(25);
  });
});

describe("resolveHoverIndex：其它尺寸与边界", () => {
  it("元素宽高比与 viewBox 一致时按整幅宽度映射", () => {
    const box = { left: 0, top: 0, width: 900, height: 320 };

    expect(
      resolveHoverIndex({
        clientX: 78,
        box,
        viewBoxWidth: VIEW_BOX_WIDTH,
        viewBoxHeight: VIEW_BOX_HEIGHT,
        paddingLeft: PADDING_LEFT,
        paddingRight: PADDING_RIGHT,
        count: POINT_COUNT,
      }),
    ).toBe(0);
    expect(
      resolveHoverIndex({
        clientX: 882,
        box,
        viewBoxWidth: VIEW_BOX_WIDTH,
        viewBoxHeight: VIEW_BOX_HEIGHT,
        paddingLeft: PADDING_LEFT,
        paddingRight: PADDING_RIGHT,
        count: POINT_COUNT,
      }),
    ).toBe(POINT_COUNT - 1);
  });

  it("元素整体偏移（侧边栏/滚动）时按 left 换算", () => {
    const box = { left: 240, top: 0, width: 900, height: 320 };

    expect(
      resolveHoverIndex({
        clientX: 240 + 78,
        box,
        viewBoxWidth: VIEW_BOX_WIDTH,
        viewBoxHeight: VIEW_BOX_HEIGHT,
        paddingLeft: PADDING_LEFT,
        paddingRight: PADDING_RIGHT,
        count: POINT_COUNT,
      }),
    ).toBe(0);
  });

  it("窄屏上下留白不影响水平取值", () => {
    const box = { left: 0, top: 0, width: 450, height: 288 };

    expect(
      resolveHoverIndex({
        clientX: 0 + 78 * 0.5,
        box,
        viewBoxWidth: VIEW_BOX_WIDTH,
        viewBoxHeight: VIEW_BOX_HEIGHT,
        paddingLeft: PADDING_LEFT,
        paddingRight: PADDING_RIGHT,
        count: POINT_COUNT,
      }),
    ).toBe(0);
    expect(
      resolveHoverIndex({
        clientX: 882 * 0.5,
        box,
        viewBoxWidth: VIEW_BOX_WIDTH,
        viewBoxHeight: VIEW_BOX_HEIGHT,
        paddingLeft: PADDING_LEFT,
        paddingRight: PADDING_RIGHT,
        count: POINT_COUNT,
      }),
    ).toBe(POINT_COUNT - 1);
  });

  it("鼠标越出绘图区时钳制到首尾数据点", () => {
    const box = { left: 0, top: 0, width: 1096, height: 288 };
    const base = {
      box,
      viewBoxWidth: VIEW_BOX_WIDTH,
      viewBoxHeight: VIEW_BOX_HEIGHT,
      paddingLeft: PADDING_LEFT,
      paddingRight: PADDING_RIGHT,
      count: POINT_COUNT,
    };

    // 左侧留白范围内、以及元素之外，都落到首个点。
    expect(resolveHoverIndex({ ...base, clientX: 143 })).toBe(0);
    expect(resolveHoverIndex({ ...base, clientX: -50 })).toBe(0);
    // 右侧留白范围内、以及元素之外，都落到末个点。
    expect(resolveHoverIndex({ ...base, clientX: 1100 })).toBe(POINT_COUNT - 1);
    expect(resolveHoverIndex({ ...base, clientX: 5000 })).toBe(POINT_COUNT - 1);
  });

  it("尺寸非法、绘图区宽度非正或数据点不足时返回 null", () => {
    const box = { left: 0, top: 0, width: 1096, height: 288 };
    const base = {
      clientX: 400,
      box,
      viewBoxWidth: VIEW_BOX_WIDTH,
      viewBoxHeight: VIEW_BOX_HEIGHT,
      paddingLeft: PADDING_LEFT,
      paddingRight: PADDING_RIGHT,
      count: POINT_COUNT,
    };

    expect(resolveHoverIndex({ ...base, count: 1 })).toBeNull();
    expect(resolveHoverIndex({ ...base, box: { ...box, width: 0 } })).toBeNull();
    expect(resolveHoverIndex({ ...base, box: { ...box, height: 0 } })).toBeNull();
    expect(resolveHoverIndex({ ...base, paddingLeft: 890, paddingRight: 20 })).toBeNull();
  });
});

describe("resolveHoverIndex：铺满卡片（自然宽高比）", () => {
  /** 元素宽高比与 viewBox 一致时，元素宽度就是缩放基准，不存在居中留白。 */
  function naturalBox(width: number, left = 0) {
    return { left, top: 0, width, height: (width * VIEW_BOX_HEIGHT) / VIEW_BOX_WIDTH };
  }

  it("宽屏下曲线铺满卡片，取值与绘图区对齐", () => {
    const box = naturalBox(1096, 24);
    const base = {
      box,
      viewBoxWidth: VIEW_BOX_WIDTH,
      viewBoxHeight: VIEW_BOX_HEIGHT,
      paddingLeft: PADDING_LEFT,
      paddingRight: PADDING_RIGHT,
      count: POINT_COUNT,
    };

    expect(resolveHoverIndex({ ...base, clientX: clientXAtRatio(box, 0) })).toBe(0);
    expect(resolveHoverIndex({ ...base, clientX: clientXAtRatio(box, 0.5) })).toBe(50);
    expect(resolveHoverIndex({ ...base, clientX: clientXAtRatio(box, 1) })).toBe(POINT_COUNT - 1);
    expect(resolveMeetTransform(box, VIEW_BOX_WIDTH, VIEW_BOX_HEIGHT)?.offsetX).toBeCloseTo(0, 6);
  });

  it("窄屏横向滚动时按元素实际宽度与 left 换算", () => {
    // min-w-[720px] 下限：容器更窄时 svg 仍为 720px，滚动后 rect.left 可能为负。
    const box = naturalBox(720, -80);

    expect(
      resolveHoverIndex({
        clientX: clientXAtRatio(box, 0),
        box,
        viewBoxWidth: VIEW_BOX_WIDTH,
        viewBoxHeight: VIEW_BOX_HEIGHT,
        paddingLeft: PADDING_LEFT,
        paddingRight: PADDING_RIGHT,
        count: POINT_COUNT,
      }),
    ).toBe(0);
    expect(
      resolveHoverIndex({
        clientX: clientXAtRatio(box, 1),
        box,
        viewBoxWidth: VIEW_BOX_WIDTH,
        viewBoxHeight: VIEW_BOX_HEIGHT,
        paddingLeft: PADDING_LEFT,
        paddingRight: PADDING_RIGHT,
        count: POINT_COUNT,
      }),
    ).toBe(POINT_COUNT - 1);
  });
});
