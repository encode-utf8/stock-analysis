# 持仓标的点击切换方案（从「我的持仓组合」「我的持有基金」直接切换当前查询）

## 需求来源

用户反馈：当前查询的基金 / 股票，应当支持直接从用户持有的基金 / 股票点击切换，更符合日常使用习惯。

## 现状与问题

- 自选池（个股 `WatchlistSidebar`、基金 `FundWatchlistPanel`）已支持点击切换当前标的，并高亮当前项；
- 但代表真实持仓的两个面板——个股 `StockPortfolioPanel`（我的持仓组合）与基金 `FundPositionsPanel`（我的持有基金）——标的名称只是纯文本，要切换只能回到侧栏重新输入代码或先加入自选，多了一步；
- 持仓与关注对象高度重合，持仓列表本身就是最自然的切换入口。

## 目标

1. 持仓 / 持有列表中的标的名称可点击，点击即切换当前查询标的；
2. 切换复用工作台既有主查询链路（与自选点击完全一致：盘面、K 线、资讯、AI 分析、对话、复盘等模块同步刷新）；
3. 面板内给出明确的「当前查询」反馈：命中行加「当前」徽标与主色淡底，面板标题下补充「点击标的名称可直接切换当前查询。当前：XXX。」提示；
4. 未传入切换回调时保持静态文本，不影响其它复用场景与既有渲染。

## 方案设计

### 交互

- 仅当传入 `onSelectTarget` 时，标的单元格渲染为按钮；否则保持纯文本；
- 点击行为：`setInput(code)` + 主查询链路刷新（个股 `refreshStock`、基金 `loadFund`），与自选点击共用同一回调，保证切换语义只有一份实现；
- 视觉：悬停高亮底纹 + 名称转主色；命中当前查询标的时显示「当前」徽标 + 主色描边；
- 无障碍：按钮带 `aria-label` / `title`（如「切换到 贵州茅台（600519）」），可键盘聚焦，沿用项目 `focus-visible` 样式。

### 组件

新增共享组件 `src/components/panels/TargetSwitchCell.tsx`，封装「可点击标的单元格」骨架（名称行 + 可选徽标 + 代码行 + 可选补充说明），个股与基金面板共用，避免重复实现。

### 接线

| 面板 | 工作台 | 传入 props |
| --- | --- | --- |
| `StockPortfolioPanel` | `StockWorkbench` | `activeCode={code}`、`onSelectTarget={handleWatchlistSelect}` |
| `FundPositionsPanel` | `FundWorkbench` | `activeCode={code}`、`onSelectTarget={handleWatchlistSelect}` |

`handleWatchlistSelect` 本就是「切换当前标的」的既有入口，复用后个股与基金的切换行为、数据刷新范围与自选一致。

## 改动范围

- 新增：`src/components/panels/TargetSwitchCell.tsx`；
- 修改：`src/components/panels/stock/StockPortfolioPanel.tsx`、`src/components/panels/fund/FundPositionsPanel.tsx`、`src/components/workbench/StockWorkbench.tsx`、`src/components/workbench/FundWorkbench.tsx`；
- 测试：新增 `tests/target-switch-cell.test.ts`（服务端渲染冒烟）与 `tests/e2e/holdings-quick-switch.spec.ts`（点击切换端到端）；扩展 `tests/fund-positions-panel.test.ts` 与 `tests/e2e/mock-sidecar.mjs`（补一个样本标的名称）；
- 文档：本方案、`docs/checklists/11-feature-holdings-quick-switch.md`、根 `checklist.md` 同步。

## 非目标

- 不做「持仓 → 自选」联动，不改持仓与自选的数据结构；
- 不改 K 线、资讯、对话等模块的取数策略与降级逻辑；
- 不扩展到回测、日报、预警等其它含标的列表的面板（本次仅覆盖用户明确提到的持仓 / 持有入口）。

## 测试与验收

- 单测（SSR 冒烟）：可点击形态渲染出按钮并带无障碍文案与「当前」标记；未传回调时为静态文本；面板渲染出切换提示；
- 端到端：个股「我的持仓组合」点击持仓名称后，侧栏「股票代码」输入框同步为新代码；基金「我的持有基金」点击后「基金代码」同步为新代码；
- 回归：`typecheck` / `lint` / `test` / `build` / `test:e2e` 全绿。

## 风险与遗留

- 持仓按代码唯一（重复录入会被叠加或拒绝），因此按代码高亮是确定性的，不存在同代码多行；
- 持仓为空或数据源故障（面板提示故障）时没有可点击标的，行为与现状一致，不新增失败路径；
- 若用户只启用了持仓模块、未启用盘面模块，切换后可见反馈为「当前」徽标与提示行，与自选点击的既有反馈口径一致。
