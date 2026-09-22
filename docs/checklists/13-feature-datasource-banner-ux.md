# 13 数据源故障提示条 UI 修复验收清单

- 分支：`feature/datasource-failure-ux`
- 关联方案：`docs/datasource-banner-ux-plan.md`、`docs/datasource-failure-plan.md`
- 目标：故障提示条改为高对比错误色，并作为唯一的悬浮层固定在顶栏下方，滚动时不与模块菜单栏交替遮挡。
- 状态：已完成（2026-09-22），自测通过，待用户验收。

## 验收项

### 视觉醒目度

- [x] 提示条配色由琥珀改为错误语义（红色实底 + 白字 + 阴影），在深色页面上足够醒目
- [x] 增加警告图标与倒计时药丸，故障状态与常态信息提示可一眼区分
- [x] 保留 `role="status"` / `aria-live="polite"` 无障碍属性
- [x] 提示文案与「N 秒后可重试」措辞保持不变

### 悬浮层级

- [x] 提示条改为 `fixed` 定位，固定在顶栏（`--app-header-h`）下方
- [x] 层级高于模块菜单栏与页内吸顶元素，低于 Toast 与弹窗
- [x] 滚动页面时提示条始终可见，不被页内元素交替覆盖
- [x] 模块菜单栏与工作台侧栏吸顶偏移随提示条高度下移，两者不再同层重叠

### 布局让位

- [x] 新增 `--app-banner-h` 并由提示条实际高度驱动，换行 / 尺寸变化时同步更新
- [x] 无提示时 `--app-banner-h` 归零，页面无残留空档
- [x] 提示条出现时内容整体下移，滚动时正文从提示条下方通过

### 测试与回归

- [x] 端到端：新增悬浮层级 / 滚动不遮挡 / 占位高度断言
- [x] 端到端：既有数据源故障用例（提示 + 按钮禁用 10 秒 + 恢复 + 自动清除）保持通过
- [x] 回归：`typecheck` / `lint` / `test` / `build` / `test:e2e` 全绿

## 改动内容

- `src/components/panels/DatasourceUnavailableNotice.tsx`：错误语义配色（`border-red-400/70` + `bg-red-600` + 白字 + 阴影）、内联警告图标、倒计时药丸（`bg-white/20` + `tabular-nums`）。
- `src/components/panels/DatasourceUnavailableBanner.tsx`：改为 `fixed top-[var(--app-header-h)] z-[60]` 悬浮层；`ResizeObserver` 量取实际高度写入 `--app-banner-h`，隐藏时归零。
- `src/app/globals.css`：新增 `--app-banner-h` 与 `--app-sticky-top`（顶栏 + 提示条）令牌。
- `src/app/page.tsx`：提示条下方新增高度为 `var(--app-banner-h)` 的占位块（`data-testid="datasource-banner-spacer"`）。
- `src/components/panels/ModuleMenuBar.tsx`：吸顶偏移改用 `--app-sticky-top`，新增 `data-testid="module-menu-bar"`。
- `src/components/workbench/StockWorkbench.tsx`、`FundWorkbench.tsx`：侧栏吸顶偏移与高度改用 `--app-sticky-top`。

## 验证方式与结果（2026-09-22）

```powershell
corepack pnpm typecheck   # 通过
corepack pnpm lint        # 通过（0 error / 0 warning）
corepack pnpm test        # 54 个文件 / 639 个用例全绿
corepack pnpm build       # 通过
corepack pnpm test:e2e    # 16 个用例全绿（新增 1 个悬浮层级用例）
```

- 端到端新增用例「故障提示固定悬浮在两栏内容之上且滚动时不互相遮挡」：断言提示条 `position: fixed`、`z-index` 高于模块菜单栏、占位块高度与提示条高度一致、在 3 个滚动位置下提示条与模块菜单栏各自命中自身且不重叠。
- 人工核对：个股 / 基金工作台各截图一次（提示条紧贴顶栏、内容整体下移、滚动时提示条始终在最上层），核对后已删除临时截图脚本与图片。

## 通过标准

- 全部验收项勾选；
- 端到端用例可在浏览器中稳定复现「提示条始终在最上层且不遮挡 / 不被遮挡」；
- 无新增 lint 警告与类型错误。

## 风险与遗留

- 提示条高度由浏览器实时测量，极端超长错误文案会相应增大占位高度（属预期：内容让位优先于提示条紧凑）；
- 手动关闭按钮、提示条折叠等增强不在本次范围。