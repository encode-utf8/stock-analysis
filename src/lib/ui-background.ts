// 背景画布与交互光效的设置模型。
// 这里只放纯函数与常量：前端渲染、接口校验、单元测试共用同一套规则，
// 避免“接口放行、前端渲染失败”这类前后端口径不一致的问题。

/** 内置背景预设：默认科技网格，另有粒子、星域、极光与纯净底。 */
export type BackgroundPresetId =
  | "grid"
  | "particles"
  | "starfield"
  | "aurora"
  | "none";

/** 用户上传的背景图片元数据（图片本体存放在 .data/backgrounds 下）。 */
export interface BackgroundCustomImage {
  /** 落盘文件名，同时作为图片接口的路径参数。 */
  file: string;
  /** 上传时的原始文件名，仅用于界面展示。 */
  name: string;
  /** 上传时间（ISO 字符串）。 */
  updatedAt: string;
}

/** 背景画布与交互光效的完整设置。 */
export interface BackgroundSettings {
  preset: BackgroundPresetId;
  customImage: BackgroundCustomImage | null;
  /** 背景遮罩强度：越小背景越抢眼，越大内容对比度越高。 */
  overlay: number;
  /** 背景模糊半径（px），自定义图片较花时调大。 */
  blur: number;
  /** 内容面板不透明度：越小面板越透，背景越明显。 */
  panelAlpha: number;
  /** 粒子/星域预设的粒子数量系数（0~100）。 */
  particleDensity: number;
  /** 是否启用光标跟随与点击涟漪等交互光效。 */
  fxEnabled: boolean;
  /** 交互光效强度系数。 */
  fxIntensity: number;
}

/** 预设清单（顺序即界面展示顺序）。 */
export const BACKGROUND_PRESETS: Array<{
  id: BackgroundPresetId;
  label: string;
  description: string;
}> = [
  { id: "grid", label: "科技网格", description: "缓慢漂移的坐标网格，默认背景。" },
  { id: "particles", label: "粒子星链", description: "粒子自发连成链路，光标靠近会自动联结。" },
  { id: "starfield", label: "星域", description: "深空星点缓慢闪烁，光标扫过时被照亮。" },
  { id: "aurora", label: "极光", description: "多层帘幕与流动射线，接近真实的极光动景。" },
  { id: "none", label: "纯净", description: "只保留纯色底，性能开销最低。" },
];

/** 各可调参数的取值区间，接口与前端共用。 */
export const BACKGROUND_LIMITS = {
  overlay: { min: 0, max: 0.9 },
  blur: { min: 0, max: 24 },
  panelAlpha: { min: 0.5, max: 1 },
  particleDensity: { min: 0, max: 100 },
  fxIntensity: { min: 0.3, max: 2 },
} as const;

/** 自定义背景图片体积上限（8MB）。 */
export const MAX_BACKGROUND_IMAGE_BYTES = 8 * 1024 * 1024;

/** 允许上传的图片类型与对应扩展名。 */
export const BACKGROUND_IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** 落盘文件名白名单：防止路径穿越与非法字符。 */
const BACKGROUND_FILE_PATTERN = /^[a-z0-9][a-z0-9-]{5,40}\.(png|jpg|webp|gif)$/;

/*
 * 旧版默认值：上一版用「遮罩 0.55 + 面板 0.86」，面板只透出 14% 的背景，
 * 导致切换内置预设时肉眼几乎看不出差别。这里仅用于把停留在旧默认值的存档抬到新默认值。
 */
const LEGACY_DEFAULT_OVERLAY = 0.55;
const LEGACY_DEFAULT_PANEL_ALPHA = 0.86;

/** 设置结构版本：落盘时写入，读取时据此判断要不要做一次性旧默认值迁移。 */
export const BACKGROUND_SETTINGS_VERSION = 2;

/** 归一化选项：`migrateLegacyDefaults` 只在读取历史存档时为 true。 */
export interface NormalizeBackgroundOptions {
  migrateLegacyDefaults?: boolean;
}

/**
 * 默认设置：科技网格 + 遮罩 0.45 + 面板 0.78。
 * 面板保留 22% 的透射率，让背景在默认参数下就能被看见；该组合下正文字号仍有 ≥ 7:1 对比度。
 */
export const DEFAULT_BACKGROUND_SETTINGS: BackgroundSettings = {
  preset: "grid",
  customImage: null,
  overlay: 0.45,
  blur: 8,
  panelAlpha: 0.78,
  particleDensity: 60,
  fxEnabled: true,
  fxIntensity: 1,
};

/**
 * 旧默认值迁移：只有恰好等于旧默认值的存档才会被抬到新默认值，
 * 用户手动调过的其他数值一律原样保留（例如遮罩 0.6、面板 0.9 不会被改动）。
 */
function migrateLegacyDefault(value: unknown, legacy: number, next: number): unknown {
  return value === legacy ? next : value;
}

/** 数值裁剪：非法输入回退到兜底值，越界则夹到区间端点。 */
export function clampSetting(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

/** 预设标识校验。 */
export function isBackgroundPresetId(value: unknown): value is BackgroundPresetId {
  return BACKGROUND_PRESETS.some((preset) => preset.id === value);
}

/** 粒子数量上限：星域只画星点、不画连线，可以用更高的数量。 */
export const PARTICLE_COUNT_MAX = { particles: 240, starfield: 340 } as const;

/**
 * 把 0~100 的密度换算为画布上的粒子数量。
 * 曲线前段平缓、后段更陡：低密度保持细腻，高密度足够醒目；密度 0 返回 0（画布清空）。
 * 星域（只画星点）按 1.4 倍放大，星链（要画连线）保持较低数量以控制开销。
 */
export function particleCountForPreset(
  preset: BackgroundPresetId,
  density: number,
): number {
  const starfield = preset === "starfield";
  // 网格、极光、纯净这三个预设不使用画布粒子，统一返回 0，避免界面显示与实际绘制不一致。
  if (!starfield && preset !== "particles") {
    return 0;
  }
  const ratio =
    clampSetting(
      density,
      BACKGROUND_LIMITS.particleDensity.min,
      BACKGROUND_LIMITS.particleDensity.max,
      0,
    ) / 100;
  const base = ratio * ratio * 60 + ratio * 180;
  const value = starfield ? base * 1.4 : base;
  const max = starfield ? PARTICLE_COUNT_MAX.starfield : PARTICLE_COUNT_MAX.particles;
  return Math.round(Math.min(max, value));
}

/** 文件名安全校验：只允许白名单字符，且扩展名受限（同时作为类型收窄）。 */
export function isSafeBackgroundFileName(value: unknown): value is string {
  return typeof value === "string" && BACKGROUND_FILE_PATTERN.test(value);
}

/** 根据上传的 MIME 类型解析落盘扩展名；不支持的类型返回 null。 */
export function resolveBackgroundExtension(mimeType: string): string | null {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return BACKGROUND_IMAGE_TYPES[normalized] ?? null;
}

/** 自定义图片是否存在且文件名合法。 */
function normalizeCustomImage(value: unknown): BackgroundCustomImage | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<BackgroundCustomImage>;
  if (!isSafeBackgroundFileName(raw.file)) {
    return null;
  }
  return {
    file: raw.file,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : raw.file,
    updatedAt:
      typeof raw.updatedAt === "string" && raw.updatedAt.trim()
        ? raw.updatedAt
        : new Date(0).toISOString(),
  };
}

/** 任意输入归一化为合法设置；缺字段与非法值一律回退到默认值。 */
export function normalizeBackgroundSettings(
  input: unknown,
  options?: NormalizeBackgroundOptions,
): BackgroundSettings {
  const raw = (input ?? {}) as Partial<BackgroundSettings>;
  const limits = BACKGROUND_LIMITS;
  const migrate = options?.migrateLegacyDefaults === true;
  // 迁移只在读取历史存档时打开：用户之后手动把滑块拖回旧值不会被再次改写。
  const rawOverlay = migrate
    ? migrateLegacyDefault(
        raw.overlay,
        LEGACY_DEFAULT_OVERLAY,
        DEFAULT_BACKGROUND_SETTINGS.overlay,
      )
    : raw.overlay;
  const rawPanelAlpha = migrate
    ? migrateLegacyDefault(
        raw.panelAlpha,
        LEGACY_DEFAULT_PANEL_ALPHA,
        DEFAULT_BACKGROUND_SETTINGS.panelAlpha,
      )
    : raw.panelAlpha;

  return {
    preset: isBackgroundPresetId(raw.preset)
      ? raw.preset
      : DEFAULT_BACKGROUND_SETTINGS.preset,
    customImage: normalizeCustomImage(raw.customImage),
    overlay: clampSetting(
      rawOverlay,
      limits.overlay.min,
      limits.overlay.max,
      DEFAULT_BACKGROUND_SETTINGS.overlay,
    ),
    blur: clampSetting(
      raw.blur,
      limits.blur.min,
      limits.blur.max,
      DEFAULT_BACKGROUND_SETTINGS.blur,
    ),
    panelAlpha: clampSetting(
      rawPanelAlpha,
      limits.panelAlpha.min,
      limits.panelAlpha.max,
      DEFAULT_BACKGROUND_SETTINGS.panelAlpha,
    ),
    particleDensity: clampSetting(
      raw.particleDensity,
      limits.particleDensity.min,
      limits.particleDensity.max,
      DEFAULT_BACKGROUND_SETTINGS.particleDensity,
    ),
    fxEnabled:
      typeof raw.fxEnabled === "boolean"
        ? raw.fxEnabled
        : DEFAULT_BACKGROUND_SETTINGS.fxEnabled,
    fxIntensity: clampSetting(
      raw.fxIntensity,
      limits.fxIntensity.min,
      limits.fxIntensity.max,
      DEFAULT_BACKGROUND_SETTINGS.fxIntensity,
    ),
  };
}

/**
 * 局部更新：只覆盖补丁中显式出现的字段（含显式 null，用于清除自定义图片），
 * 其余字段保持当前值，最后统一走一次归一化。
 */
export function mergeBackgroundSettings(
  current: BackgroundSettings,
  patch: unknown,
): BackgroundSettings {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return normalizeBackgroundSettings(current);
  }

  const source = patch as Record<string, unknown>;
  const next: Record<string, unknown> = { ...current };
  const keys: Array<keyof BackgroundSettings> = [
    "preset",
    "customImage",
    "overlay",
    "blur",
    "panelAlpha",
    "particleDensity",
    "fxEnabled",
    "fxIntensity",
  ];

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      next[key] = source[key];
    }
  }

  return normalizeBackgroundSettings(next);
}

/** 自定义背景图片的访问地址；没有自定义图片时返回 null。 */
export function backgroundImageUrl(
  image: BackgroundCustomImage | null | undefined,
): string | null {
  return image && isSafeBackgroundFileName(image.file)
    ? `/api/ui/background/image/${image.file}`
    : null;
}

/**
 * 对比度保障阈值：使用自定义图片时，遮罩与面板不透明度低于该值就可能压不住背景。
 * 这两个数值与默认值（遮罩 0.55 / 面板 0.86）一起构成“内容始终可读”的兜底。
 */
export const CONTRAST_SAFE_OVERLAY_MIN = 0.3;
export const CONTRAST_SAFE_PANEL_ALPHA_MIN = 0.65;

/** 对比度风险类型：遮罩过淡 / 面板过透；无风险时为 null。 */
export type ContrastRiskReason = "overlay" | "panel-alpha" | null;

/**
 * 判断使用自定义图片时是否存在对比度风险。
 * 界面据此给出针对性提示，但不强制修改用户设置（用户可以自行判断）。
 */
export function contrastRiskReason(settings: BackgroundSettings): ContrastRiskReason {
  if (!settings.customImage) {
    return null;
  }
  if (settings.overlay < CONTRAST_SAFE_OVERLAY_MIN) {
    return "overlay";
  }
  if (settings.panelAlpha < CONTRAST_SAFE_PANEL_ALPHA_MIN) {
    return "panel-alpha";
  }
  return null;
}

/** 是否存在对比度风险（供简单判断使用）。 */
export function hasContrastRisk(settings: BackgroundSettings): boolean {
  return contrastRiskReason(settings) !== null;
}
