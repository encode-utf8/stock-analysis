# 数据源故障提示条 UI 修复方案（醒目度与悬浮层级）

- 分支：`feature/datasource-failure-ux`
- 关联文档：`docs/datasource-failure-plan.md`、`docs/checklists/10-feature-datasource-failure.md`、`docs/checklists/13-feature-datasource-banner-ux.md`
- 类型：既有功能的界面缺陷修复（不改动故障判定与冷却逻辑）

## 1. 问题（用户反馈）

1. **醒目度不足**：提示条使用琥珀色（`border-amber-500/30 bg-amber-500/10 text-amber-200`），在深色科技风页面里呈现为淡黄色块，与常态信息提示接近，故障语义不突出。
2. **悬浮置顶失效、交替遮挡**：
   - 提示条为**文档流内 `sticky`**（`top-[68px] z-20`），而内容区顶部的模块菜单栏 `ModuleMenuBar` 同样是 `sticky top-[var(--app-header-h)] z-20`；
   - 两者粘附位置相同（68px）、层级相同（z-20），滚动时由 DOM 顺序决定谁在上层，表现为**交替遮挡**；
   - 提示条参与文档流又与页内内容同层，视觉上「混在一起」，不像独立的悬浮提示层。

## 2. 目标

- 故障提示在任意滚动位置都是**唯一且明确的最上层悬浮层**，不再与页内吸顶元素互相覆盖。
- 故障语义一眼可辨：高对比错误色 + 警告图标 + 剩余冷却秒数。
- 出现时页内内容整体让位、滚动时不遮挡正文；消失后无残留空档。

## 3. 关键设计

### 3.1 视觉：高对比错误色提示条（`DatasourceUnavailableNotice`）

- 配色从琥珀改为错误语义：`border-2 border-red-400/70 bg-red-600 text-white shadow-lg shadow-red-950/50`。
- 结构：左侧内联警告三角图标（`aria-hidden`）+ 提示文案 + 尾部白色半透明药丸倒计时（`bg-white/20`、`tabular-nums`）。
- 保留 `role="status"` / `aria-live="polite"`；提示文案与「N 秒后可重试」措辞不变，保证既有端到端断言与用户认知稳定。

### 3.2 悬浮层：固定定位 + 明确层级（`DatasourceUnavailableBanner`）

- 改为 `fixed inset-x-0 top-[var(--app-header-h)] z-[60]`，外层保持 `max-w-[1440px] px-4 pb-3`：提示条紧贴顶栏，下方留白自带内容间隔。
- 层级约定（由低到高）：页内吸顶元素（模块菜单栏 z-20、复盘弹层 z-50）< **故障提示 z-60** < Toast z-70 < 弹窗 z-80/85。
- 用 `ResizeObserver` 量取提示条实际高度（含顶部留白）写入根元素 CSS 变量 `--app-banner-h`；无提示时写回 `0px`，保证换行或窗口变化时占位高度始终准确。

### 3.3 让位：占位块 + 统一吸顶偏移

- `globals.css` 新增令牌：
  - `--app-banner-h: 0px`（由提示条组件动态写入）；
  - `--app-sticky-top: calc(var(--app-header-h) + var(--app-banner-h))`（吸顶元素统一偏移）。
- `page.tsx` 在提示条后放置高度等于 `var(--app-banner-h)` 的无障碍占位块，内容整体下移，滚动时正文从提示条下方通过。
- `ModuleMenuBar` 与个股 / 基金工作台侧栏的 `sticky top` 与高度改用 `--app-sticky-top`，提示条出现时自动下移，彻底消除同层遮挡。

## 4. 改动范围

| 文件 | 改动 |
| --- | --- |
| `src/components/panels/DatasourceUnavailableNotice.tsx` | 高对比错误色 + 警告图标 + 倒计时药丸 |
| `src/components/panels/DatasourceUnavailableBanner.tsx` | `fixed` 悬浮层、`z-[60]`、测量并写入 `--app-banner-h` |
| `src/app/globals.css` | 新增 `--app-banner-h`、`--app-sticky-top` 令牌 |
| `src/app/page.tsx` | 提示条下方新增占位块 |
| `src/components/panels/ModuleMenuBar.tsx` | 吸顶偏移改用 `--app-sticky-top`，并加 `data-testid` 便于端到端断言 |
| `src/components/workbench/StockWorkbench.tsx`、`FundWorkbench.tsx` | 侧栏吸顶偏移与高度改用 `--app-sticky-top` |
| `tests/e2e/datasource-failure.spec.ts` | 新增悬浮层级 / 滚动不遮挡 / 占位高度断言 |

## 5. 测试与验收

- 端到端：提示条 `position: fixed`、`z-index` 高于模块菜单栏；滚动后提示条中心点仍命中提示条自身（未被任何元素遮挡）；占位块高度与提示条高度一致；原有「提示文案 + 按钮禁用 10 秒 + 自动恢复 + 提示自动清除」全部保持通过。
- 回归：`typecheck` / `lint` / `test` / `build` / `test:e2e`。

## 6. 非目标

- 不改故障判定、官方快照降级、10 秒冷却与文案内容；
- 不新增手动关闭按钮（提示仍由请求成功后自动清除）；
- 不改动顶栏高度与工作台切换逻辑。