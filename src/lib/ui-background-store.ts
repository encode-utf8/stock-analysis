// 背景设置的服务端持久化：设置在 .data/ui-background.json，图片在 .data/backgrounds/。
// 与项目其它降级存储保持一致：文件缺失或损坏时回退默认值，不阻塞页面渲染。
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  BACKGROUND_SETTINGS_VERSION,
  DEFAULT_BACKGROUND_SETTINGS,
  isSafeBackgroundFileName,
  normalizeBackgroundSettings,
  type BackgroundSettings,
} from "@/lib/ui-background";

/** 设置文件与图片目录（均在 .data 下，已随 .gitignore 忽略）。 */
const SETTINGS_FILE = path.join(process.cwd(), ".data", "ui-background.json");
const IMAGE_DIR = path.join(process.cwd(), ".data", "backgrounds");

/** 扩展名到响应 Content-Type 的映射。 */
const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/**
 * 读取背景设置；文件不存在或内容非法时返回默认设置。
 * 存档里没有版本号（或版本过旧）时做一次性旧默认值迁移：
 * 上一版默认「遮罩 0.55 / 面板 0.86」只透出 14% 背景，切换预设几乎看不出差别。
 */
export async function readBackgroundSettings(): Promise<BackgroundSettings> {
  try {
    const raw = await readFile(SETTINGS_FILE, "utf8");
    const parsed = (JSON.parse(raw) ?? {}) as Record<string, unknown>;
    const version = typeof parsed.version === "number" ? parsed.version : 0;
    return normalizeBackgroundSettings(parsed, {
      migrateLegacyDefaults: version < BACKGROUND_SETTINGS_VERSION,
    });
  } catch {
    return { ...DEFAULT_BACKGROUND_SETTINGS };
  }
}

/** 写入背景设置，返回归一化后的落库结果。 */
export async function writeBackgroundSettings(
  settings: BackgroundSettings,
): Promise<BackgroundSettings> {
  const normalized = normalizeBackgroundSettings(settings);
  await mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  // 写入时带上版本号：迁移只做一次，之后用户手动调回旧值不会被改写。
  const payload = { ...normalized, version: BACKGROUND_SETTINGS_VERSION };
  await writeFile(SETTINGS_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return normalized;
}

/** 清空 .data/backgrounds 下的历史图片，保证同时只保留一张自定义背景。 */
async function clearBackgroundImages(): Promise<void> {
  try {
    const files = await readdir(IMAGE_DIR);
    await Promise.all(
      files.map((file) =>
        rm(path.join(IMAGE_DIR, file), { force: true }).catch(() => undefined),
      ),
    );
  } catch {
    // 目录不存在时无需处理。
  }
}

/** 生成落盘文件名：时间戳 + 随机串，扩展名来自上传类型。 */
function buildImageFileName(extension: string): string {
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return "bg-" + stamp + "-" + random + "." + extension;
}

/**
 * 保存自定义背景图片：
 * 先清掉历史图片，再写新文件，最后把元数据并入设置，避免多张并存或半写入状态。
 */
export async function saveBackgroundImage(input: {
  data: Buffer;
  extension: string;
  originalName: string;
}): Promise<BackgroundSettings> {
  const file = buildImageFileName(input.extension);
  await mkdir(IMAGE_DIR, { recursive: true });
  await clearBackgroundImages();
  await writeFile(path.join(IMAGE_DIR, file), input.data);

  const current = await readBackgroundSettings();
  return writeBackgroundSettings({
    ...current,
    customImage: {
      file,
      name: input.originalName.trim() || file,
      updatedAt: new Date().toISOString(),
    },
  });
}

/** 删除自定义背景图片并清空设置中的引用，其余设置保持不变。 */
export async function removeBackgroundImage(): Promise<BackgroundSettings> {
  await clearBackgroundImages();
  const current = await readBackgroundSettings();
  return writeBackgroundSettings({ ...current, customImage: null });
}

/** 读取自定义背景图片二进制；文件名非法或文件缺失时返回 null。 */
export async function readBackgroundImage(
  file: string,
): Promise<{ data: Buffer; contentType: string } | null> {
  if (!isSafeBackgroundFileName(file)) {
    return null;
  }
  const extension = file.split(".").pop()?.toLowerCase() ?? "";
  const contentType = EXTENSION_CONTENT_TYPES[extension];
  if (!contentType) {
    return null;
  }
  try {
    const data = await readFile(path.join(IMAGE_DIR, file));
    return { data, contentType };
  } catch {
    return null;
  }
}
