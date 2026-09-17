// 交互光效与动态背景共用的运动学纯函数。
// 「特效跟不跟得上光标」「粒子在高刷屏上快不快」全靠这几个数值，
// 抽成纯函数后可以直接单测，不必只靠肉眼估。

/** 单帧最大有效间隔（ms）：停帧或切回后台后，不能按超长间隔一次性算出巨大位移。 */
export const MAX_FRAME_DELTA_MS = 64;

/** 物理基准帧长（ms）：粒子参数均按 60fps 调校。 */
export const BASE_FRAME_MS = 1000 / 60;

/** 物理步长上下限：极端帧率下也要保持可预期的运动速度。 */
export const MIN_PHYSICS_STEPS = 0.25;
export const MAX_PHYSICS_STEPS = 2.5;

/**
 * 帧间隔归一化：非有限值回退到基准帧长，超出 0~64ms 的一律夹到边界。
 * 返回 0 表示这一帧与上一帧同时刻（不推进），是合法输入。
 */
export function normalizeFrameDelta(deltaMs: number): number {
  if (!Number.isFinite(deltaMs)) {
    return BASE_FRAME_MS;
  }
  return Math.min(MAX_FRAME_DELTA_MS, Math.max(0, deltaMs));
}

/**
 * 指数缓动系数：`1 - e^(-deltaMs / tauMs)`。
 * 与刷新率无关——60Hz 与 144Hz 下同样的 tauMs 手感一致，
 * 而固定比例缓动会让高刷屏上的拖尾追得更快、低帧率下更慢。
 */
export function exponentialFollowFactor(tauMs: number, deltaMs: number): number {
  if (!(tauMs > 0)) {
    return 1;
  }
  const factor = 1 - Math.exp(-Math.max(0, deltaMs) / tauMs);
  return Math.min(1, Math.max(0, factor));
}

/**
 * 皮带约束：落后距离超过上限时，返回需要额外补拉的比例（0~1）。
 * 指数缓动单靠自身在快速甩动时会落后很远（也就是「特效停在原地」），
 * 这里给拖尾距离硬性封顶。
 */
export function leashPull(distance: number, maxLagPx: number): number {
  if (!Number.isFinite(distance) || distance <= maxLagPx || distance <= 0) {
    return 0;
  }
  return Math.min(1, (distance - maxLagPx) / distance);
}

/** 物理步长：把真实帧间隔折算成「多少个基准帧」，并夹在上下限之间。 */
export function physicsSteps(deltaMs: number): number {
  const steps = normalizeFrameDelta(deltaMs) / BASE_FRAME_MS;
  return Math.min(MAX_PHYSICS_STEPS, Math.max(MIN_PHYSICS_STEPS, steps));
}

/**
 * 逐帧衰减折算：`perFrame` 是「每一基准帧保留多少」，例如 0.93。
 * 步长不为 1 时必须按 `perFrame ^ steps` 折算，否则高刷屏上粒子被吸住后散不开。
 */
export function decayFactor(perFrame: number, steps: number): number {
  const kept = Math.pow(perFrame, Math.max(0, steps));
  return Math.min(1, Math.max(0, 1 - kept));
}

/** 正模运算：把任意实数映射到 [0, width)，用于极光纹理的循环取样。 */
export function wrapTextureOffset(x: number, width: number): number {
  if (!(width > 0) || !Number.isFinite(x)) {
    return 0;
  }
  return ((x % width) + width) % width;
}