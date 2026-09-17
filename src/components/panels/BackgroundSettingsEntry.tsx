"use client";

// 背景与光效设置入口：工作台右上角按钮 + 设置弹窗。
// 所有参数改动都即时预览（写全局 CSS 变量），并防抖同步到服务端。
import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  BACKGROUND_PRESETS,
  MAX_BACKGROUND_IMAGE_BYTES,
  backgroundImageUrl,
  contrastRiskReason,
  particleCountForPreset,
  type BackgroundPresetId,
} from "@/lib/ui-background";
import { useBackgroundSettings } from "@/lib/ui-background-client";

/** 滑块行：标签 + 当前值 + 原生 range 输入。 */
function RangeField({
  label,
  hint,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between gap-2 text-xs">
        <span className="text-foreground">{label}</span>
        <span className="font-mono text-muted-foreground">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 w-full cursor-pointer"
        style={{ accentColor: "var(--primary)" }}
      />
      <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">
        {hint}
      </span>
    </label>
  );
}

/** 背景与光效设置入口。 */
export function BackgroundSettingsEntry() {
  const { settings, sync, update, upload, clearImage, reset } = useBackgroundSettings();
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const selectPreset = useCallback(
    (preset: BackgroundPresetId) => {
      update({ preset });
    },
    [update],
  );

  /** 上传前先做本地校验，超限或类型不符时立即提示，不发请求。 */
  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) {
        return;
      }
      if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
        setError("仅支持 PNG / JPEG / WebP / GIF 图片。");
        return;
      }
      if (file.size > MAX_BACKGROUND_IMAGE_BYTES) {
        setError("图片体积需小于 8MB。");
        return;
      }

      setUploading(true);
      setError(null);
      try {
        await upload(file);
      } catch (uploadError) {
        setError(
          uploadError instanceof Error ? uploadError.message : "背景图片上传失败。",
        );
      } finally {
        setUploading(false);
      }
    },
    [upload],
  );

  const handleClearImage = useCallback(async () => {
    setError(null);
    try {
      await clearImage();
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "背景图片删除失败。");
    }
  }, [clearImage]);

  const handleReset = useCallback(async () => {
    setError(null);
    try {
      await reset();
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "恢复默认设置失败。");
    }
  }, [reset]);

  const syncText =
    sync.status === "saving"
      ? "保存中..."
      : sync.status === "saved"
        ? "已保存"
        : sync.status === "error"
          ? (sync.message ?? "保存失败")
          : "改动会自动保存";

  // 对比度提示按风险来源给不同建议：遮罩太淡压低背景，面板太透压不住背景。
  const risk = contrastRiskReason(settings);
  // 密度滑块的实时反馈：直接给出会画到画布上的粒子数量，避免“拖了没感觉”。
  const particleCount = particleCountForPreset(settings.preset, settings.particleDensity);
  const particlePreset =
    settings.preset === "particles" || settings.preset === "starfield";
  const riskText =
    risk === "overlay"
      ? "当前遮罩较淡，自定义图片较亮时可能影响文字可读性；建议把遮罩调到 40% 以上。"
      : risk === "panel-alpha"
        ? "当前面板较透明，自定义图片较花时内容区容易受干扰；建议把面板不透明度调到 70% 以上。"
        : null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        title="自定义背景画布与交互光效"
        className="gap-1.5"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-5-5-11 11" />
        </svg>
        背景与光效
      </Button>

      {open
        ? createPortal(
            <div
              className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
              onClick={() => setOpen(false)}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="background-settings-title"
                className="tech-panel flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
                  <div className="min-w-0">
                    <h2
                      id="background-settings-title"
                      className="tech-title text-base font-semibold"
                    >
                      背景画布与交互光效
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      可替换系统背景画布，并调节遮罩、模糊与面板透明度；参数改动即时预览。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="关闭"
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-5 w-5"
                      aria-hidden="true"
                    >
                      <path d="M18 6 6 18" />
                      <path d="m6 6 12 12" />
                    </svg>
                  </button>
                </div>

                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
                  <section className="space-y-2">
                    <h3 className="text-sm font-medium">内置背景</h3>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {BACKGROUND_PRESETS.map((preset) => {
                        const active = preset.id === settings.preset;
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => selectPreset(preset.id)}
                            aria-pressed={active}
                            className={
                              "rounded-lg border px-3 py-2 text-left transition-colors " +
                              (active
                                ? "border-primary/60 bg-accent text-accent-foreground"
                                : "border-border bg-muted/40 text-foreground hover:border-primary/40 hover:bg-accent/60")
                            }
                          >
                            <span className="block text-sm font-medium">
                              {preset.label}
                            </span>
                            <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                              {preset.description}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  <section className="space-y-2">
                    <h3 className="text-sm font-medium">自定义背景图片</h3>
                    <div className="flex flex-wrap items-center gap-2">
                      {settings.customImage ? (
                        <span
                          aria-hidden="true"
                          className="h-10 w-16 shrink-0 rounded-md border border-border bg-cover bg-center"
                          style={{
                            backgroundImage:
                              "url(" + (backgroundImageUrl(settings.customImage) ?? "") + ")",
                          }}
                        />
                      ) : null}
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="hidden"
                        onChange={(event) => void handleFileChange(event)}
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => fileRef.current?.click()}
                        disabled={uploading}
                      >
                        {uploading ? "上传中..." : "上传本地图片"}
                      </Button>
                      {settings.customImage ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void handleClearImage()}
                        >
                          移除自定义图片
                        </Button>
                      ) : null}
                      <span className="text-xs text-muted-foreground">
                        {settings.customImage
                          ? settings.customImage.name +
                            "（" +
                            new Date(settings.customImage.updatedAt).toLocaleString("zh-CN", {
                              hour12: false,
                            }) +
                            "）"
                          : "支持 PNG / JPEG / WebP / GIF，单张不超过 8MB。"}
                      </span>
                    </div>
                  </section>

                  {riskText ? (
                    <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                      {riskText}
                    </p>
                  ) : null}

                  <section className="space-y-4">
                    <h3 className="text-sm font-medium">显示参数</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <RangeField
                        label="背景遮罩"
                        hint="越大内容对比度越高，背景越含蓄。"
                        value={settings.overlay}
                        min={0}
                        max={0.9}
                        step={0.05}
                        display={Math.round(settings.overlay * 100) + "%"}
                        onChange={(value) => update({ overlay: value })}
                      />
                      <RangeField
                        label="背景模糊"
                        hint="自定义图片细节过多时可调大。"
                        value={settings.blur}
                        min={0}
                        max={24}
                        step={1}
                        display={settings.blur + "px"}
                        onChange={(value) => update({ blur: value })}
                      />
                      <RangeField
                        label="面板不透明度"
                        hint="越小面板越透，背景越明显。"
                        value={settings.panelAlpha}
                        min={0.5}
                        max={1}
                        step={0.02}
                        display={Math.round(settings.panelAlpha * 100) + "%"}
                        onChange={(value) => update({ panelAlpha: value })}
                      />
                      <RangeField
                        label="粒子密度"
                        hint={
                          "按当前密度约绘制 " +
                          particleCount +
                          " 颗粒子" +
                          (particlePreset
                            ? "，拖动即可看到疏密变化。"
                            : "；当前预设不使用粒子，切到“粒子星链 / 星域”后生效。")
                        }
                        value={settings.particleDensity}
                        min={0}
                        max={100}
                        step={5}
                        display={particleCount + " 颗"}
                        onChange={(value) => update({ particleDensity: value })}
                      />
                    </div>
                  </section>

                  <section className="space-y-3">
                    <h3 className="text-sm font-medium">交互光效</h3>
                    <label className="flex items-center gap-2 text-xs text-foreground">
                      <input
                        type="checkbox"
                        checked={settings.fxEnabled}
                        onChange={(event) => update({ fxEnabled: event.target.checked })}
                        className="h-4 w-4 cursor-pointer"
                        style={{ accentColor: "var(--primary)" }}
                      />
                      启用光标跟随、点击涟漪与粒子反馈
                    </label>
                    <RangeField
                      label="光效强度"
                      hint="强度越高，光晕与粒子越明显。"
                      value={settings.fxIntensity}
                      min={0.3}
                      max={2}
                      step={0.1}
                      display={settings.fxIntensity.toFixed(1) + " 倍"}
                      onChange={(value) => update({ fxIntensity: value })}
                    />
                  </section>
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-5 py-3">
                  <p
                    className={
                      "text-[11px] " +
                      (sync.status === "error" ? "text-red-300" : "text-muted-foreground")
                    }
                  >
                    {error ?? syncText}
                  </p>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleReset()}
                    >
                      恢复默认
                    </Button>
                    <Button type="button" size="sm" onClick={() => setOpen(false)}>
                      完成
                    </Button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
