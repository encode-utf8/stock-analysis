// 背景画布与交互光效设置的单测：覆盖归一化、裁剪、局部更新与安全校验。
import { describe, expect, it } from "vitest";

import {
  BACKGROUND_LIMITS,
  BACKGROUND_PRESETS,
  CONTRAST_SAFE_PANEL_ALPHA_MIN,
  DEFAULT_BACKGROUND_SETTINGS,
  backgroundImageUrl,
  clampSetting,
  contrastRiskReason,
  hasContrastRisk,
  isBackgroundPresetId,
  isSafeBackgroundFileName,
  mergeBackgroundSettings,
  normalizeBackgroundSettings,
  particleCountForPreset,
  resolveBackgroundExtension,
} from "@/lib/ui-background";
import { readBackgroundImage } from "@/lib/ui-background-store";

describe("normalizeBackgroundSettings", () => {
  it("空输入回退到默认设置（科技网格 + 遮罩 45% + 面板 78%）", () => {
    const settings = normalizeBackgroundSettings(undefined);
    expect(settings).toEqual(DEFAULT_BACKGROUND_SETTINGS);
    expect(settings.preset).toBe("grid");
    expect(settings.overlay).toBe(0.45);
    expect(settings.panelAlpha).toBe(0.78);
    expect(settings.fxEnabled).toBe(true);
  });

  it("非法预设与非法数值回退默认值", () => {
    const settings = normalizeBackgroundSettings({
      preset: "hacker",
      overlay: "0.8",
      blur: Number.NaN,
      panelAlpha: null,
      particleDensity: {},
      fxEnabled: "yes",
      fxIntensity: Number.POSITIVE_INFINITY,
    });
    expect(settings.preset).toBe("grid");
    expect(settings.overlay).toBe(0.45);
    expect(settings.blur).toBe(8);
    expect(settings.panelAlpha).toBe(0.78);
    expect(settings.particleDensity).toBe(60);
    expect(settings.fxEnabled).toBe(true);
    expect(settings.fxIntensity).toBe(1);
  });

  it("读取旧存档时才做一次性迁移：旧默认值被抬到新默认值", () => {
    // 旧默认组合下面板只透出 14% 的背景，切换预设几乎看不出来，因此需要迁移。
    const legacy = normalizeBackgroundSettings(
      { overlay: 0.55, panelAlpha: 0.86 },
      { migrateLegacyDefaults: true },
    );
    expect(legacy.overlay).toBe(DEFAULT_BACKGROUND_SETTINGS.overlay);
    expect(legacy.panelAlpha).toBe(DEFAULT_BACKGROUND_SETTINGS.panelAlpha);
  });

  it("迁移只认旧默认值，用户手动调过的数值原样保留", () => {
    const custom = normalizeBackgroundSettings(
      { overlay: 0.6, panelAlpha: 0.9 },
      { migrateLegacyDefaults: true },
    );
    expect(custom.overlay).toBe(0.6);
    expect(custom.panelAlpha).toBe(0.9);
  });

  it("不带迁移选项时（写入 / 局部更新路径）旧默认值不会被改写", () => {
    // 否则用户把滑块拖到 55% / 86% 会被“迁移”悄悄改回去。
    const explicit = normalizeBackgroundSettings({ overlay: 0.55, panelAlpha: 0.86 });
    expect(explicit.overlay).toBe(0.55);
    expect(explicit.panelAlpha).toBe(0.86);

    const merged = mergeBackgroundSettings(DEFAULT_BACKGROUND_SETTINGS, {
      overlay: 0.55,
      panelAlpha: 0.86,
    });
    expect(merged.overlay).toBe(0.55);
    expect(merged.panelAlpha).toBe(0.86);
  });

  it("越界数值被夹到允许区间端点", () => {
    const settings = normalizeBackgroundSettings({
      preset: "aurora",
      overlay: 5,
      blur: 999,
      panelAlpha: 0.1,
      particleDensity: -20,
      fxIntensity: 9,
    });
    expect(settings.preset).toBe("aurora");
    expect(settings.overlay).toBe(BACKGROUND_LIMITS.overlay.max);
    expect(settings.blur).toBe(BACKGROUND_LIMITS.blur.max);
    expect(settings.panelAlpha).toBe(BACKGROUND_LIMITS.panelAlpha.min);
    expect(settings.particleDensity).toBe(BACKGROUND_LIMITS.particleDensity.min);
    expect(settings.fxIntensity).toBe(BACKGROUND_LIMITS.fxIntensity.max);
  });

  it("自定义图片元数据非法时整体置空，合法时补齐缺省字段", () => {
    expect(
      normalizeBackgroundSettings({ customImage: { file: "../../etc/passwd" } }).customImage,
    ).toBeNull();
    expect(
      normalizeBackgroundSettings({ customImage: "bg-1.png" }).customImage,
    ).toBeNull();

    const settings = normalizeBackgroundSettings({
      customImage: { file: "bg-test01-ab12cd.png" },
    });
    expect(settings.customImage).toEqual({
      file: "bg-test01-ab12cd.png",
      name: "bg-test01-ab12cd.png",
      updatedAt: new Date(0).toISOString(),
    });
  });
});

describe("mergeBackgroundSettings", () => {
  it("只覆盖补丁里出现的字段，其余保持当前值", () => {
    const current = normalizeBackgroundSettings({ preset: "aurora", overlay: 0.4, blur: 12 });
    const next = mergeBackgroundSettings(current, { overlay: 0.2 });
    expect(next.preset).toBe("aurora");
    expect(next.blur).toBe(12);
    expect(next.overlay).toBe(0.2);
  });

  it("支持显式 null 清除自定义图片", () => {
    const current = normalizeBackgroundSettings({
      customImage: { file: "bg-test01-ab12cd.png", name: "壁纸.png", updatedAt: "2026-09-16T00:00:00.000Z" },
    });
    expect(current.customImage).not.toBeNull();
    expect(mergeBackgroundSettings(current, { customImage: null }).customImage).toBeNull();
  });

  it("补丁非法（数组/字符串）时退化为归一化当前值", () => {
    const current = normalizeBackgroundSettings({ preset: "starfield" });
    expect(mergeBackgroundSettings(current, []).preset).toBe("starfield");
    expect(mergeBackgroundSettings(current, "oops").preset).toBe("starfield");
  });
});

describe("背景资源校验", () => {
  it("文件名白名单拒绝路径穿越与非常规扩展名", () => {
    expect(isSafeBackgroundFileName("bg-lz9x7-abc123.webp")).toBe(true);
    expect(isSafeBackgroundFileName("../secret.png")).toBe(false);
    expect(isSafeBackgroundFileName("bg-lz9x7-abc123.svg")).toBe(false);
    expect(isSafeBackgroundFileName("bg-lz9x7-abc123.png.exe")).toBe(false);
    expect(isSafeBackgroundFileName("BG-UPPER-000000.png")).toBe(false);
    expect(isSafeBackgroundFileName(undefined)).toBe(false);
  });

  it("按 MIME 解析扩展名，只放行四种位图格式", () => {
    expect(resolveBackgroundExtension("image/png")).toBe("png");
    expect(resolveBackgroundExtension("image/jpeg; charset=binary")).toBe("jpg");
    expect(resolveBackgroundExtension("image/webp")).toBe("webp");
    expect(resolveBackgroundExtension("image/gif")).toBe("gif");
    expect(resolveBackgroundExtension("image/svg+xml")).toBeNull();
    expect(resolveBackgroundExtension("application/pdf")).toBeNull();
  });

  it("图片访问地址只在文件名合法时给出", () => {
    expect(
      backgroundImageUrl({ file: "bg-lz9x7-abc123.png", name: "a.png", updatedAt: "x" }),
    ).toBe("/api/ui/background/image/bg-lz9x7-abc123.png");
    expect(backgroundImageUrl(null)).toBeNull();
    expect(
      backgroundImageUrl({ file: "../x.png", name: "x", updatedAt: "x" }),
    ).toBeNull();
  });

  it("读取图片时非法文件名直接拒绝，不触碰磁盘", async () => {
    await expect(readBackgroundImage("../ui-background.json")).resolves.toBeNull();
    await expect(readBackgroundImage("bg-lz9x7-abc123.svg")).resolves.toBeNull();
  });
});

describe("预设与对比度提示", () => {
  it("预设清单包含网格、粒子、星域、极光与纯净五种", () => {
    expect(BACKGROUND_PRESETS.map((preset) => preset.id)).toEqual([
      "grid",
      "particles",
      "starfield",
      "aurora",
      "none",
    ]);
    expect(isBackgroundPresetId("particles")).toBe(true);
    expect(isBackgroundPresetId("grid2")).toBe(false);
  });

  it("使用自定义图片且遮罩过淡时给出对比度风险提示", () => {
    const image = { file: "bg-lz9x7-abc123.png", name: "a.png", updatedAt: "x" };
    const lowOverlay = normalizeBackgroundSettings({ customImage: image, overlay: 0.2 });
    expect(hasContrastRisk(lowOverlay)).toBe(true);
    expect(contrastRiskReason(lowOverlay)).toBe("overlay");

    const safe = normalizeBackgroundSettings({ customImage: image, overlay: 0.55 });
    expect(hasContrastRisk(safe)).toBe(false);
    expect(contrastRiskReason(safe)).toBeNull();

    // 遮罩达标但面板过透时同样提示，且原因区分开。
    const thinPanel = normalizeBackgroundSettings({
      customImage: image,
      overlay: 0.55,
      panelAlpha: CONTRAST_SAFE_PANEL_ALPHA_MIN - 0.1,
    });
    expect(contrastRiskReason(thinPanel)).toBe("panel-alpha");

    expect(hasContrastRisk(normalizeBackgroundSettings({ overlay: 0.1 }))).toBe(false);
    expect(contrastRiskReason(normalizeBackgroundSettings({ overlay: 0.1 }))).toBeNull();
  });
});

describe("clampSetting", () => {
  it("非数字回退兜底值，数字越界夹到区间内", () => {
    expect(clampSetting("0.5", 0, 1, 0.7)).toBe(0.7);
    expect(clampSetting(2, 0, 1, 0.7)).toBe(1);
    expect(clampSetting(-2, 0, 1, 0.7)).toBe(0);
    expect(clampSetting(0.3, 0, 1, 0.7)).toBe(0.3);
  });
});

describe("particleCountForPreset", () => {
  it("密度 0 时返回 0，保证画布被清空", () => {
    expect(particleCountForPreset("particles", 0)).toBe(0);
    expect(particleCountForPreset("starfield", 0)).toBe(0);
  });

  it("随密度单调递增，且高密度段数量足够醒目", () => {
    const samples = [0, 25, 50, 75, 100];
    const counts = samples.map((density) => particleCountForPreset("particles", density));
    expect(counts).toEqual([0, 49, 105, 169, 240]);
    for (let index = 1; index < counts.length; index += 1) {
      expect(counts[index]).toBeGreaterThan(counts[index - 1]);
    }
    // 相邻档位之间必须有明显差距，否则界面上拖滑块看不出变化。
    for (let index = 1; index < counts.length; index += 1) {
      expect(counts[index] - counts[index - 1]).toBeGreaterThan(20);
    }
  });

  it("星域只画星点、不画连线，因此数量高于星链且有各自上限", () => {
    expect(particleCountForPreset("starfield", 100)).toBeGreaterThan(
      particleCountForPreset("particles", 100),
    );
    expect(particleCountForPreset("particles", 100)).toBeLessThanOrEqual(240);
    expect(particleCountForPreset("starfield", 100)).toBeLessThanOrEqual(340);
  });

  it("不使用粒子的预设返回 0，越界与非法密度按区间处理", () => {
    expect(particleCountForPreset("grid", 100)).toBe(0);
    expect(particleCountForPreset("none", 50)).toBe(0);
    expect(particleCountForPreset("particles", 999)).toBe(
      particleCountForPreset("particles", 100),
    );
    expect(particleCountForPreset("particles", -50)).toBe(0);
    expect(particleCountForPreset("particles", Number.NaN)).toBe(0);
  });
});
