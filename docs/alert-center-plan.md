# 自选池监控与预警（预警中心）开发方案

- 文档版本：v0.3
- 编制日期：2026-09-10
- 编制角色：项目负责人 / 开发 agent
- 关联文档：`docs/plan.md`（P7 待评估：实时行情推送与预警）、`docs/fund-workbench-spec.md`（第 9 节 未来扩展：基金池级每日净值刷新、风险监控与预警）、`docs/design.md`
- 修订记录：v0.1 初稿；v0.2 按用户确认结论修订（12 小时冷却、仅在有效时段触发、邮件推送、交易日每半小时扫描、预警标的数量上限、条件支持组合）；v0.3 按「盘后预警无用、必须盘中监控」的反馈改为基金盘中估算预警，并接入 AkShare 交易日历（见第 9 节）。

---

## 1. 背景与目标

当前个股工作台与基金工作台都只能"单只查询"，没有池级盯盘能力。本方案把自选股、自选基金、调度任务、可观测性、数据源健康面板与邮件通道串成闭环：

> 自选池 → 定时扫描 → 条件判定 → 预警事件 → 页面预警中心 + 邮件通知

## 2. 需求确认结论（v0.2）

| 项 | 结论 |
| --- | --- |
| 冷却期 | 同一规则 12 小时内只触发一次 |
| 触发时段 | 股票：交易日 09:30–11:30、13:00–15:00；基金：同样只盯盘中（09:30–11:30、13:00–15:00），盘后不再触发 |
| 推送通道 | 支持邮件推送，发送到用户在本机预留的收件邮箱；未配置时仅页面内展示 |
| 扫描频率 | 交易日每 30 分钟一次（系统运行时），另提供手动"立即评估" |
| 数量上限 | 最多 3 个自选标的（股票 + 基金合计）可配置预警任务，避免扫描成本过高 |
| 条件灵活度 | 单个规则支持 1 个条件，或 2–4 个条件按"全部满足（AND）/ 任一满足（OR）"组合 |
| 观测指标 | 股票：当日涨跌幅、最新价；基金：盘中估算涨跌幅、盘中估算净值、公布单位净值、公布净值单日涨跌、区间最大回撤、当前回撤 |

### 2.1 本期不做

- 不做 WebSocket 实时推送、短信、企业微信/钉钉等其它通道（邮件已满足本期诉求）。
- 不做 AI 解读预警，不做收益预测与买卖建议；文案保持教学与风险提示口径。
- 不使用确定性降级数据触发预警。
- 不改动既有 M1–M8、MF1–MF6 的已验收行为。

## 3. 可行性分析

### 3.1 数据可得性（可行）

- 股票：`getMarketQuote(code, force)` 返回 `change_pct`、`price`、`source`、`fetched_at`（`src/lib/market-data.ts:45`）。
- 基金：`getFundNav(code, range, "unit", force)` 提供单位净值与 `source`；`getFundMetrics(code, range, force)` 复用本地风险指标给出区间最大回撤与当前回撤（`src/lib/fund-metrics.ts`）。
- 自选池：`watchlistRepository.list()`、`fundWatchlistRepository.list()` 现成可用（`src/lib/watchlist.ts`、`src/lib/fund-watchlist.ts`）。

### 3.2 调度（可行，复用现有底座）

- `src/lib/scheduler.ts` 的 `safeSchedule` + `trackJob` 统一执行器与 `job_runs` 留痕可直接复用，新增任务名 `alert-scan`。
- cron 表达式新增环境变量 `ALERT_CRON`，默认 `*/30 9-15 * * 1-5`（交易日 09:00–15:59 之间每 30 分钟；实际是否执行仍由有效时段判定决定）。

### 3.3 存储（可行，需一次迁移）

- 新增两张表 `alert_rules`、`alert_events`（迁移 `0008`）；只新增，不改既有表。
- 邮件收件人等本地设置为单例配置，存 `.data/alert-settings.json`，未配置时回退环境变量。
- 未配置 `DATABASE_URL` 时规则与事件回退内存 + `.data/alerts.json`，重启不丢失（与自选股回退一致）。

### 3.4 邮件通道（可行，新增一个依赖）

- 采用 `nodemailer`（SMTP）发送纯文本 + HTML 摘要邮件；SMTP 参数（主机、端口、账号、授权码、发件人）只写入本地 `.env`，仓库仅保留 `.env.example` 占位。
- 未配置 SMTP 时：面板显示"邮件通道未配置"，事件仍正常入库，仅不发送。
- 发送失败不影响入库，失败原因写入 `job_runs` 详情与面板状态。

### 3.5 风险与应对

| 风险 | 说明 | 应对 |
| --- | --- | --- |
| 数据非实时 | 本地为快照数据，非逐笔行情 | 事件固化观测时间与数据来源；面板统一标注"基于最近一次数据快照" |
| 重复告警 | 连续扫描反复触发 | 12 小时冷却 + 事件去重（同规则同观测值不重复入库） |
| 降级数据误报 | 确定性回退不代表真实行情 | 观测值为 `deterministic-fallback` 时跳过并计数 |
| 节假日误判 | 本地无交易日历 | 本期按"工作日 + 时段"近似；后续可在 data-service 接入 AkShare 交易日历精确化（列为遗留） |
| 邮件通道配置错误 | 授权码/端口填写错误 | 提供"发送测试邮件"按钮，失败原因直接回显 |
| 扫描成本 | 每个标的都要拉行情或净值 | 上限 3 个标的；复用 TTL 缓存；30 分钟一次；记录耗时 |

## 4. 关键设计

### 4.1 共享契约（新增 `src/lib/shared/types/alerts.ts`）

```ts
export type AlertTarget = "stock" | "fund";
export type AlertMetric =
  | "change_pct"        // 当日涨跌幅（股票）
  | "price"             // 最新价（股票）
  | "unit_nav"          // 单位净值（基金）
  | "nav_change_pct"    // 净值单日涨跌（基金）
  | "drawdown_pct"      // 区间最大回撤（基金）
  | "current_drawdown_pct"; // 当前回撤（基金）
export type AlertOperator = "gte" | "lte";
export type AlertLogic = "and" | "or";

/** 单个条件：指标 + 比较方向 + 阈值。 */
export interface AlertCondition {
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
}

/** 一个预警任务对应一个自选标的，可含 1–4 个条件。 */
export interface AlertRule {
  id: string;
  target: AlertTarget;
  code: string;
  name: string;
  logic: AlertLogic;
  conditions: AlertCondition[];
  enabled: boolean;
  cooldown_hours: number;   // 默认 12
  created_at: string;
  updated_at: string;
  last_triggered_at: string | null;
}

/** 观测值：某标的某个指标在某一时刻的取值。 */
export interface AlertObservation {
  metric: AlertMetric;
  value: number;
  source: string;
  observed_at: string;
}

/** 触发事件：固化当时的口径与观测值，便于复盘核对。 */
export interface AlertEvent {
  id: string;
  rule_id: string;
  rule_label: string;
  target: AlertTarget;
  code: string;
  name: string;
  logic: AlertLogic;
  matched: "all" | "any";
  metrics: AlertMetric[];
  observed_values: Array<{ metric: AlertMetric; value: number; threshold: number; operator: AlertOperator }>;
  data_source: string;
  observed_at: string;
  level: "info" | "warn";
  message: string;
  email_status: "sent" | "skipped" | "failed";
  email_reason: string | null;
  status: "unread" | "read";
  created_at: string;
}

/** 本地预警设置（单例）。 */
export interface AlertSettings {
  email_to: string | null;         // 预留收件邮箱
  email_enabled: boolean;
  email_configured: boolean;       // 由服务端根据 SMTP 环境变量判断，只读
  max_targets: number;             // 默认 3
  updated_at: string;
}
```

### 4.2 表结构（迁移 `0008`）

- `alert_rules`：`id` 主键、`target`、`code`、`name`、`logic`、`conditions`（jsonb）、`enabled`、`cooldown_hours`、`created_at`、`updated_at`、`last_triggered_at`。
- `alert_events`：`id` 主键、`rule_id`、`target`、`code`、`name`、`logic`、`metrics`（jsonb）、`observed_values`（jsonb）、`data_source`、`observed_at`、`level`、`message`、`email_status`、`email_reason`、`status`、`created_at`；索引 `created_at desc`、`status`。

### 4.3 判定引擎（`src/lib/alerts.ts`，纯函数优先）

```ts
export function isTradingSession(target: AlertTarget, now: Date): { active: boolean; reason: string };
export function evaluateAlertRule(rule: AlertRule, observations: AlertObservation[], now: Date): AlertDecision;
```

有效时段判定（纯函数，可单测）：

- 股票类条件：工作日 09:30–11:30、13:00–15:00。
- 基金类条件：工作日 15:00–23:59（场外净值在收盘后才更新），以及交易时段内的场内实时估算。

判定优先级（`reason`）：未启用 → 指标缺失 → 数据来源为降级 → 非有效时段 → 处于 12 小时冷却 → 条件不满足 → 触发。

条件组合：`logic === "and"` 需全部满足；`logic === "or"` 任一满足即可。

### 4.4 扫描任务

`runAlertScanJob({ source, dryRun })`：

1. 读取启用的规则并按标的聚合；
2. 逐标的采集观测值（股票 → `getMarketQuote`；基金 → `getFundNav` + `getFundMetrics`）；
3. 调用判定引擎，触发则写入事件并更新 `last_triggered_at`；
4. 命中初筛的标的汇总后发送**一封**摘要邮件（避免逐条轰炸）；
5. 返回 `{ scanned_targets, triggered_count, skipped_count, email_status, duration_ms }`，由 `trackJob` 写入 `job_runs`。

### 4.5 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/alerts/rules` | 列出 / 新增规则（校验自选池、标的数量上限、条件数量与阈值） |
| PATCH/DELETE | `/api/alerts/rules/[id]` | 启停、修改、删除 |
| GET | `/api/alerts/events` | 事件列表（`status`、`target`、`code`、`limit`） |
| PATCH/DELETE | `/api/alerts/events/[id]` | 标记已读 / 删除 |
| GET/PATCH | `/api/alerts/settings` | 读取 / 更新收件邮箱与开关 |
| POST | `/api/admin/alerts/scan` | 手动评估一次并返回 JobRun |
| POST | `/api/admin/alerts/test-email` | 发送测试邮件，验证通道 |

统一使用 `apiOk/apiFail/apiUnexpected` 包装。

### 4.6 界面

- 新增 `src/components/panels/AlertPanel.tsx`：顶部"立即评估 + 最近扫描时间 + 邮件通道状态"，左侧规则编辑（标的从自选池选择、条件行可增删、AND/OR 切换、冷却期只读展示 12 小时），右侧事件流（未读高亮、标记已读、删除）。
- 挂载：`FunctionOptionsSidebar` 的 `MODULE_OPTIONS` 增加 `alerts`（"预警中心"）；两个工作台分别注册；股票侧默认展示股票规则，基金侧默认展示基金规则。
- 文案统一标注"基于最近一次数据快照，非实时；仅用于学习，不构成投资建议"。

## 5. 改动范围

新增：`src/lib/shared/types/alerts.ts`、`src/lib/alerts.ts`、`src/lib/alert-store.ts`、`src/lib/alert-email.ts`、`src/lib/alert-settings.ts`、`drizzle/0008_*.sql`、`src/app/api/alerts/**`、`src/app/api/admin/alerts/**`、`src/components/panels/AlertPanel.tsx`、`tests/alerts.test.ts`。

修改：`src/lib/shared/types/index.ts`、`src/lib/db/schema.ts`、`src/lib/store/index.ts`、`src/lib/scheduler.ts`、`src/components/panels/FunctionOptionsSidebar.tsx`、`src/components/workbench/StockWorkbench.tsx`、`src/components/workbench/FundWorkbench.tsx`、`src/lib/watchlist.ts`、`src/lib/fund-watchlist.ts`、`.env.example`、`README.md`、`checklist.md`、`package.json`（新增 nodemailer）。

约束：只新增表与类型，不改既有字段语义；SMTP 密钥只写本地 `.env`；注释与提交信息使用中文。

## 6. 任务拆解

| 编号 | 任务 | 交付物 | 依赖 |
| --- | --- | --- | --- |
| A0 | 契约与存储底座 | `types/alerts.ts`、两张表与迁移 `0008`、store 与本地回退、设置单例 | 无 |
| A1 | 判定引擎与单测 | 有效时段、条件组合、冷却、降级跳过等纯函数 + `tests/alerts.test.ts` | A0 |
| A2 | 邮件通道 | `alert-email.ts`、设置接口、测试邮件接口 | A0 |
| A3 | 扫描任务与调度 | `runAlertScanJob`、`ALERT_CRON`、`job_runs` 留痕 | A1、A2 |
| A4 | API 路由 | 规则、事件、设置与 admin 路由 | A3 |
| A5 | 预警中心面板 | `AlertPanel` + 两个工作台挂载 | A4 |
| A6 | 集成验收 | 端到端验收、文档同步、`checklist.md` T3 | A5 |

执行方式：单分支 `feature/alert-center` 串行推进（共用同一契约，拆并行会增加集成成本）。

## 7. 验收标准与测试方式

### 7.1 验收标准

- 单条件与 AND/OR 组合条件均可配置并生效；条件数 1–4，超出或为空有明确提示。
- 预警标的数量上限默认 3，超出时拒绝并提示；删除自选标的时其规则自动停用。
- 12 小时冷却生效：冷却期内重复扫描不产生新事件。
- 非有效时段不触发：股票条件在交易时段外不触发；基金净值类条件在非收盘后时段不触发。
- 降级数据不触发，且计入跳过计数。
- 邮件：配置 SMTP 后可发送测试邮件；扫描触发时汇总发送一封摘要邮件；发送失败不影响入库并记录原因。
- 手动评估与定时评估结果一致，均写入 `job_runs` 并在数据源与调度面板可见。
- 未配置数据库时规则与事件落 `.data/alerts.json`，重启不丢失；既有功能无回归。

### 7.2 测试方式

- 单测（Vitest）：有效时段判定（交易日/午休/盘后/周末）、条件组合 AND/OR、阈值边界（等于阈值）、冷却期边界（刚好 12 小时）、降级跳过、未启用、指标缺失、邮件摘要文案生成。
- 端到端：新增 510300 规则"净值单日涨跌 ≤ -1% 或区间最大回撤 ≥ 20%"→ 立即评估 → 事件出现 1 条（含观测值）→ 12 小时内再次评估不新增 → 标记已读 → 测试邮件发送成功 → 删除规则。
- 命令：`corepack pnpm test && corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`。

## 8. 待确认事项

1. 基金净值类条件在"工作日 15:00 之后"评估是否可接受？（净值收盘后才更新，若限定在股票交易时段内，基金预警几乎不会触发）
2. 邮件通道请提供 SMTP 参数（主机、端口、账号、授权码）与收件邮箱，我可写入本地 `.env` 并做一次真实发送验证；未提供时先按"未配置"占位实现。
3. 预警标的数量上限默认 3（可用 `ALERT_MAX_TARGETS` 调整）是否合适？
## 9. v0.3 修订：基金盘中估算与交易日历（2026-09-10）

### 9.1 问题

v0.2 的基金窗口是「盘中 + 工作日 15:00 后」，且盘中取的是**最新公布的官方净值**（即前一交易日收盘后公布的数据）。结果是盘中触发等于用昨天的数据报警、盘后触发又失去盯盘意义，与「盘中监控」的诉求不符。

### 9.2 可行性复核

| 口径 | 数据来源 | 结论 |
| --- | --- | --- |
| 场内基金（ETF/LOF，如 510300、161725） | 侧车 `/fund/intraday` → 腾讯行情实时价 + IOPV | ✅ 稳定可用，实测 510300 盘中 `mode=realtime`、涨跌幅 -0.26% |
| 场外基金 | 侧车 `/fund/intraday` → 东财估值排行（AkShare `fund_value_estimation_em`） | ⚠️ 覆盖有限（约 680 只估值排行基金）且上游偶发 SSL 中断；单只 `fundgz.1234567.com.cn` 接口已下线 |
| 交易日历 | AkShare `tool_trade_date_hist_sina` | ✅ 可用，实测 2026-10-01 国庆节正确排除 |

### 9.3 设计结论

- 基金预警窗口收敛为**盘中**（09:30–11:30、13:00–15:00），取消 15:00 后窗口。
- 基金新增两个盘中指标：`盘中估算涨跌幅`、`盘中估算净值`，来源为 `/fund/intraday`；公布净值与回撤仍是辅助口径。
- 观测值**按规则实际引用的指标按需采集**：只配置涨幅条件时不再拉取整段净值历史，降低扫描成本。
- 观测值来源为 `deterministic-fallback` 时一律跳过（计入跳过原因），绝不用降级数据报假警；判定引擎只校验条件实际引用的指标。
- 交易日历由侧车 `/trading-calendar` 提供，Web 端缓存 12 小时；不可用时回退「工作日」近似并在面板标注来源。
- 面板展示「今日是否交易日 + 日历来源」，评估结果附带本次使用的日历来源。

### 9.4 遗留

- 场外基金盘中估算覆盖有限，取不到估值时该规则本轮跳过（面板会给出「缺少指标观测值」原因）；后续可评估接入更多估值源。
- 节假日按 AkShare 日历判定；日历仅覆盖已发布年份，超出范围自动回退工作日规则。
