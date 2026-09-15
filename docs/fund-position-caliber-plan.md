# 基金持有面板：累计收益口径显式化方案

- 文档版本：v1.2（2026-09-15，新增 §2.2 跨日推进与展示口径；展示口径由锚点推断，录入口径仅用于回显与录入解释）
- 关联文档：`docs/fund-positions-plan.md`（v1.2 口径为「累计收益含当日」，本文档替换其 §3 的口径定义）、根 `checklist.md`
- 分支：`feature/fund-position-caliber`
- 背景：v1.1 只录入「当前持有金额 + 当前累计收益」，代码默认把录入值当作**含当日实时收益**，于是必然推导出 `上一交易日累计收益 = 录入值 − 当日收益`。但用户实际抄录的数值来源不同：
  - 交易时段看基金 App 的「持有收益」，该值已含当日估算收益；
  - 盘前或抄录「昨日结算收益」，该值不含当日收益。
  同一个输入框、两种语义，导致同一份持仓在两种场景下得到相反的结果，语义模糊。

## 1. 目标

- 把「录入的累计收益是否含当日收益」变成显式字段，由用户选择，不再由代码单方面假设。
- 引入**配对原则**：录入的持有金额与累计收益是同一口径的一对，不允许「收益不含当日、金额却含当日」的混合语义。
- 两种口径下推导结果都要满足恒等式，并且**不猜测**：当日收益不可得时，受影响的派生字段留空（显示占位），不用 0 冒充。
- 既有数据与既有录入习惯不受影响：缺省口径为「含当日收益」，与旧行为完全一致。

## 2. 口径定义（配对模型）

新增字段 `profit_caliber`：

| 取值 | 界面文案 | 含义 |
| --- | --- | --- |
| `include_today`（默认） | 含当日收益 | 录入值 = 当前市值 + 当前累计收益（均已含当日实时盈亏） |
| `exclude_today` | 不含当日收益 | 录入值 = 上一交易日收盘市值 + 上一交易日累计收益 |

记录入的持有金额为 `input_amount`、录入的累计收益为 `input_profit`，当日涨跌幅为 `changePct`，`rate = changePct / 100`。

```
推算本金   cost_amount       = input_amount − input_profit          （两种口径等价）
含当日     当前市值          = input_amount
含当日     上一交易日市值     = input_amount / (1 + rate)
不含当日   上一交易日市值     = input_amount
不含当日   当前市值          = input_amount × (1 + rate)
当日收益   day_profit        = 当前市值 − 上一交易日市值
累计收益   total_profit      = 市值 − 推算本金
累计收益率 total_profit_pct  = total_profit / cost_amount × 100     （本金 ≤ 0 时为空）
```

两种口径共用同一条恒等式（按定义成立）：

```
prev_total_profit + day_profit = total_profit
```

**配对原则说明**：`cost_amount = input_amount − input_profit` 对两种口径都成立，因为「市值 − 累计收益 = 本金」是恒等关系——含当日时是「当前市值 − 当前累计收益」，不含当日时是「上一交易日市值 − 上一交易日累计收益」，两者相等。因此本金推算**不依赖行情**，任何情况下都能算。

### 2.1 配对原则带来的行为变化（相对 v1.0 草案）

v1.0 草案把「不含当日」理解为「只改收益口径、金额仍是当前市值」，于是写出 `当前市值 = 录入金额`、`累计收益 = 录入值 + 当日收益`、`本金 = 录入金额 − 当前累计收益`。这违背了配对原则，会导致本金被当日盈亏污染。v1.1 起：

- 不含当日口径下，录入金额是**上一交易日收盘市值**，当前市值由涨跌幅折算得出；
- 本金一律 `input_amount − input_profit`，与口径、与行情都无关。

### 2.2 跨日推进与展示口径（v1.2 补充）

录入值是**某一天收盘口径**的一组快照，用 `manual_anchor{ nav_date, nav, source }` 记录它的层级（机制见 `docs/fund-nav-settlement-plan.md` R6）。此后每个交易日：

- 系统按官方净值把记录值推进到最新收盘口径（金额与累计收益同步平移，本金不变），因此「上一交易日累计收益」不会再停在录入当天的数值；
- 展示时若记录值锚在**今天之前**的收盘口径上，改用 `exclude_today` 公式（当前市值 = 记录值 ×（1 + 当日涨跌幅）、上一交易日市值 = 记录值）；只有锚在今天的当前值上（当天录入、尚未跨日）才按 `include_today` 展示；
- `profit_caliber` 保留为**录入口径**（修改表单回显、合并校验用），展示口径由接口新增字段 `display_caliber` 表达，两者可以不同；
- 「不含当日」录入锚在录入日之前最近一个交易日的收盘口径；「含当日」录入锚在录入当天的当前值（盘中为估算锚定，官方净值公布后按官方口径重锚）。

## 3. 当日收益不可用时的降级（不猜测）

当日收益不可用（取不到盘中行情、`|changePct| > 100`、`changePct ≤ −100`）时：

| 派生值 | 含当日 | 不含当日 |
| --- | --- | --- |
| 当前市值 `market_value` | `input_amount`（可用） | `null`（无法折算） |
| 上一交易日市值 `prev_market_value` | `null` | `input_amount`（可用） |
| `total_profit` | `input_profit`（可用） | `null` |
| `prev_total_profit` | `null` | `input_profit`（可用） |
| `day_profit` | `null` | `null` |
| `cost_amount` | 恒可用 | 恒可用（只依赖录入值） |
| `total_profit_pct` | 可用 | `null`（依赖 `total_profit`） |
| 持仓占比 `weight_pct` | 可用 | 整列为 `null` |

即：**缺哪一段就空哪一段，不做 0 假设**。含当日口径（默认）的可用性与旧行为完全一致。

v1.2 补充：展示口径由锚点推断而来（`display_caliber`），取不到当日涨跌幅时回落到录入口径。因此含当日录入的历史数据在行情缺失时仍按上表「含当日」列展示（当前市值 = 记录值），不会因为折算不出当日收益而整列变空。

## 4. 组合合计口径

- `total_cost`：只依赖录入值，**恒可合计**。
- `total_market_value`：任一只当前市值不可用则整体为 `null`（金额合计少算会误导，故不给部分合计）。
- `total_profit` / `total_profit_pct`：任一只不可用则整体为 `null`。
- 持仓占比 `weight_pct`：任一只当前市值不可用时**整列**为 `null`，避免用部分合计算出失真占比。
- `total_day_profit`：维持既有约定（按可计算部分求和，全部不可用为 `null`），本次不改。
- 空组合仍按 0 汇总（收益率除外，为 `null`）。

## 5. 数据模型与接口

- 表 `fund_positions` 新增列 `profit_caliber text NOT NULL DEFAULT 'include_today'`；JSON 回退文件同名字段。
- 历史数据兼容：读取时缺该字段一律按 `include_today` 归一。
- `POST /api/fund-positions`：接受可选 `profit_caliber`，缺省 `include_today`，非法值返回 400。
- `PATCH /api/fund-positions/{id}`：允许修改 `profit_caliber`（切换口径）。
- 估值结果新增 `profit_caliber`、`prev_market_value`；`market_value`、`total_profit`、`weight_pct` 改为可空；`cost_amount` 恒为数字。

## 6. 界面

- 录入表单与行内编辑提供「累计收益口径」下拉（默认含当日收益），并在字段旁写明两种含义。
- **列表不展示口径标注**（按用户要求：已录入的基金名字下方不加任何口径徽标），需要区分时进入「修改」切换口径。
- 收益类数字（当日收益、累计收益、昨日累计、累计收益率、当日收益合计、累计收益卡片与合计行）为正时前缀「+」，配色仍为涨红跌绿。
- 不含当日且行情不可用时，「当前市值 / 当前累计收益 / 占比」显示占位并给出原因提示。

## 7. 改动范围

| 文件 | 改动 |
| --- | --- |
| `src/lib/shared/types/fund-positions.ts` | 新增 `FundProfitCaliber`、`prev_market_value`、可空调整与口径注释 |
| `src/lib/fund-position-calc.ts` | `computeFundPositionMath` 配对口径换算、`computeWeights` 整列 null、`sumValuations` 合计口径 |
| `src/lib/fund-position.ts` | 校验、构建、行映射、JSON 兼容、估值编排 |
| `src/lib/db/schema.ts` + `drizzle/` | 新增列与迁移 |
| `src/app/api/fund-positions/route.ts`、`[id]/route.ts` | 透传与校验口径 |
| `src/components/panels/fund/FundPositionsPanel.tsx` | 口径选择、符号化收益、null 占位、说明文案 |
| `tests/fund-position-calc.test.ts`、`tests/fund-position.test.ts` | 两种口径换算、逆运算、降级分支、合计传播 |

## 8. 验收方式

- `corepack pnpm test`：覆盖两种口径换算、恒等式与逆运算、行情不可用降级、合计 null 传播、占比整列 null。
- `corepack pnpm typecheck` / `lint` / `build` 全部通过。
- 端到端（dev 3000 + 侧车 8000）：
  1. 含当日录入 `510300` 8000 / −300，记录 `prev_market_value` 与 `prev_total_profit`；
  2. 用这两个值作为「不含当日」口径录入同一只基金，两次结果应完全一致（配对逆运算）。
- 边界：非法口径值返回 400；历史 JSON 记录无口径字段时按含当日处理。

## 9. 风险与边界

- 默认口径取「含当日收益」，是为了与既有数据、既有录入习惯保持一致；若用户实际抄录的是昨日结算值，需在录入时显式切换。
- 不含当日口径下，行情不可用会导致「当前市值 / 当前累计收益 / 累计收益率 / 占比」同时留空，属预期的「不猜测」行为，界面会给出原因提示。
- 分红、申购赎回带来的份额变动仍不在本口径处理范围内（与 v1.1 一致）。
