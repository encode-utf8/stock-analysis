// 交互光效运动学纯函数的单测：跟随缓动、皮带约束、帧率折算与纹理取模。
import { describe, expect, it } from "vitest";

import {
  BASE_FRAME_MS,
  MAX_FRAME_DELTA_MS,
  MAX_PHYSICS_STEPS,
  MIN_PHYSICS_STEPS,
  decayFactor,
  exponentialFollowFactor,
  leashPull,
  normalizeFrameDelta,
  physicsSteps,
  wrapTextureOffset,
} from "@/lib/fx-motion";

describe("normalizeFrameDelta", () => {
  it("非有限值回退到基准帧长（切后台后不会瞬移）", () => {
    expect(normalizeFrameDelta(Number.NaN)).toBeCloseTo(BASE_FRAME_MS, 5);
    expect(normalizeFrameDelta(Number.POSITIVE_INFINITY)).toBeCloseTo(BASE_FRAME_MS, 5);
  });

  it("超长帧间隔被夹到上限，负值被夹到 0", () => {
    expect(normalizeFrameDelta(5000)).toBe(MAX_FRAME_DELTA_MS);
    expect(normalizeFrameDelta(-20)).toBe(0);
    expect(normalizeFrameDelta(16.7)).toBeCloseTo(16.7, 5);
  });
});

describe("exponentialFollowFactor", () => {
  it("一次 tau 时长内追到约 63%，且与帧率无关", () => {
    // 60Hz：16.67ms 走一步；120Hz：8.33ms 走两步，结果应几乎一致。
    const oneStep = exponentialFollowFactor(110, 1000 / 60);
    const twoSteps = 1 - (1 - exponentialFollowFactor(110, 1000 / 120)) ** 2;
    expect(oneStep).toBeCloseTo(twoSteps, 6);
    expect(exponentialFollowFactor(110, 110)).toBeCloseTo(1 - Math.exp(-1), 5);
  });

  it("非法 tauMs 直接跟随，系数不会越界", () => {
    expect(exponentialFollowFactor(0, 16)).toBe(1);
    expect(exponentialFollowFactor(-5, 16)).toBe(1);
    expect(exponentialFollowFactor(110, -3)).toBe(0);
    expect(exponentialFollowFactor(20, 10000)).toBe(1);
  });
});

describe("leashPull", () => {
  it("未超出上限时不补拉，超出后按比例补拉且永不超过 1", () => {
    expect(leashPull(40, 90)).toBe(0);
    expect(leashPull(90, 90)).toBe(0);
    // 落后 200px、上限 100px：应补拉 (200-100)/200 = 0.5
    expect(leashPull(200, 100)).toBeCloseTo(0.5, 6);
    expect(leashPull(100000, 100)).toBeLessThan(1);
    expect(leashPull(Number.NaN, 100)).toBe(0);
  });

  it("快速甩动后拖尾距离被压在上限附近", () => {
    // 模拟 1200px 的瞬时跳跃：逐步应用缓动 + 皮带，落后距离不应超过上限太多。
    const maxLag = 150;
    let position = 0;
    const target = 1200;
    for (let frame = 0; frame < 30; frame += 1) {
      const factor = exponentialFollowFactor(110, 1000 / 60);
      position += (target - position) * factor;
      const distance = target - position;
      const pull = leashPull(distance, maxLag);
      position += (target - position) * pull;
      if (target - position > maxLag + 0.001) {
        throw new Error("拖尾超过了皮带上限");
      }
    }
    expect(Math.abs(target - position)).toBeLessThanOrEqual(maxLag);
  });
});

describe("physicsSteps / decayFactor", () => {
  it("60Hz 约等于 1 步，144Hz 与 30Hz 分别被夹在上下限内", () => {
    expect(physicsSteps(BASE_FRAME_MS)).toBeCloseTo(1, 6);
    expect(physicsSteps(1000 / 144)).toBeCloseTo(0.4167, 3);
    expect(physicsSteps(0)).toBe(MIN_PHYSICS_STEPS);
    expect(physicsSteps(1000)).toBe(MAX_PHYSICS_STEPS);
  });

  it("衰减按步长折算：两步的保留量等于单步的平方", () => {
    const oneStep = decayFactor(0.93, 1);
    const twoSteps = decayFactor(0.93, 2);
    expect(twoSteps).toBeCloseTo(1 - (1 - oneStep) ** 2, 6);
    expect(oneStep).toBeCloseTo(0.07, 6);
  });
});

describe("wrapTextureOffset", () => {
  it("把任意位置映射到 [0, width)，负数也回到正区间", () => {
    expect(wrapTextureOffset(0, 1024)).toBe(0);
    expect(wrapTextureOffset(1024, 1024)).toBe(0);
    expect(wrapTextureOffset(-16, 1024)).toBe(1008);
    expect(wrapTextureOffset(2500, 1024)).toBe(452);
  });

  it("非法宽度与非法位置回退到 0，不会产生 NaN 取样坐标", () => {
    expect(wrapTextureOffset(10, 0)).toBe(0);
    expect(wrapTextureOffset(Number.NaN, 1024)).toBe(0);
  });
});
