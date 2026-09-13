# 日报能力收尾方案（对比 / 批量回补 / 删除 / 推送）

- 文档版本：v1.0
- 编制日期：2026-09-13
- 关联文档：`docs/daily-report-plan.md`（第 8 节遗留）、`docs/daily-report-history-backfill-plan.md`、`docs/alert-center-plan.md`
- 建议分支：`feature/daily-report-roundup`
- 目标：完成 A 组「日报能力收尾」四项 —— A1 与前一交易日对比、A2 历史日报批量回补与删除、A3 日报摘要邮件推送、A4 历史日报重生成。

---

## 1. 现状与缺口（已核实）

| 项 | 现状 | 缺口 |
| --- | --- | --- |
| A1 对比 | 日报只有单日快照，`DailyReportData` 无历史对比字段 | 没有「较前一交易日」的指数、成交额与板块轮动信息 |
| A2 回补/删除 | `POST /api/admin/daily-reports` 只能按单个日期生成；无 DELETE 接口 | 历史列表无法批量补齐，也无法删除写错的日报 |
| A3 推送 | 预警中心已有 SMTP 邮件通道（`src/lib/alert-email.ts`），日报只落 R2/本地 | 日报生成后没有通知，必须打开页面才知道 |
| A4 历史日报 | 9-10 及更早日期的日报仍是旧提示词产物 | 口径与新版不一致 |

---

## 2. 可行性分析

### 2.1 A1 数据来源（实测）

- **指数环比**：侧车 `/index/kline` 已返回 60 个交易日的日线（含 `amount`），当日与前一日收盘价、成交额可**零额外请求**推导；当日（`/index/quote`）路径补一次 3 个指数的日线请求（约 1 秒）即可。
- **板块环比**：同花顺板块指数日线本身包含目标日与前一日两根 K 线，「目标日涨跌幅」「前一日涨跌幅」「前一日上涨/下跌板块数」都能从**同一次** `/market/sectors?date=` 请求得出（缓存按日期复用）。
- **涨跌家数环比**：乐咕只有最新交易日快照，历史上更早的日期的个股家数无公开接口 —— **不做环比**，在提示词与模板中明确不比较，避免误导。

### 2.2 A2 存储能力

- `src/lib/r2.ts` 已具备 `deleteObject` / `listJsonObjects`；本地兜底为 `.data/daily-reports/{kind}/`。
- `daily-report-store.ts` 已有索引读写与合并（`mergeIndex`），删除需要「删除对象 + 重写两侧索引」。

### 2.3 A3 邮件通道

- `alert-email.ts` 已封装 SMTP 读写与 nodemailer 发送，`isEmailConfigured()` 可复用；新增日报摘要只需抽出通用发信函数 + 一个邮件模板。
- 收件人优先取 `DAILY_REPORT_EMAIL_TO`，未配置时回退预警中心的 `ALERT_EMAIL_TO`；两者都没有则跳过并记录原因，不影响日报生成。

### 2.4 风险

- 板块环比在「当日」路径需要额外一次同花顺请求（约 13 秒，按日期缓存），日报为每日一次生成，可接受；上游失败时对比字段为 null，不影响正文其他部分。
- 对比口径不同（个股家数 vs 板块家数）已在文档与提示词中区分，不混用。

---

## 3. 关键设计

### 3.1 数据契约（`src/lib/shared/types/daily-report.ts`）

```text
DailyReportIndexComparison = { code, name, price, change_pct, prev_change_pct,
                               amount, prev_amount, amount_change_pct }
DailyReportSectorComparison = { prev_date, prev_rise_count, prev_fall_count,
                                newcomers: string[], dropped: string[] }
DailyReportComparison = { prev_date, indices: DailyReportIndexComparison[],
                          sectors: DailyReportSectorComparison | null }
DailyReportData.comparison: DailyReportComparison | null
DailyReportJobResult.email_status / email_reason   // 推送结果，供面板与 job_runs
MarketSectorItem.prev_change_pct?: number | null   // 侧车历史口径返回前一日涨跌幅
```

### 3.2 侧车（`data-service/app/main.py`）

- `_sector_history_rows()` 每行新增 `prev_change_pct`（前一日收盘 / 前前一日收盘），用于板块轮动与前一日板块涨跌分布。
- `/market/sectors` 新增可选 `history=1`：强制走同花顺历史口径（当日生成日报时也能拿到前一日对比），仍按日期缓存。

### 3.3 Web

- `collectIndices` 返回 `{ indices, comparison, missing }`；历史路径复用同一份日线，当日路径补一次日线请求。
- `collectSectors` 返回 `{ sectors, comparison, missing }`；对比来自同花顺口径，若上游未返回前一日数据则 `comparison.sectors = null`。
- 模板：指数区块补「较前一交易日」与「成交额环比」两行；板块区块补「板块轮动」与「前一交易日涨跌分布」两行。
- 提示词：要求引用对比数据并说明口径；没有对比数据时不得声称「数据不可用」。
- 新增删除：`DELETE /api/admin/daily-reports/[kind]/[date]`；批量回补：`POST /api/admin/daily-reports/backfill { kind, days, force? }`，按交易日历取最近 N 个交易日。
- 面板：新增「回补最近 N 个交易日」「删除该日日报」入口，并更新已过时的历史口径提示文案。

### 3.4 推送

- 新增 `src/lib/daily-report-email.ts`：`buildDailyReportDigest()`（纯函数）+ `sendDailyReportDigest()`（复用 SMTP，未配置/无收件人/发送失败都不影响日报落库）。
- `runDailyReportJob` 保存成功后调用，结果写入 `DailyReportJobResult.email_status / email_reason`。
- `.env.example` 增加 `DAILY_REPORT_EMAIL_TO`。

---

## 4. 改动范围

- 修改：`data-service/app/main.py`、`src/lib/daily-report.ts`、`src/lib/shared/types/daily-report.ts`、`src/lib/data-service.ts`、`src/lib/daily-report-store.ts`、`src/lib/alert-email.ts`、`src/lib/scheduler.ts`、`src/components/panels/DailyReportPanel.tsx`、`.env.example`、`README.md`、`checklist.md`
- 新增：`src/lib/daily-report-email.ts`、`src/app/api/admin/daily-reports/[kind]/[date]/route.ts`、`src/app/api/admin/daily-reports/backfill/route.ts`、`tests/daily-report-roundup.test.ts`
- 不改动：数据库表结构、日报 R2 对象键、调度表达式

---

## 5. 验收标准（2026-09-13 全部通过）

- [x] 日报正文明示「较前一交易日」的指数涨跌幅与成交额环比，且数字与 K 线一致
- [x] 历史（同花顺口径）日报给出板块轮动与前一交易日板块涨跌分布；当日口径取不到时 `null` 且正文不写「不可用」
- [x] 涨跌家数不做环比，正文不得出现跨口径的涨跌家数比较
- [x] `DELETE /api/admin/daily-reports/{kind}/{date}` 能删除 R2 与本地对象并同步两侧索引
- [x] `POST /api/admin/daily-reports/backfill` 能按最近 N 个交易日补齐缺失日报并返回逐日结果
- [x] 日报生成后按配置发送摘要邮件；未配置 SMTP/收件人时跳过且不影响落库
- [x] 面板可用上述能力，历史口径提示文案与新行为一致
- [x] A4：9-09、9-10、9-11 的股市/基金日报用新口径重新生成，正文无「不可用」
- [x] `corepack pnpm test`、`typecheck`、`lint`、`build` 全部通过

## 6. 风险与遗留

- 当日路径的板块环比需要一次同花顺历史请求（约 13 秒），上游失败时对比字段为 null。
- 涨跌家数无历史接口，跨日对比只能缺省；如后续引入付费源再评估。
- 邮件推送是单向通知，不做重试队列；失败原因记录在 job_runs 与面板提示中。

## 7. 实现补充（2026-09-13 落地时发现）

- 原文只写了「板块行新增 `prev_change_pct`」，但对比块不会自动生成：已补 `_sector_history_comparison()`，由 90 个板块的前一日涨跌幅算出 `prev_rise_count` / `prev_fall_count` 与涨幅榜前五的新进/掉出，并在 `/market/sectors` 响应里返回 `comparison`（非历史口径为 `null`）。
- 每行同时返回 `prev_date`（前一日 K 线日期），用于在正文与指标里标注对比基准日。
- 实测发现：历史回补时「指数日线」与「90 个板块指数回补」并发会撞上游，5 秒超时导致指数缺失（stock/2026-09-09 首版只剩 1 个指数）。已改为指数先单独取完、板块回补随后执行，并给指数日线加一次重试；同时 `missing` 会在指数部分缺失时显式标注 `N/3`。
- 历史涨跌家数复用板块回补缓存，调整顺序后侧车不再出现两路 90 请求并发。
- 批量回补会逐日调用日报生成，为避免一次点击刷满收件箱，新增 `notify` 选项：回补固定 `notify=false`，任务结果的 `email_status` 记为 `skipped`。
