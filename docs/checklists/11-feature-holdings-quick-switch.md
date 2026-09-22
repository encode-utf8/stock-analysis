# 11 持仓标的点击切换验收清单

- 分支：`feature/datasource-failure-ux`（沿用当前工作分支）
- 关联方案：`docs/holdings-quick-switch-plan.md`
- 目标：支持从「我的持仓组合」与「我的持有基金」直接点击标的名称切换当前查询，并给出明确的当前项反馈。
- 状态：已完成（2026-09-22），等待用户确认后提交。

## 验收项

### 组件与交互

- [x] 新增 `src/components/panels/TargetSwitchCell.tsx`：可点击 / 静态两种形态共用同一骨架
- [x] 传入 `onSelectTarget` 时渲染为按钮，带 `aria-label` 与 `title`（切换到 XXX（代码））
- [x] 未传入回调时退化为静态文本，渲染结果与改动前一致
- [x] 命中当前查询标的时显示「当前」徽标与主色描边

### 面板接线

- [x] `StockPortfolioPanel` 新增 `activeCode` / `onSelectTarget` 可选 props，持仓名称可点击
- [x] `FundPositionsPanel` 新增 `activeCode` / `onSelectTarget` 可选 props，持有基金名称可点击
- [x] `StockWorkbench` 传入 `activeCode={code}` 与 `onSelectTarget={handleWatchlistSelect}`
- [x] `FundWorkbench` 传入 `activeCode={code}` 与 `onSelectTarget={handleWatchlistSelect}`
- [x] 两个面板在提供回调时给出「点击标的名称可直接切换当前查询。当前：XXX。」提示

### 测试

- [x] 单测：`tests/target-switch-cell.test.ts` 覆盖可点击形态、静态形态与「当前」标记
- [x] 单测：`tests/fund-positions-panel.test.ts` 覆盖切换提示文案
- [x] 端到端：`tests/e2e/holdings-quick-switch.spec.ts` 验证个股点击切换后侧栏代码同步
- [x] 端到端：验证基金点击切换后侧栏基金代码同步
- [x] 回归：`typecheck` / `lint` / `test` / `build` / `test:e2e` 全绿

### 文档

- [x] 方案文档 `docs/holdings-quick-switch-plan.md`
- [x] 根 `checklist.md` 追加本次验收小节

## 验证方式

```powershell
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
corepack pnpm test:e2e
```

## 通过标准

- 点击持仓 / 持有标的名称后，工作台当前查询标的（侧栏代码输入框与各数据模块）同步为新标的；
- 当前查询标的在列表中有可见标记，用户能确认切换生效；
- 未使用该能力的调用点渲染结果不变；
- 全部校验命令通过，无新增 lint 告警。

## 风险与遗留

- 端到端侧车替身需为样本标的提供名称，已在 `tests/e2e/mock-sidecar.mjs` 补充；
- 若仅启用持仓模块，切换后的可见反馈为「当前」徽标与提示行，与自选点击一致。
