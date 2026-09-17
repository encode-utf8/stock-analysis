"use client";

// 页面背景画布：自定义图片 + 预设图形 + 动态层（星链/星域粒子、极光帘幕）+ 遮罩。
// 动态层画在遮罩之上，不再被遮罩压暗；亮度按遮罩值缩放，因此「背景遮罩」滑杆依然有效。
import { useEffect, useRef } from "react";

import {
  BASE_FRAME_MS,
  decayFactor,
  normalizeFrameDelta,
  physicsSteps,
  wrapTextureOffset,
} from "@/lib/fx-motion";
import { backgroundImageUrl, particleCountForPreset } from "@/lib/ui-background";
import { useBackgroundSettings } from "@/lib/ui-background-client";

/** 连线透明度分桶数：同档透明度只描边一次，避免高密度下逐条连线切换画笔。 */
const LINK_BUCKETS = 6;

/** 光标节点半径：进入这个范围的粒子会与光标连线，并被轻微吸向光标；超出即断开。 */
const CURSOR_LINK_DISTANCE = 180;

/**
 * 光标停靠环：引力只在这个环与联结半径之间生效。
 * 没有它的话粒子会一路塌到光标中心堆成一坨，连线全被亮核盖住；
 * 留出空档后粒子停在周围一圈，连线张得开，「联结」才看得出来。
 */
const CURSOR_HOLD_RADIUS = 74;

/** 极光列宽（px）：帘幕按列竖切渲染，列越窄波浪越顺滑，代价是绘制次数增加。 */
const AURORA_STEP = 16;

/**
 * 极光纹理宽度（px）：射线纹理要够长才看不出重复。
 * 逐列渲染时是按列宽从纹理上「切条」，不是把整张纹理缩到一列宽，
 * 所以射线在屏幕上保持 1:1 的粗细，纹理也不会以列宽为周期重复出现。
 */
const AURORA_TEXTURE_WIDTH = 1024;

/** 极光纹理高度（px）：竖向被拉伸到帘幕高度，取大一些可减少拉伸导致的模糊。 */
const AURORA_TEXTURE_HEIGHT = 384;

/** 每条帘幕纹理上的射线数量：粗细、长短、明暗都随机，叠出帘幕的丝缕感。 */
const AURORA_RAYS = 64;

/**
 * 极光帘幕配置：每条帘幕一条主色，频率/速度/相位/亮度各不相同，叠起来才有真实极光的层次。
 * 自下而上由青绿（低空氧原子发绿光）过渡到靛紫（高空氮气发紫光），贴近真实极光的色彩分层。
 */
const AURORA_BANDS: Array<{
  rgb: [number, number, number];
  topRatio: number;
  heightRatio: number;
  amplitudeRatio: number;
  frequency: number;
  speed: number;
  phase: number;
  alpha: number;
  shimmer: number;
}> = [
  { rgb: [72, 236, 168], topRatio: 0.1, heightRatio: 0.42, amplitudeRatio: 0.045, frequency: 0.0058, speed: 0.55, phase: 0.0, alpha: 0.44, shimmer: 0.45 },
  { rgb: [56, 214, 232], topRatio: 0.02, heightRatio: 0.52, amplitudeRatio: 0.06, frequency: 0.0046, speed: 0.42, phase: 1.7, alpha: 0.34, shimmer: 0.52 },
  { rgb: [96, 226, 178], topRatio: 0.2, heightRatio: 0.34, amplitudeRatio: 0.05, frequency: 0.0071, speed: 0.66, phase: 2.6, alpha: 0.24, shimmer: 0.38 },
  { rgb: [122, 132, 248], topRatio: 0.0, heightRatio: 0.66, amplitudeRatio: 0.075, frequency: 0.0036, speed: 0.3, phase: 3.4, alpha: 0.18, shimmer: 0.32 },
  { rgb: [186, 122, 244], topRatio: -0.02, heightRatio: 0.8, amplitudeRatio: 0.09, frequency: 0.0028, speed: 0.2, phase: 5.0, alpha: 0.12, shimmer: 0.26 },
];

/** 粒子对象：位置、当前速度、基础漂移速度、半径与闪烁相位。 */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  driftX: number;
  driftY: number;
  r: number;
  phase: number;
}

/** 极光帘幕：一张射线纹理 + 该帘幕的摆动参数。 */
interface AuroraBand {
  sprite: HTMLCanvasElement;
  /** 纹理取样起点：各帘幕错开，避免不同帘幕的射线完全对齐。 */
  textureOffset: number;
  top: number;
  height: number;
  amplitude: number;
  frequency: number;
  speed: number;
  phase: number;
  alpha: number;
  shimmer: number;
}

/**
 * 发光贴片：中心接近纯白、外圈转成青色并淡出。
 * 粒子改用它替代实心圆点，暗底上的视觉权重明显更高。
 */
function createGlowSprite(): HTMLCanvasElement {
  const size = 64;
  const sprite = document.createElement("canvas");
  sprite.width = size;
  sprite.height = size;
  const context = sprite.getContext("2d");
  if (!context) {
    return sprite;
  }
  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, "rgba(232, 253, 255, 1)");
  gradient.addColorStop(0.24, "rgba(134, 232, 255, 0.78)");
  gradient.addColorStop(0.58, "rgba(56, 189, 248, 0.22)");
  gradient.addColorStop(1, "rgba(56, 189, 248, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return sprite;
}

/**
 * 极光帘幕纹理：一张横向连续的宽纹理。
 * 竖直方向是「上淡下浓 + 底缘一道亮线」（真实帘幕最亮处正是下边缘），
 * 横向叠上粗细、长短、明暗都随机的射线；逐列渲染时按列宽从纹理上切条，
 * 因此纹理在屏幕上既不重复出现，射线也保持 1:1 的粗细。
 */
function createAuroraSprite(rgb: [number, number, number]): HTMLCanvasElement {
  const width = AURORA_TEXTURE_WIDTH;
  const height = AURORA_TEXTURE_HEIGHT;
  const sprite = document.createElement("canvas");
  sprite.width = width;
  sprite.height = height;
  const context = sprite.getContext("2d");
  if (!context) {
    return sprite;
  }
  const [r, g, b] = rgb;
  const rgba = (alpha: number) => "rgba(" + r + ", " + g + ", " + b + ", " + alpha + ")";

  const vertical = context.createLinearGradient(0, 0, 0, height);
  vertical.addColorStop(0, rgba(0));
  vertical.addColorStop(0.1, rgba(0.14));
  vertical.addColorStop(0.34, rgba(0.38));
  vertical.addColorStop(0.62, rgba(0.66));
  vertical.addColorStop(0.86, rgba(0.92));
  vertical.addColorStop(0.94, rgba(1));
  vertical.addColorStop(1, rgba(0.12));
  context.fillStyle = vertical;
  context.fillRect(0, 0, width, height);

  /*
   * 纵向射线：复用同一条竖直渐变，所以射线只在帘幕浓处显现，不会跑到顶部的弥散区。
   * 每条射线的起点、长度、粗细都随机，避免出现「一排等宽的栅栏」。
   */
  context.globalCompositeOperation = "lighter";
  for (let index = 0; index < AURORA_RAYS; index += 1) {
    const rayWidth = 2.5 + Math.random() * 11;
    // 射线必须完整落在纹理内：被裁掉半截的射线会在纹理接缝处露出硬边。
    const x = Math.random() * (width - rayWidth);
    const rayTop = height * Math.random() * 0.42;
    const rayBottom = height * (0.6 + Math.random() * 0.4);
    context.globalAlpha = 0.12 + Math.random() * 0.5;
    context.fillStyle = vertical;
    context.fillRect(x, rayTop, rayWidth, rayBottom - rayTop);
  }
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  return sprite;
}

/** 依据视口高度生成极光帘幕（尺寸随窗口变化重建）。 */
function createAuroraBands(height: number): AuroraBand[] {
  const offsetSteps = Math.floor(AURORA_TEXTURE_WIDTH / AURORA_STEP);
  return AURORA_BANDS.map((band) => ({
    sprite: createAuroraSprite(band.rgb),
    // 取样起点对齐列宽，切条时才能严格一一对应，不会出现半个像素的错位。
    textureOffset: Math.floor(Math.random() * offsetSteps) * AURORA_STEP,
    top: band.topRatio * height,
    height: band.heightRatio * height,
    amplitude: band.amplitudeRatio * height,
    frequency: band.frequency,
    speed: band.speed,
    phase: band.phase,
    alpha: band.alpha,
    shimmer: band.shimmer,
  }));
}

/** 依据画布尺寸与预设生成粒子：星域的星点更小更慢，星链的粒子更大更亮。 */
function createParticles(
  width: number,
  height: number,
  count: number,
  starfield: boolean,
): Particle[] {
  const spread = starfield ? 0.12 : 0.22;
  return Array.from({ length: count }, () => {
    const vx = (Math.random() - 0.5) * spread;
    const vy = (Math.random() - 0.5) * spread;
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      vx,
      vy,
      driftX: vx,
      driftY: vy,
      r: starfield ? 0.6 + Math.random() * 1.5 : 1.3 + Math.random() * 2.1,
      phase: Math.random() * Math.PI * 2,
    };
  });
}

/** 背景画布组件：挂载在根布局最底层，不参与交互（pointer-events: none）。 */
export function BackgroundCanvas() {
  const { settings } = useBackgroundSettings();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageUrl = backgroundImageUrl(settings.customImage);
  const preset = settings.preset;
  const density = settings.particleDensity;
  const overlay = settings.overlay;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const isAurora = preset === "aurora";
    const isStarfield = preset === "starfield";
    const isParticles = preset === "particles";
    const particlePreset = isParticles || isStarfield;
    const count = particlePreset ? particleCountForPreset(preset, density) : 0;
    const animated = particlePreset || isAurora;

    // 「纯净」预设、极光以外的非动态预设、以及密度为 0 时清空画布。
    if (!animated || (particlePreset && count === 0)) {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // 动态层画在遮罩之上，按遮罩值缩放亮度，保证「背景遮罩」滑杆依然可以压暗背景。
    const brightness = 1 - Math.min(0.9, Math.max(0, overlay)) * 0.45;
    const glowSprite = createGlowSprite();
    const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const linkEnabled = isParticles;

    let particles: Particle[] = [];
    let auroraBands: AuroraBand[] = [];
    let frame = 0;
    // 上一帧时间戳：用于把粒子物理与光标灰度按真实帧间隔缩放。
    let lastFrameTime = 0;
    let pointerX = window.innerWidth / 2;
    let pointerY = window.innerHeight / 2;
    let cursorActive = false;
    // 密度越高连线越短：低密度时长线更空灵，高密度时避免糊成一整片。
    const linkDistance = 132 - 42 * Math.min(1, density / 100);

    /** 自适应画布尺寸，并按新尺寸重建粒子与极光帘幕。 */
    const resize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      canvas.width = Math.floor(width * devicePixelRatio);
      canvas.height = Math.floor(height * devicePixelRatio);
      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      particles = particlePreset ? createParticles(width, height, count, isStarfield) : [];
      auroraBands = isAurora ? createAuroraBands(height) : [];
      if (reduceMotion) {
        draw(0);
      }
    };

    /**
     * 粒子物理：光标引力 + 回归基础漂移 + 边界环绕。
     * 所有增量都以 60fps 为基准按真实帧间隔缩放，高刷屏与低帧率下吸附手感一致。
     */
    const stepParticles = (
      width: number,
      height: number,
      cursorX: number,
      cursorY: number,
      deltaMs: number,
    ) => {
      const steps = physicsSteps(deltaMs);
      const cursorDistanceSq = CURSOR_LINK_DISTANCE * CURSOR_LINK_DISTANCE;
      const holdRadiusSq = CURSOR_HOLD_RADIUS * CURSOR_HOLD_RADIUS;
      const relax = decayFactor(0.93, steps);
      for (const particle of particles) {
        if (cursorActive) {
          const dx = cursorX - particle.x;
          const dy = cursorY - particle.y;
          const distanceSq = dx * dx + dy * dy;
          if (distanceSq < cursorDistanceSq && distanceSq > holdRadiusSq) {
            const distance = Math.sqrt(distanceSq);
            // 越近引力越强：粒子主动贴向光标并连成链，光标移开后自动脱离。
            const strength = (1 - distance / CURSOR_LINK_DISTANCE) * 0.07 * steps;
            particle.vx += (dx / distance) * strength;
            particle.vy += (dy / distance) * strength;
          }
        }
        // 速度逐步回归基础漂移，避免被光标吸走后再也散不开。
        particle.vx += (particle.driftX - particle.vx) * relax;
        particle.vy += (particle.driftY - particle.vy) * relax;
        particle.x += particle.vx * steps;
        particle.y += particle.vy * steps;
        if (particle.x < -20) particle.x = width + 20;
        if (particle.x > width + 20) particle.x = -20;
        if (particle.y < -20) particle.y = height + 20;
        if (particle.y > height + 20) particle.y = -20;
      }
    };

    /** 粒子之间的近邻连线：分桶批量描边，同档透明度只切换一次画笔。 */
    const drawParticleLinks = () => {
      const buckets: number[][] = [];
      for (let index = 0; index < LINK_BUCKETS; index += 1) {
        buckets.push([]);
      }
      const maxDistanceSq = linkDistance * linkDistance;
      for (let i = 0; i < particles.length; i += 1) {
        const a = particles[i];
        for (let j = i + 1; j < particles.length; j += 1) {
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const distanceSq = dx * dx + dy * dy;
          if (distanceSq > maxDistanceSq) {
            continue;
          }
          const strength = 1 - Math.sqrt(distanceSq) / linkDistance;
          const bucket = Math.min(LINK_BUCKETS - 1, Math.floor(strength * LINK_BUCKETS));
          buckets[bucket].push(a.x, a.y, b.x, b.y);
        }
      }

      context.lineWidth = 1.1;
      for (let index = 0; index < buckets.length; index += 1) {
        const segments = buckets[index];
        if (segments.length === 0) {
          continue;
        }
        // 连线整体比上一版更亮：暗底 + 面板遮挡下，太淡的连线几乎看不出「链」的存在。
        const alpha = (0.2 + (0.34 * (index + 0.5)) / LINK_BUCKETS) * brightness;
        context.strokeStyle = "rgba(34, 211, 238, " + alpha.toFixed(3) + ")";
        context.beginPath();
        for (let k = 0; k < segments.length; k += 4) {
          context.moveTo(segments[k], segments[k + 1]);
          context.lineTo(segments[k + 2], segments[k + 3]);
        }
        context.stroke();
      }
    };

    /**
     * 光标节点：半径内的粒子逐条连出亮线（越近越亮），
     * 并在光标处画一个带脉冲的发光核心，让「光标接入星链」这件事一眼可见。
     */
    const drawCursorNode = (
      cursorX: number,
      cursorY: number,
      time: number,
      withLinks: boolean,
    ) => {
      const maxDistanceSq = CURSOR_LINK_DISTANCE * CURSOR_LINK_DISTANCE;
      context.lineWidth = 1.4;
      for (const particle of withLinks ? particles : []) {
        const dx = particle.x - cursorX;
        const dy = particle.y - cursorY;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq > maxDistanceSq) {
          continue;
        }
        const distance = Math.sqrt(distanceSq);
        const strength = 1 - distance / CURSOR_LINK_DISTANCE;
        // 每条连线都是一段发光链路：越近越亮，让「光标接入星链」一眼可见。
        context.strokeStyle =
          "rgba(198, 250, 255, " + (strength * 0.82 * brightness).toFixed(3) + ")";
        context.beginPath();
        context.moveTo(cursorX, cursorY);
        context.lineTo(particle.x, particle.y);
        context.stroke();
      }

      const pulse = 0.72 + 0.28 * Math.sin(time / 420);
      // 星链模式的亮核收小一点，免得盖住向外张开的联结线；
      // 星域没有连线，改用更大的光晕核心：光标扫过时星点被照亮。
      const coreSize = (withLinks ? 84 : 140) * pulse;
      context.globalAlpha = 0.6 * brightness * pulse;
      context.drawImage(
        glowSprite,
        cursorX - coreSize / 2,
        cursorY - coreSize / 2,
        coreSize,
        coreSize,
      );
      context.globalAlpha = 1;
    };

    /**
     * 极光：逐列贴出帘幕，叠加混色 + 正弦摆动 + 逐列明暗跳动。
     * 逐列跳动是关键——真实极光的明暗来自「一道道射线各自闪烁」，
     * 整条帘幕同亮同灭时，看上去就只是颜色渐变。
     */
    const drawAurora = (time: number, width: number) => {
      const step = AURORA_STEP;
      const columns = Math.ceil(width / step) + 2;
      const seconds = time / 1000;
      context.save();
      context.globalCompositeOperation = "lighter";
      for (const band of auroraBands) {
        for (let index = 0; index < columns; index += 1) {
          const x = index * step - step;
          const wave =
            Math.sin(x * band.frequency + seconds * band.speed + band.phase) +
            0.55 *
              Math.sin(
                x * band.frequency * 2.7 - seconds * band.speed * 1.4 + band.phase * 2.1,
              );
          const top = band.top + wave * band.amplitude;
          const bandHeight =
            band.height *
            (0.78 + 0.22 * Math.sin(x * 0.0035 + seconds * 0.6 + band.phase));
          /*
           * 射线明暗：两个不同频率的正弦叠加，避免整屏出现规律性闪烁。
           * 空间频率压得很低（周期约 520px / 1570px）：既然逐列之间不再重叠混合，
           * 相邻列的亮度差必须足够小，否则每 16px 就会出现一道竖向接缝。
           * 一缕一缕的射线细节由纹理自身提供，这里只负责整体的明暗流动。
           */
          const flicker =
            0.66 +
            band.shimmer *
              (0.6 * Math.sin(x * 0.004 + seconds * 1.3 + band.phase * 3.1) +
                0.4 * Math.sin(x * 0.012 - seconds * 2.1 + band.phase));
          context.globalAlpha =
            Math.max(0, Math.min(1, band.alpha * flicker)) * brightness;
          // 从纹理上按列切条：源宽度 = 目标宽度 = 列宽，射线保持 1:1 粗细。
          const textureX = wrapTextureOffset(
            x + band.textureOffset,
            AURORA_TEXTURE_WIDTH,
          );
          context.drawImage(
            band.sprite,
            textureX,
            0,
            step,
            AURORA_TEXTURE_HEIGHT,
            x,
            top,
            step,
            bandHeight,
          );
        }
      }
      context.restore();
    };

    /** 光标联结强度：0 表示未联结（超出半径即自动脱离），越接近 1 越贴身。 */
    const cursorLinkStrength = (x: number, y: number, cursorX: number, cursorY: number) => {
      if (!cursorActive) {
        return 0;
      }
      const distance = Math.hypot(x - cursorX, y - cursorY);
      return distance < CURSOR_LINK_DISTANCE ? 1 - distance / CURSOR_LINK_DISTANCE : 0;
    };

    /** 单帧绘制：视差 → 粒子物理 → 连线 → 发光粒子 → 极光。 */
    const draw = (time: number) => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const deltaMs = normalizeFrameDelta(
        lastFrameTime ? time - lastFrameTime : BASE_FRAME_MS,
      );
      lastFrameTime = time;
      context.clearRect(0, 0, width, height);

      // 光标视差：整层按光标位置反向微移，营造纵深。
      const offsetX = cursorActive ? (pointerX - width / 2) * -0.012 : 0;
      const offsetY = cursorActive ? (pointerY - height / 2) * -0.012 : 0;
      context.save();
      context.translate(offsetX, offsetY);
      const cursorX = pointerX - offsetX;
      const cursorY = pointerY - offsetY;

      if (isAurora) {
        drawAurora(time, width);
        context.restore();
        frame = reduceMotion ? 0 : window.requestAnimationFrame(draw);
        return;
      }

      stepParticles(width, height, cursorX, cursorY, deltaMs);
      if (linkEnabled) {
        drawParticleLinks();
      }
      if (cursorActive) {
        drawCursorNode(cursorX, cursorY, time, linkEnabled);
      }

      for (const particle of particles) {
        const twinkle = 0.55 + 0.45 * Math.sin(time / 900 + particle.phase);
        let alpha = isStarfield ? twinkle * 0.9 : twinkle;
        let size = particle.r * 6;
        // 靠近光标的粒子被提亮放大：星链是「被联结」，星域是「被光晕扫过」。
        const link = cursorLinkStrength(particle.x, particle.y, cursorX, cursorY);
        if (link > 0) {
          alpha *= 1 + link * (isStarfield ? 2.1 : 1.6);
          size *= 1 + link * 0.4;
        }
        context.globalAlpha = Math.min(1, alpha) * brightness;
        context.drawImage(
          glowSprite,
          particle.x - size / 2,
          particle.y - size / 2,
          size,
          size,
        );
      }
      context.globalAlpha = 1;

      context.restore();
      frame = reduceMotion ? 0 : window.requestAnimationFrame(draw);
    };

    /** 记录光标位置，供视差与星链交互使用。 */
    const handlePointerMove = (event: PointerEvent) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      cursorActive = true;
    };

    /** 指针离开文档：断开光标与星链的连接。 */
    const handlePointerLeave = () => {
      cursorActive = false;
    };

    /** 页面不可见时停帧，避免后台空跑。 */
    const handleVisibility = () => {
      if (document.hidden) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      } else if (!frame && !reduceMotion) {
        // 重新可见时把帧间隔归零，避免用停帧期间的长间隔做一次大步长计算。
        lastFrameTime = 0;
        frame = window.requestAnimationFrame(draw);
      }
    };

    resize();
    window.addEventListener("resize", resize);
    if (!reduceMotion) {
      frame = window.requestAnimationFrame(draw);
      window.addEventListener("pointermove", handlePointerMove, { passive: true });
      window.addEventListener("pointerup", handlePointerMove, { passive: true });
      document.addEventListener("mouseleave", handlePointerLeave);
      window.addEventListener("blur", handlePointerLeave);
      document.addEventListener("visibilitychange", handleVisibility);
    }

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerMove);
      document.removeEventListener("mouseleave", handlePointerLeave);
      window.removeEventListener("blur", handlePointerLeave);
      document.removeEventListener("visibilitychange", handleVisibility);
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [preset, density, overlay]);

  return (
    <div className="app-backdrop" data-preset={preset} aria-hidden="true">
      {imageUrl ? (
        <div
          className="app-backdrop__image"
          style={{ backgroundImage: "url(" + imageUrl + ")" }}
        />
      ) : null}
      <div className="app-backdrop__preset" data-preset={preset} />
      {preset === "none" ? null : (
        <div className="app-backdrop__glow" data-preset={preset} />
      )}
      <div className="app-backdrop__scrim" />
      <canvas ref={canvasRef} className="app-backdrop__canvas" />
    </div>
  );
}
