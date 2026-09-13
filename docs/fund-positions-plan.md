# 基金持有面板（养基宝式）方案

- 文档版本：v1.1（2026-09-13 按用户确认改为「代码 + 当前持有金额 + 当前累计收益」三字段录入）
- 编制日期：2026-09-13
- 关联文档：`docs/fund-workbench-plan.md`、`docs/fund-workbench-spec.md`、`docs/stock-portfolio-backtest-plan.md`（个股侧同款设计）、根 `checklist.md`
- 建议分支：`feature/fund-positions`
- 目标：在基金工作台新增「持有基金」模块，手动录入代码、当前持有金额与当前累计收益，用既有盘中行情接口推导当日收益，并给出持仓占比。

---

## 1. 需求

用户逐只录入自己持有的基金，页面按行展示：

| 指标 | 说明 |
| --- | --- |
| 持有基金 | 代码 + 名称 |
| 持有金额 | 手动录入的当前持有金额（市值） |
| 当日实时涨跌幅 | 盘中估算涨跌幅（场外估算 / 场内实时） |
| 当日实时收益 | 由持有金额与当日涨跌幅推导 |
| 累计收益 | 手动录入的当前累计收益（含当日） |
| 上一个交易日收盘净值 | 官方最新公布单位净值 |
| 实时估计净值 | 盘中估算净值（场内为实时价） |
| 累计收益率 | 累计收益 / 推算本金 |
| 持仓占比 | 该基金持有金额 / 全部持仓持有金额 |

另需组合合计行：总持有金额、推算总本金、总累计收益、总累计收益率、当日收益合计。

## 2. 现状与可复用能力（已核实）

| 能力 | 位置 | 复用于 |
| --- | --- | --- |
| 持仓 CRUD + 估值 + 权重 + 汇总 | `src/lib/stock-portfolio.ts`、`/api/stock-portfolio`、`StockPortfolioPanel.tsx` | 直接作为结构模板（本次做基金版，录入口径一致） |
| 盘中行情/估算净值与涨跌幅 | `src/lib/fund-intraday.ts`、`/api/funds/{code}/intraday`（`estimated_nav`/`price`/`change_pct`，60s 缓存） | 实时估计净值、当日涨跌幅 |
| 历史净值 | `src/lib/fund-data.ts: getFundNav`、`/api/funds/{code}/nav` | 上一个交易日收盘净值 |
| 基金档案/名称回填 | `src/lib/fund-market.ts: resolveFundProfile`、`normalizeFundCode` | 名称回填与代码校验 |
| 代码有效性校验 | `src/lib/data-service.ts: verifyFundCode`、`src/lib/code-verify.ts` | 录入时拦截无效代码 |
| 数据库 + JSON 双写回退 | `src/lib/db/schema.ts`、`.data/fund-watchlist.json` 同款模式 | 持仓持久化 |

## 3. 口径与公式（核心）

录入：当前持有金额 `amount`、当前累计收益 `profit`（可为负）。

- 推算本金 `cost_amount = amount − profit`
- 当日实时涨跌幅 `change_pct`：取盘中行情（场外估算 / 场内实时）。
- 当日实时收益 `day_profit = amount − amount / (1 + change_pct / 100)`
  - 与个股侧的 `estimateDayProfit` 同源同式：从市值与涨跌幅反推昨收市值。
- 上一交易日累计收益 `prev_total_profit = profit − day_profit`
- 累计收益 `total_profit = profit`（录入值）
- 累计收益率 `total_profit_pct = total_profit / cost_amount × 100`（`cost_amount ≤ 0` 时为空）
- 持仓占比 `weight_pct = amount / Σamount × 100`

**关键结论**

```
prev_total_profit + day_profit
  = (profit − day_profit) + day_profit
  = profit = total_profit
```

即「上一交易日累计收益 + 当日实时收益 = 今日累计收益」按定义成立，无需保存中间状态；单测固定该恒等式。

**与 v1.0（份额 + 成本净值）的差异**

- 不再需要份额与成本净值，录入更少且与个股持仓面板一致。
- 累计收益改为录入值，因此**不依赖行情可用性**：非交易时段、取不到盘中估值时，持有金额与累计收益照常展示，只有「当日涨跌幅 / 当日收益 / 上一交易日累计收益」显示为空。
- 实时估计净值与昨收净值改为纯展示字段（来自接口），不参与金额推导。

**降级约定**

- 涨跌幅缺失、`|change_pct| > 100` 或 `change_pct ≤ -100` 时：`day_profit` 与 `prev_total_profit` 返回 null，不用 0 冒充。
- 确定性降级数据（`source === "deterministic-fallback"`）不参与估值；回退到官方净值时不同步复用当日涨跌幅，避免把昨收当成今收。
- 单只基金取数失败只影响该行，不拖垮整组。

## 4. 数据模型与录入

按用户确认的极简风格，录入三项（+备注）：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `code` | 是 | 6 位基金代码，服务端归一化并回填名称 |
| `amount` | 是 | 当前持有金额（元），> 0 |
| `profit` | 否 | 当前累计收益（元），可为负，缺省 0 |
| `note` | 否 | 备注，≤ 120 字 |

存储实体（表 `fund_positions`，失败回退 `.data/fund-positions.json`）：`id`、`code`、`name`、`amount`、`profit`、`note`、`created_at`、`updated_at`；推算本金与收益率均为派生值，不落库。

## 5. 接口

- `GET /api/fund-positions`：读取全部持仓，逐只合成盘中行情（复用 `getFundIntraday` / `getFundNav` 缓存），返回 `{ summary, holdings, source_note }`。
- `POST /api/fund-positions`：新增（校验代码、去重、回填名称）。
- `PATCH /api/fund-positions/{id}`：修改持有金额 / 累计收益 / 备注。
- `DELETE /api/fund-positions/{id}`：删除。

## 6. 改动范围

- 新增：`src/lib/shared/types/fund-positions.ts`、`src/lib/fund-position-calc.ts`（纯函数，便于单测）、`src/lib/fund-position.ts`（仓储 + 估值编排）、`src/app/api/fund-positions/route.ts`、`src/app/api/fund-positions/[id]/route.ts`、`src/components/panels/fund/FundPositionsPanel.tsx`、`tests/fund-position-calc.test.ts`、`tests/fund-position.test.ts`、本方案文档。
- 修改：`src/lib/db/schema.ts`（新增 `fundPositions` 表）、`drizzle/`（新增迁移）、`src/lib/shared/types/index.ts`（导出）、`src/components/panels/fund/FundOptionsSidebar.tsx`（新增模块项）、`src/components/workbench/FundWorkbench.tsx`（挂载面板）、`checklist.md`。
- 不改动：既有基金模块与接口语义、其它表结构（只新增表）。

## 7. 里程碑

| 编号 | 内容 | 验收要点 |
| --- | --- | --- |
| FP1 | 口径与纯函数（含单测） | 恒等式、推算本金、占比、边界（取不到涨跌幅）可测 |
| FP2 | 存储与接口 | 新增/修改/删除/查询在数据库与 JSON 两种模式均可用 |
| FP3 | 面板 UI | 录入、列表指标、合计行、删除确认、来源与口径说明 |
| FP4 | 集成验收 | 模块注册生效，typecheck/lint/test/build 通过 |

## 8. 验收方式

- `corepack pnpm test`、`typecheck`、`lint`、`build` 全部通过。
- 端到端：录入 2–3 只场外基金与 1 只场内基金 → 各行当日涨跌幅/当日收益/累计收益/占比合理，合计行等于各行之和。
- 边界：代码不存在时返回明确错误；盘中行情不可用时行情相关字段显示占位，而持有金额与累计收益仍然正常展示。

## 9. 风险与边界

- 分红、申购赎回、份额变动会让「昨日累计 + 当日估算」的推算与真实收益产生偏差；本面板定位为学习用途的简化口径，界面固定注明。
- 场外基金盘中为估算净值（非官方），收盘后以官方净值为准；界面标注数据来源与时间。
- 当日收益依赖盘中涨跌幅，非交易时段（尤其场外基金）该列会显示为空，属于预期行为。
- 不接入券商/基金账户自动同步，全部手动录入。