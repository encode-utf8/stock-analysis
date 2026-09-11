# 个股投资组合与策略回测学习台 规划

- 文档版本：v0.1
- 编制日期：2026-09-11
- 关联文档：`docs/plan.md`、`docs/design.md`、`docs/fund-workbench-plan.md`（基金侧对标实现）
- 建议分支：`feature/stock-portfolio-backtest`
- 目标模块：个股工作台新增「我的持仓组合」「策略回测」两个模块
- 状态：已完成（2026-09-11）；验收记录见根 `checklist.md`「个股投资组合与策略回测学习台验收」
- 需求确认：持仓仅手动录入代码/投入金额/当前持仓收益；回测包含组合权重再平衡；实时推送特性串行在其后开发

> 实现说明：持仓录入口径按用户确认调整为「投入金额 + 当前持仓收益」，市值与收益率由二者推导，
> 因此不再使用本文件第 3.1 节最初设想的「份额 + 成本价」字段；其余设计（估值、汇总、权重、行业分布）不变。
> 回测接口最终落在 `POST /api/stock-backtest`（单标的与组合共用一个入口，由 body 区分策略），
> 而非第 4.2 节最初设想的 `POST /api/stocks/[code]/backtest`。

---

## 1. 背景与目标

基金工作台已完成组合分析（F10）、定投回测（F12）、风格因子（F13），而个股工作台仍停留在「单只股票看行情 + 看分析」的形态：无法记录自己的持仓，也无法验证一个交易想法。

本阶段目标：补齐个股侧的组合与回测能力，形成与基金侧对称的学习闭环。

- 我的持仓组合：手动录入持仓，实时估值，展示组合盈亏、权重与行业分布。
- 策略回测：用本地 K 线回测均线/MACD/RSI/BOLL 规则，输出净值、回撤、胜率等指标，并给出免责声明。

明确不做（边界）：

- 不接券商、不做真实交易、不做下单。
- 不做收益预测与「推荐买卖点」，只做历史数据上的规则验证。
- 不做筹码分布、不做融资融券与期权。

## 2. 可行性分析

### 2.1 可复用的既有能力

| 能力 | 现成实现 | 复用方式 |
| --- | --- | --- |
| 日/周/月 K 线（前复权） | `src/lib/market-data.ts:getKlines` | 直接调用，回测数据源 |
| 技术指标 | `src/lib/indicators.ts:calculateIndicators` | 复用 MA/MACD/KDJ/RSI/BOLL 计算 |
| 组合口径计算 | `src/lib/fund-portfolio.ts` | 参照权重、再平衡偏离、风险贡献的写法 |
| 回测口径计算 | `src/lib/fund-dca.ts`、`src/lib/fund-metrics.ts` | 参照年化、最大回撤、夏普/索提诺/卡玛 |
| 持久化 + 本地回退 | `src/lib/store/watchlist.ts`、`src/lib/alert-store.ts` | 新增仓储照抄「PostgreSQL + `.data/*.json` 回退」模式 |
| 手绘 SVG 图表 | `src/components/panels/fund/FundLineChart.tsx` | 复用多序列曲线组件思路（项目未引入图表库） |
| 代码校验 | `src/lib/code-verify.ts` | 录入持仓前校验代码存在性 |

### 2.2 结论

- 可行性高：全部为本地确定性计算，无新增外部依赖、无新增密钥。
- 唯一硬约束：侧车 `/kline` 的 `limit` 上限为 240（`data-service/app/main.py:922`），日线仅约一年，MA60 等长周期策略样本不足。

### 2.3 关键约束的解决方案

- 把侧车 `/kline` 的 `limit` 上限从 240 放宽到 1500（`ge=10, le=1500`），并保留入参校验；返回结构不变，属于向后兼容改动。
- 回测默认区间 2 年、默认前复权（qfq），避免除权跳空造成的假信号；页面固定标注复权口径与数据来源。
- 上游取不到足够 K 线时，明确提示「样本不足，结果不可用」，而不是用确定性回退数据跑出看似可信的回测结论。
- 确定性回退数据（`source=deterministic-fallback`）不参与回测，直接拒绝并提示。

## 3. 功能范围

### 3.1 我的持仓组合

- 持仓录入：代码、名称、份额（股）、成本价、备注；支持增/删/改。
- 实时估值：市值 = 份额 × 最新价；浮动盈亏 = 市值 − 成本额；盈亏率；当日盈亏（用快照涨跌额）。
- 组合汇总：总市值、总成本、总盈亏与盈亏率、当日盈亏、持仓数量。
- 结构分析：持仓权重排序、权重条形展示、行业分布聚合。
- 数据来源与新鲜度：固定展示行情来源、更新时间，未取到时标注降级。
- 代码校验：新增前走 `verifyStockCode`，查不到时弹「无数据」提示；上游不可用时放行（与自选池策略一致）。

### 3.2 策略回测

- 标的与区间：单个股票代码、日线/周线、起始与结束日期（或最近 N 根）。
- 策略：
  - 双均线（MA 快线/慢线，金叉买入、死叉卖出）
  - MACD（DIF 上穿 DEA 买入、下穿卖出）
  - RSI（下穿超卖线买入、上穿超买线卖出）
  - BOLL（收盘上穿下轨买入、上穿中轨或触及上轨卖出）
- 参数：策略参数、初始资金、手续费率、印花税率（卖出）、滑点。
- 输出：净值曲线、总收益、年化收益、最大回撤与修复耗时、夏普、交易次数、胜率、平均持有天数、基准（同期买入持有）对比、逐笔交易明细。
- 明确标注：仅用于学习，历史表现不代表未来。

## 4. 关键设计

### 4.1 数据模型

新增共享类型 `src/lib/shared/types/stock-portfolio.ts`（本分支内新增，不改既有字段）：

- `StockHolding`：id、code、name、shares、cost_price、note、created_at、updated_at。
- `StockHoldingInput`：录入/更新入参。
- `StockHoldingValuation`：holding 字段 + price、change_pct、market_value、cost_value、profit、profit_pct、day_profit、source、fetched_at。
- `StockPortfolioSummary`：total_market_value、total_cost、total_profit、total_profit_pct、day_profit、holdings_count、weights、industry_allocation、generated_at。
- `BacktestStrategyId`：`ma-cross` | `macd-cross` | `rsi-reversal` | `boll-breakout`。
- `BacktestRequest`：code、period、strategy、params、start、end、initial_capital、fee_rate、stamp_duty_rate、slippage_rate。
- `BacktestTrade`、`BacktestMetrics`、`BacktestResult`。

数据库新增表 `stock_portfolio`（`src/lib/db/schema.ts` 追加，不动既有表）：

- `id` 主键、`code`、`name`、`shares` numeric、`cost_price` numeric、`note`、`created_at`、`updated_at`，`code` 建唯一索引。

本地回退：`.data/stock-portfolio.json`，与 `.data/watchlist.json` 同级。

### 4.2 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/stock-portfolio` | 持仓列表 + 估值 + 组合汇总 |
| POST | `/api/stock-portfolio` | 新增持仓（含代码校验、名称回填） |
| PATCH | `/api/stock-portfolio/[id]` | 修改份额/成本价/备注 |
| DELETE | `/api/stock-portfolio/[id]` | 删除持仓 |
| POST | `/api/stocks/[code]/backtest` | 执行回测，返回 `BacktestResult` |

侧车：`/kline` 的 `limit` 上限放宽到 1500。

### 4.3 计算模块

- `src/lib/stock-portfolio.ts`：估值与汇总纯函数（`valueHoldings`、`summarizePortfolio`），可单测。
- `src/lib/stock-backtest.ts`：信号生成 + 撮合 + 指标计算纯函数，可单测；不依赖网络，输入 K 线数组。
- `src/lib/stock-portfolio-store.ts`：仓储（PostgreSQL + JSON 回退）。

### 4.4 UI

- 新增 `src/components/panels/stock/StockPortfolioPanel.tsx`。
- 新增 `src/components/panels/stock/StockBacktestPanel.tsx`。
- 新增 `src/components/panels/stock/BacktestEquityChart.tsx`（参照 `FundLineChart` 的手绘 SVG）。
- 模块注册：`src/components/panels/FunctionOptionsSidebar.tsx` 的 `MODULE_OPTIONS` 追加 `portfolio`（我的持仓组合）、`backtest`（策略回测）；`src/components/workbench/StockWorkbench.tsx` 的 `renderStockModule` 追加两个分支。

## 5. 里程碑

| 编号 | 内容 | 验收要点 |
| --- | --- | --- |
| A1 | 数据底座：共享类型、表、本地回退、仓储、单测 | 增删改查在内存/数据库/JSON 三种模式下均通过 |
| A2 | 组合接口与估值 | 组合汇总口径正确，代码校验与名称回填生效 |
| A3 | 组合面板 UI | 录入、修改、删除、权重与行业分布展示正常 |
| A4 | 回测引擎（纯函数 + 单测） | 四类策略信号、费用、滑点、指标可测且边界清晰 |
| A5 | 回测接口与侧车 limit 放宽 | 2 年日线可回测，样本不足与降级数据被拒绝 |
| A6 | 回测面板 UI | 参数可调、结果可读、免责声明与复权口径标注 |
| A7 | 集成与整体验收 | 既有模块无回归，typecheck/lint/test/build 通过 |

## 6. 验收方式

- `corepack pnpm test`（新增组合与回测单测）、`typecheck`、`lint`、`build` 全部通过。
- 侧车：`curl "http://127.0.0.1:8000/kline?code=600519&period=day&adjust=qfq&limit=1000"` 返回 1000 根（或上游可用上限）。
- 端到端：录入 2–3 只持仓 → 组合汇总与权重正确 → 修改份额后市值同步 → 删除后汇总同步。
- 端到端：对 600519 跑双均线回测，检查净值曲线、交易明细与基准对比合理；对无数据代码返回明确错误。

## 7. 风险与缓解

- 回测被误读为投资建议：固定免责声明 + 文案禁止「推荐/必涨」表述。
- 长周期样本不足：放宽 limit 上限并在样本不足时直接拒绝。
- 复权口径误导：统一前复权并显式标注。
- 与实时推送特性并发改同一批文件（`StockWorkbench.tsx`、`FunctionOptionsSidebar.tsx`）：两特性串行开发，先合入本特性再做实时推送。

## 8. 依赖与配置

- 无新增环境变量、无新增密钥。
- 可选：`DATABASE_URL` 已配置则落库，否则自动使用 `.data/stock-portfolio.json`。
