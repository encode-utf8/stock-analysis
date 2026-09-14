# 侧栏信息架构与横向模块菜单改造方案（sidebar-ux）

- 分支：`feature/sidebar-ux`
- 关联验收：`checklist.md` 中「侧栏瘦身与横向模块菜单（2026-09-14）」章节

## 1. 问题（用户反馈）

1. 自选基金（自选股）数量可能很多，堆在左侧功能栏会把侧栏撑得越来越长。
2. 侧栏自上而下塞了「代码查询 + 自选列表 + 模块勾选列表（个股 14 项 / 基金 16 项）+ 全选清空」，模块勾选区固定占用约 600px 高度，真正高频的模块切换被挤到折叠线以下，必须滚动才能操作。
3. 顺带发现的布局缺陷：页面顶部的「工作台切换」条是 `sticky top-0 z-20`，而工作台侧栏是 `sticky top-0 h-screen`，滚动后侧栏顶部（标题与收起按钮）会被切换条盖住。

## 2. 目标

- 模块切换从「侧栏纵向勾选列表」改为「内容区顶部横向菜单」，始终可见（吸顶），不再受自选数量影响。
- 侧栏只保留高频的「标的」操作：代码查询 + 自选管理。
- 自选列表在数量增长时可控：可搜索过滤、可折叠添加表单、列表内部滚动。
- 修正吸顶偏移，消除侧栏被顶部切换条遮挡的问题。

## 3. 方案设计

### 3.1 新增横向模块菜单 `src/components/panels/ModuleMenuBar.tsx`

- 泛型组件 `ModuleMenuBar<K extends string>`，个股与基金工作台共用（分别传入 `MODULE_OPTIONS` / `FUND_MODULE_OPTIONS`）。
- 一行布局：左侧「功能模块 + 已选计数」，中间横向可滚动的模块 chip 列表，右侧「全选 / 清空」。
- chip 交互：单击切换启用状态（已选用主色填充 + ✓ 标记，未选用描边），拖拽调整展示顺序（保留原有能力）。
- 为避免切换时 chip 宽度跳动，✓ 标记占位固定宽度。
- 吸顶：`sticky top-[var(--app-header-h)] z-20`，滚动时始终可用。

### 3.2 侧栏精简为「自选与查询」

- `FunctionOptionsSidebar.tsx` / `FundOptionsSidebar.tsx` 移除模块勾选列表与底部「全选 / 清空」，改为：代码查询（输入框与按钮同行，压缩约 40px）+ 自选面板。
- 侧栏标题由「功能选项」改为「自选与查询」，折叠后的竖排标签由「功能选项」改为「自选」。
- 侧栏 `h-screen` 改为 `h-full`（高度交给外层 sticky 容器），配合 3.4 的偏移修正。
- 保留导出 `MODULE_OPTIONS` / `ModuleKey` / `DEFAULT_MODULE_VISIBILITY` / `ALL_MODULE_VISIBILITY`、`FUND_MODULE_OPTIONS` / `FundModuleKey` / `DEFAULT_FUND_MODULE_VISIBILITY` / `ALL_FUND_MODULE_VISIBILITY`，避免影响其他引用。
- 仅精简 props：移除侧栏已不再使用的 `enabledModules` / `moduleOrder` / `onToggleModule` / `onReorderModule` / `onSelectAll` / `onClearAll`。

### 3.3 自选面板瘦身（`WatchlistSidebar.tsx` / `FundWatchlistPanel.tsx`）

- 标题行右侧新增「＋ 添加」按钮，添加表单默认收起（原先是常驻 3 个输入框 + 按钮，约 160px）。
- 新增搜索框：按代码 / 名称 / 备注 / 分组过滤（个股含分组），列表按过滤结果分组渲染。
- 列表容器 `max-h-[52vh] overflow-y-auto`：自选再多也不会把侧栏撑长，搜索框与添加按钮恒定可见。
- 基金条目操作按钮由纵向排列（备注 / 删除两行）改为横向一行，降低单条高度；实时涨跌按 A 股口径红涨绿跌着色，与个股保持一致。

### 3.4 吸顶偏移与整体布局

- `globals.css` 新增变量 `--app-header-h: 68px`（顶部工作台切换条高度）。
- `src/app/page.tsx` 顶部条固定为 `h-[68px] z-30`，高度确定后各吸顶元素可精确对齐。
- 两个工作台：侧栏容器改 `sticky top-[var(--app-header-h)] h-[calc(100vh_-_var(--app-header-h))]`；内容区原「标题大卡片」改为紧凑标题行（标题 + 说明 + 当前时间同行），下方依次是 `ModuleMenuBar`、实时行情条、错误提示、模块区、页脚。
- 内容区上下内边距 `py-8` 收紧为 `py-6`，模块栈间距维持 `gap-6`。

### 3.5 实时行情条同步瘦身（`RealtimeQuoteBar.tsx`）

- 该卡片按自选池逐只渲染，自选很多时会跟着变高，属于同类臃肿。
- 默认只展示前 6 只，底部提供「展开全部（共 N 只）/ 收起」按钮；未超过 6 只时不显示按钮。

## 4. 影响范围

| 文件 | 改动 |
| --- | --- |
| `src/components/panels/ModuleMenuBar.tsx` | 新增：横向模块菜单 |
| `src/components/panels/FunctionOptionsSidebar.tsx` | 精简为自选与查询 |
| `src/components/panels/fund/FundOptionsSidebar.tsx` | 精简为自选与查询 |
| `src/components/panels/WatchlistSidebar.tsx` | 搜索过滤、添加表单折叠、列表内滚动、条目紧凑化 |
| `src/components/panels/fund/FundWatchlistPanel.tsx` | 同上（无分组） |
| `src/components/workbench/StockWorkbench.tsx` | 挂载 ModuleMenuBar、紧凑标题行、吸顶偏移 |
| `src/components/workbench/FundWorkbench.tsx` | 同上 |
| `src/components/panels/RealtimeQuoteBar.tsx` | 自选池超过 6 只时默认折叠，可展开 |
| `src/app/page.tsx` | 顶部条固定高度 |
| `src/app/globals.css` | 新增 `--app-header-h` |

## 5. 范围外（本次不做）

- 模块启用状态与顺序的持久化（仍是组件内 `useState`，刷新即恢复默认）——后续可单独做设置落库。
- 顶栏与侧栏的进一步合并（例如把代码查询也搬到顶部工具条）。
- 移动端专门适配（当前按桌面宽屏优化，窄屏保持纵向堆叠可用）。

## 6. 验证方式

- 静态：`corepack pnpm typecheck`、`corepack pnpm lint`。
- 单测：`corepack pnpm test`（本次为纯 UI 调整，无新增单测，需回归全量）。
- 构建：停掉 dev 后 `corepack pnpm build`，确认无 Turbopack 冲突。
- 手动：dev（3000）+ 侧车（8000）下逐项核对 `checklist.md` 的验收项。
