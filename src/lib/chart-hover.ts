// 图表悬停坐标换算：把鼠标位置映射到最近的数据点索引。
//
// 背景：本项目的手绘 SVG 大多只写 viewBox（如 `0 0 900 320`），元素尺寸由 CSS 决定。
// 当元素宽高比与 viewBox 不一致时（例如 `h-72 w-full` 固定高度 + 自适应宽度），
// SVG 默认的 preserveAspectRatio="xMidYMid meet" 会先等比缩放、再在两侧或上下留白居中。
// 如果换算时按整幅元素宽度线性映射，就会把这部分留白算进绘图区，导致悬停位置整体偏移；
// 光标移动越快、容器越宽，偏移越明显。这里统一按「等比缩放 + 居中留白」还原内容坐标。

/** 元素在视口中的位置与尺寸（通常来自 getBoundingClientRect）。 */
export interface ChartElementBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** "xMidYMid meet" 的换算结果。 */
export interface ChartMeetTransform {
  /** 等比缩放比例。 */
  scale: number;
  /** 内容左侧留白（元素坐标系，像素）。 */
  offsetX: number;
  /** 内容上方留白（元素坐标系，像素）。 */
  offsetY: number;
}

export interface ResolveHoverIndexOptions {
  /** 鼠标指针的视口 X 坐标（MouseEvent.clientX）。 */
  clientX: number;
  /** SVG 元素的位置与尺寸。 */
  box: ChartElementBox;
  /** viewBox 宽度。 */
  viewBoxWidth: number;
  /** viewBox 高度。 */
  viewBoxHeight: number;
  /** 绘图区左内边距（viewBox 坐标系）。 */
  paddingLeft: number;
  /** 绘图区右内边距（viewBox 坐标系）。 */
  paddingRight: number;
  /** 数据点数量。 */
  count: number;
}

/**
 * 计算 "xMidYMid meet" 下的缩放比与居中留白。
 * 元素或 viewBox 尺寸非法时返回 null，由调用方决定降级行为。
 */
export function resolveMeetTransform(
  box: Pick<ChartElementBox, "width" | "height">,
  viewBoxWidth: number,
  viewBoxHeight: number,
): ChartMeetTransform | null {
  if (!(box.width > 0) || !(box.height > 0)) {
    return null;
  }
  if (!(viewBoxWidth > 0) || !(viewBoxHeight > 0)) {
    return null;
  }

  const scale = Math.min(box.width / viewBoxWidth, box.height / viewBoxHeight);
  if (!Number.isFinite(scale) || scale <= 0) {
    return null;
  }

  return {
    scale,
    offsetX: (box.width - viewBoxWidth * scale) / 2,
    offsetY: (box.height - viewBoxHeight * scale) / 2,
  };
}

/**
 * 把鼠标 X 坐标换算为最近的数据点索引；越界时钳制到首尾数据点。
 * 元素尺寸非法、绘图区宽度非正或数据点不足 2 个时返回 null，调用方应保持原有高亮不变。
 */
export function resolveHoverIndex(options: ResolveHoverIndexOptions): number | null {
  const { clientX, box, viewBoxWidth, viewBoxHeight, paddingLeft, paddingRight, count } = options;
  if (count < 2) {
    return null;
  }

  const transform = resolveMeetTransform(box, viewBoxWidth, viewBoxHeight);
  if (!transform) {
    return null;
  }

  const plotWidth = viewBoxWidth - paddingLeft - paddingRight;
  if (plotWidth <= 0) {
    return null;
  }

  // 先扣掉居中留白还原到 viewBox 坐标，再按绘图区宽度求比例。
  const contentX = (clientX - box.left - transform.offsetX) / transform.scale;
  const ratio = (contentX - paddingLeft) / plotWidth;
  const clamped = Math.min(Math.max(ratio, 0), 1);
  return Math.round(clamped * (count - 1));
}