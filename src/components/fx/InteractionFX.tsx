"use client";

// 全局交互动效层：光标跟随光晕、光环、点击涟漪与粒子迸发。
// 只在精细指针设备且未开启“减少动态效果”时启用，避免触屏与无障碍场景下的干扰。
import { useEffect, useRef } from "react";

import {
  BASE_FRAME_MS,
  exponentialFollowFactor,
  leashPull,
  normalizeFrameDelta,
} from "@/lib/fx-motion";
import { useBackgroundSettings } from "@/lib/ui-background-client";

/** 命中这些元素时判定为“可交互”，光环会放大提示。 */
const INTERACTIVE_SELECTOR = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "label",
  "[role='button']",
  "[role='tab']",
  "[role='checkbox']",
  "[data-fx-hover]",
].join(",");

/** 点击时迸发的粒子数量与强度系数相关。 */
function sparkCount(intensity: number): number {
  return Math.round(6 + intensity * 4);
}

/*
 * 跟随参数：tauMs 是缓动时间常数（越小越贴身），maxLagPx 是快速甩动时允许的最大落后距离。
 * 光环比光晕更贴身，两者叠加出「拖尾层次」而不是硬跟随。
 */
const RING_TAU_MS = 55;
const RING_MAX_LAG_PX = 90;
const GLOW_TAU_MS = 110;
const GLOW_MAX_LAG_PX = 150;

/** 交互光效层：固定在最上层但 `pointer-events: none`，不拦截任何真实交互。 */
export function InteractionFX() {
  const { settings } = useBackgroundSettings();
  const layerRef = useRef<HTMLDivElement | null>(null);
  const spotlightRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);
  const dotRef = useRef<HTMLDivElement | null>(null);
  const enabled = settings.fxEnabled && settings.fxIntensity > 0;
  const intensity = settings.fxIntensity;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const layer = layerRef.current;
    const spotlight = spotlightRef.current;
    const ring = ringRef.current;
    const dot = dotRef.current;
    if (!layer || !spotlight || !ring || !dot) {
      return;
    }
    if (!window.matchMedia("(pointer: fine)").matches) {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    let targetX = window.innerWidth / 2;
    let targetY = window.innerHeight / 2;
    let frame = 0;
    let visible = false;
    let lastFrameTime = 0;
    const ringPos = { x: targetX, y: targetY };
    const glowPos = { x: targetX, y: targetY };

    /**
     * 跟随缓动：按真实帧间隔做指数缓动 + 皮带约束。
     * 指数缓动与刷新率无关（高刷屏与 60Hz 手感一致）；皮带约束给拖尾距离设上限，
     * 快速甩动时光环/光晕最多落后 maxLag 像素，不会出现“特效停在原地”。
     */
    const follow = (
      position: { x: number; y: number },
      tauMs: number,
      maxLag: number,
      deltaMs: number,
    ) => {
      const factor = exponentialFollowFactor(tauMs, deltaMs);
      position.x += (targetX - position.x) * factor;
      position.y += (targetY - position.y) * factor;

      const dx = targetX - position.x;
      const dy = targetY - position.y;
      const distance = Math.hypot(dx, dy);
      const pull = leashPull(distance, maxLag);
      if (pull > 0) {
        position.x += dx * pull;
        position.y += dy * pull;
      }
    };

    /** 每帧渲染：光环更贴身，光晕更柔和，两者叠加出拖尾层次。 */
    const render = (time: number) => {
      // 帧间隔夹在 0~64ms：切回前台或长时间停帧后不会瞬移，也不会抖动。
      const deltaMs = normalizeFrameDelta(
        lastFrameTime ? time - lastFrameTime : BASE_FRAME_MS,
      );
      lastFrameTime = time;

      follow(ringPos, RING_TAU_MS, RING_MAX_LAG_PX, deltaMs);
      follow(glowPos, GLOW_TAU_MS, GLOW_MAX_LAG_PX, deltaMs);

      ring.style.transform =
        "translate3d(" + ringPos.x + "px, " + ringPos.y + "px, 0)";
      spotlight.style.transform =
        "translate3d(" + glowPos.x + "px, " + glowPos.y + "px, 0)";
      dot.style.transform =
        "translate3d(" + targetX + "px, " + targetY + "px, 0)";
      frame = window.requestAnimationFrame(render);
    };

    /** 指针进入文档：显示光标层。 */
    const show = () => {
      if (visible) {
        return;
      }
      visible = true;
      ringPos.x = targetX;
      ringPos.y = targetY;
      glowPos.x = targetX;
      glowPos.y = targetY;
      lastFrameTime = 0;
      for (const element of [spotlight, ring, dot]) {
        element.style.opacity = "1";
      }
      if (!frame) {
        frame = window.requestAnimationFrame(render);
      }
    };

    /** 指针离开文档：隐藏光标层并停帧。 */
    const hide = () => {
      visible = false;
      lastFrameTime = 0;
      for (const element of [spotlight, ring, dot]) {
        element.style.opacity = "0";
      }
      window.cancelAnimationFrame(frame);
      frame = 0;
    };
    const handlePointerMove = (event: PointerEvent) => {
      targetX = event.clientX;
      targetY = event.clientY;
      show();
    };

    const handlePointerOver = (event: Event) => {
      const target = event.target as Element | null;
      const interactive = Boolean(target?.closest?.(INTERACTIVE_SELECTOR));
      ring.dataset.hover = interactive ? "true" : "false";
    };

    /** 点击：在落点生成一圈扩散涟漪与若干粒子。 */
    const handlePointerDown = (event: PointerEvent) => {
      ring.dataset.press = "true";
      targetX = event.clientX;
      targetY = event.clientY;

      const ripple = document.createElement("div");
      ripple.className = "fx-ripple";
      ripple.style.transform =
        "translate3d(" + event.clientX + "px, " + event.clientY + "px, 0)";
      layer.appendChild(ripple);
      ripple.addEventListener("animationend", () => ripple.remove(), { once: true });

      const total = sparkCount(intensity);
      for (let index = 0; index < total; index += 1) {
        const angle = (Math.PI * 2 * index) / total + Math.random() * 0.4;
        const distance = 26 + Math.random() * 34 * intensity;
        const spark = document.createElement("div");
        spark.className = "fx-spark";
        spark.style.transform =
          "translate3d(" + event.clientX + "px, " + event.clientY + "px, 0)";
        spark.style.setProperty("--fx-dx", Math.cos(angle) * distance + "px");
        spark.style.setProperty("--fx-dy", Math.sin(angle) * distance + "px");
        layer.appendChild(spark);
        spark.addEventListener("animationend", () => spark.remove(), { once: true });
      }
    };

    const handlePointerUp = () => {
      ring.dataset.press = "false";
    };

    const handleVisibility = () => {
      if (document.hidden) {
        hide();
      }
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerover", handlePointerOver, { passive: true });
    window.addEventListener("pointerdown", handlePointerDown, { passive: true });
    window.addEventListener("pointerup", handlePointerUp, { passive: true });
    window.addEventListener("blur", hide);
    document.addEventListener("mouseleave", hide);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerover", handlePointerOver);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("blur", hide);
      document.removeEventListener("mouseleave", hide);
      document.removeEventListener("visibilitychange", handleVisibility);
      layer.querySelectorAll(".fx-ripple, .fx-spark").forEach((node) => node.remove());
    };
  }, [enabled, intensity]);

  if (!enabled) {
    return null;
  }

  return (
    <div className="fx-layer" ref={layerRef} aria-hidden="true">
      <div className="fx-spotlight" ref={spotlightRef} style={{ opacity: 0 }} />
      <div className="fx-ring" ref={ringRef} style={{ opacity: 0 }} />
      <div className="fx-dot" ref={dotRef} style={{ opacity: 0 }} />
    </div>
  );
}
