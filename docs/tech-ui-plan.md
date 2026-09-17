# 科技风 UI 与自定义背景方案

- 文档版本：v1.0
- 编制日期：2026-09-16
- 分支：`feature/tech-ui-custom-background`
- 关联文档：`docs/design.md`（技术设计）、`README.md`（能力清单）
- 需求来源：用户四项要求——① UI 改为更具科技风；② 交互效果增强（光标移动与点击动态效果）；③ 切换风格后颜色协调、内容与界面对比度达标；④ 新增页面自定义背景功能（可自行替换系统背景画布）。

---

## 1. 可行性分析

- 技术可行：项目为 Next.js App Router + TypeScript + Tailwind CSS v4，主题令牌集中在 `src/app/globals.css` 的 `@theme inline` 与 `:root`，具备统一换肤入口。
- 主要工作量不在“换色”，而在“去硬编码”：全仓盘点出 `bg-white` 80 处、`text-slate-*` 89 处、`bg-slate-*` 47 处、`border-slate-*` 11 处、状态色（red/green/amber/blue）约 250 处，且图表 SVG 内写死 17 种十六进制色值（`#737373`、`#e5e7eb`、`#334155` 等在暗色底上不可读）。
- 风险点：
  1. `backdrop-filter` 会成为 `position: fixed` 后代的包含块。顶栏、侧栏、面板若加毛玻璃，会让弹窗错位。现有 `ConfirmDialog`/`NoticeDialog` 未走 Portal，需要先补 Portal 再上毛玻璃；`DataConsistencyEntry` 已用 `createPortal`，无此问题。
  2. 自定义背景图片可能过亮/过花，导致文字对比度不足。方案用“可调遮罩 + 面板不透明度 + 默认对比度保障值”三重兜底，并在设置里给出对比度提示。
  3. 动效开销：粒子与光标光效使用单 canvas + rAF，且尊重 `prefers-reduced-motion`，可一键关闭。
- 结论：可实现，无阻塞项，不需要用户决策即可进入开发。

---

## 2. 设计体系（科技风）

### 2.1 配色令牌（暗色科技风，替换原“简约洁白”）

| 语义 | CSS 变量 | 取值 | 说明 |
| --- | --- | --- | --- |
| 页面底色 | `--background` | `#050b18` | 深空蓝黑，衬托霓虹青 |
| 主文本 | `--foreground` | `#e6f1ff` | 冷白，正文对比度 ≥ 12:1 |
| 次级文本 | `--muted-foreground` | `#8ba3c7` | 说明文字，对比度 ≥ 4.6:1 |
| 面板底 | `--card` | `rgb(13 24 45 / var(--panel-alpha))` | 半透明深蓝，透明度可调 |
| 主色 | `--primary` | `#22d3ee` | 科技青，用于按钮/进度/高亮 |
| 强调底 | `--accent` | `rgba(34,211,238,.14)` | 悬停、选中、标签底 |
| 描边 | `--border` | `rgba(94,160,214,.22)` | 冷蓝描边；悬停转青光 |
| 聚焦环 | `--ring` | `rgba(34,211,238,.65)` | 键盘可用性 |
| 涨 / 跌 | `text-red-400` / `text-emerald-300` | — | 保持 A 股“涨红跌绿”口径 |

### 2.2 对比度规则（需求③）

- 正文/数值一律落在 `--foreground` 或 `--muted-foreground`，不再出现 `text-slate-*` 死色值。
- 状态色统一「深色底 + 300/400 级文字 + 10%~15% 透明色块」：
  - 红（风险/下跌）：`bg-red-500/10` + `text-red-300` + `border-red-500/30`
  - 绿（正常/上涨）：`bg-emerald-500/10` + `text-emerald-300` + `border-emerald-500/30`
  - 琥珀（提醒）：`bg-amber-500/10` + `text-amber-300` + `border-amber-500/30`
  - 青蓝（信息）：`bg-sky-500/10` + `text-sky-300` + `border-sky-500/30`
- 自定义背景时：遮罩默认 0.45；面板不透明度默认 0.78；遮罩低于 0.3、面板低于 0.65 时设置面板给出对比度提示。
- 实测（面板内真实渲染像素 vs 文字颜色）：默认参数下正文 14.9:1 / 次级文字 7.2:1；即使叠一张纯白自定义图片，正文仍有 12.3:1、次级文字 5.9:1，满足“背景随便换、文字始终可读”。

### 2.3 组件改造规则

- 卡片/面板：`bg-white … shadow-sm` → `tech-panel`（半透明深蓝 + 冷蓝描边 + 悬停辉光）。
- 弹窗：`bg-white` → `bg-popover`，底栏 `bg-slate-50` → `bg-muted/50`，并改为 Portal 渲染。
- 顶栏：`bg-white/95` → `bg-card/70 backdrop-blur-xl` + 底部青光渐变线。
- 输入框：聚焦时青色光晕（`--ring`），保持既有 `focus:ring-*` 用法。
- 图表：SVG 写死色值改为 CSS 变量（`--chart-grid` / `--chart-text` / `--chart-tooltip-*` / `--chart-marker`），系列色在暗底上提亮（蓝 `#2563eb` → `#3b82f6`）。

### 2.4 交互动效（需求②）

| 场景 | 效果 | 实现 |
| --- | --- | --- |
| 光标移动 | 青色跟随光晕 + 环形光环 + 中心点，两层不同速度形成拖尾 | 固定层 + rAF 指数缓动 + 皮带约束，仅在 `(pointer: fine)` 启用 |
| 悬停可交互元素 | 光环放大、变色 | `mouseover` 委托 + `closest()` 判定 |
| 点击 | 扩散环 + 粒子迸发 | `pointerdown` 动态创建节点，动画结束自移除 |
| 光标接入星链 | 半径 180px 内的粒子向光标连线（越近越亮），并被轻吸到 74px 停靠环上；离开半径立即断开 | `pointermove` 记录坐标 + 画布逐帧绘制；引力系数 0.07 |
| 悬停卡片/按钮 | 描边发光、轻微上浮、按下缩放 | `.tech-panel` / 全局按钮样式 |
| 键盘 | 保留 `focus-visible` 青色环，不依赖动效 | `--ring` 令牌 |
| 降低动效 | `prefers-reduced-motion` 或设置中关闭 | 设置项 `fxEnabled` / `fxIntensity` |

跟随缓动规则（`src/lib/fx-motion.ts`，均有单测）：

- 指数缓动 `1 - e^(-Δt / tau)`：与刷新率无关，60Hz 与 144Hz 手感一致；固定比例缓动会让高刷屏追得更快、低帧率下掉队。
- 皮带约束：落后距离超过上限时按 `(d - max) / d` 的比例补拉，把拖尾距离硬性封顶——这正是上一版「特效停在原地」的根因修复。
- 帧间隔统一由 `normalizeFrameDelta` 夹在 0~64ms；粒子物理步长由 `physicsSteps` 折算（60fps = 1 步，夹在 0.25~2.5 步），衰减系数由 `decayFactor` 按 `0.93 ^ 步长` 折算。
- 参数：光环 `tau 55ms / 上限 90px`，光晕 `tau 110ms / 上限 150px`。

### 2.5 自定义背景（需求④）

- 预设：每个预设由「底色 + 大范围洗染（`.app-backdrop`）」「结构纹理（`__preset`）」「光晕（`__glow`）」三层组成。底色洗染铺满整个视口，决定了隔着半透明面板也能看到的第一眼差异，因此五个预设有意采用不同主色调：

| 预设 | 主色调 | 结构纹理 | 备注 |
| --- | --- | --- | --- |
| `grid` 科技网格 | 明亮蓝 | 48px 细格 + 240px 粗格 + 底部青光地平线 | 默认 |
| `particles` 粒子星链 | 墨青绿 | canvas 发光粒子 + 近邻连线 | 受粒子密度控制 |
| `starfield` 星域 | 紫罗兰黑 | 260px 平铺星点（整屏数百颗）+ canvas 星点 | 受粒子密度控制 |
| `aurora` 极光 | 青紫高饱和 | canvas 逐列绘制的 5 条极光帘幕（射线纹理 + 正弦摆动 + 逐列明暗跳动）+ 贴地平线的青绿余辉 | 视觉对比最强 |
| `none` 纯净 | 纯深蓝黑 | 无纹理、无光晕、无粒子 | 性能开销最低 |

- 自定义图片：支持 png/jpg/webp/gif，单张 ≤ 8MB；落盘 `.data/backgrounds/`，元数据写 `.data/ui-background.json`。
- 可调参数：背景模糊 0–24px、遮罩强度 0–0.9、面板不透明度 0.5–1、粒子密度 0–100、交互光效开关与强度 0.5–2。
- 粒子数量换算（`particleCountForPreset`）：密度 0→0、25→49、50→105、75→169、100→240；星域只画星点不画连线，按 1.4 倍计算、上限 340。密度 0 时画布完全清空。
- 连线渲染按透明度分 6 档批量描边，避免高密度下逐条连线切换画笔；连线距离随密度从 132px 收缩到 90px，防止高密度糊成一片。

动态层渲染规则（`BackgroundCanvas`）：

- 图层自下而上为「自定义图片 → 预设纹理 → 光晕 → 遮罩 → canvas 动态层」；动态层不再被遮罩压暗，改为按遮罩值缩放亮度（`1 - overlay × 0.45`），「背景遮罩」滑杆因此仍然有效。
- 粒子与光标核心用 64px 发光贴片绘制（中心近白 → 青 → 透明），暗底上的视觉权重远高于小实心圆点。
- 极光纹理为 `1024 × 384`：竖直方向「上淡下浓 + 底缘一道亮线」（真实帘幕最亮处即下边缘），横向叠 64 条粗细/长短/明暗随机的射线，各帘幕的取样起点错开。
- 极光逐列渲染时按 16px 列宽从纹理上「切条」（源宽 = 目标宽），射线保持 1:1 粗细，且纹理不会以列宽为周期重复；列间只做周期 ≥ 520px 的平滑明暗流动，避免每 16px 出现竖向接缝。
- 生效与持久化：`localStorage` 立即生效（首屏不闪），服务端持久化保证跨浏览器/重启一致；参数变更即预览、防抖落库。
- 降级：接口不可用时仅用本地设置运行；上传失败提示原因且不影响既有背景。

---

## 3. 数据与接口设计

### 3.1 本地存储

```
.data/ui-background.json      # 背景与交互光效设置（单文件）
.data/backgrounds/<id>.<ext>  # 用户上传的背景图片（同一时间仅保留一张自定义图片）
```

### 3.2 设置模型

```ts
interface BackgroundSettings {
  preset: grid | particles | starfield | aurora | none;
  customImage: { file: string; name: string; updatedAt: string } | null;
  overlay: number;     // 遮罩强度 0~0.9，默认 0.45
  blur: number;        // 背景模糊 0~24px，默认 8
  panelAlpha: number;  // 面板不透明度 0.5~1，默认 0.78
  particleDensity: number; // 粒子密度 0~100，默认 60
  fxEnabled: boolean;  // 交互光效开关，默认 true
  fxIntensity: number; // 交互光效强度 0.5~2，默认 1
}
```

**旧默认值迁移（一次性）**：上一版默认「遮罩 0.55 / 面板 0.86」下，面板只透出 14% 的背景，切换预设几乎看不出差别。存档写入时带 `version: 2`，读取时若发现没有版本号（或版本更旧），才把“恰好等于旧默认值”的字段抬到新默认值（0.45 / 0.78），其余字段一律原样保留；写回后再读就不会再迁移。这样用户之后手动把滑块拖回 55% / 86% 也能正常保存，不会被迁移悄悄改回去。

### 3.3 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/ui/background` | 读取设置（缺失文件返回默认值） |
| PUT | `/api/ui/background` | 局部更新设置，字段归一化后再落盘 |
| POST | `/api/ui/background/upload` | multipart 上传图片并设为自定义背景 |
| DELETE | `/api/ui/background` | 清除自定义背景图片，其余设置保留 |
| GET | `/api/ui/background/image/[file]` | 输出背景图片二进制（严格校验文件名） |

---

## 4. 改动范围

- 主题与全局样式：`src/app/globals.css`（令牌、`tech-panel`、背景层、动效关键帧）。
- 外壳：`src/app/layout.tsx`、`src/app/page.tsx`（挂载背景层与光效层、顶栏透明化、设置入口）。
- 新增：
  - `src/lib/ui-background.ts`（模型与纯函数，供前后端复用与单测）
  - `src/lib/ui-background-store.ts`（`.data` 读写与图片落盘）
  - `src/lib/ui-background-client.ts`（浏览器侧读写 / 广播 / 防抖落库）
  - `src/components/fx/BackgroundCanvas.tsx`（背景图、预设、粒子、遮罩）
  - `src/components/fx/InteractionFX.tsx`（光标光晕、点击涟漪与粒子）
  - `src/components/panels/BackgroundSettingsEntry.tsx`（背景与光效设置弹窗）
  - `src/app/api/ui/background/route.ts`、`.../upload/route.ts`、`.../image/[file]/route.ts`
  - `tests/ui-background.test.ts`
- 批量改造：`src/components/**` 约 46 个文件的硬编码颜色 → 语义令牌；图表 6 个组件色值 → CSS 变量。
- 兼容改造：`src/components/ui/confirm-dialog.tsx`、`notice-dialog.tsx` 改 Portal，避免毛玻璃祖先破坏定位。
- 运维一致性：`src/lib/data-consistency.ts` 把新增 `.data` 文件登记为「设置文件，保持不动」。

---

## 5. 测试与验收

- 单测（vitest）：设置归一化/越界裁剪/非法预设回退、上传文件名安全校验、图片类型与体积校验、默认值与局部更新合并。
- 静态：`corepack pnpm typecheck`、`lint`、`test`、`build`。
- 端到端（dev 3000）：GET/PUT 设置接口、上传接口（含超限与非法类型拒绝）、图片输出接口、页面渲染截图核对顶栏/面板/图表/弹窗配色与对比度。
- 视觉验收：用 Chrome 无头截图核对默认背景、预设切换、自定义图片、遮罩与面板透明度调节后的可读性。

---

## 6. 风险与替代方案

- 若自定义图片对比度过低：调高遮罩/面板不透明度即可恢复；设置面板会提示。
- 若毛玻璃导致弹窗错位：弹窗已统一 Portal 到 `body`，并把毛玻璃限制在顶栏、侧栏、弹窗等确定安全的容器上。
- 若动效影响性能：可在设置中关闭交互光效或降低粒子密度；`prefers-reduced-motion` 用户默认关闭动效。
