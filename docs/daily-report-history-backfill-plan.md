# 历史日期日报数据回补方案（成交额 / 涨跌家数 / 行业板块）

- 文档版本：v1.0
- 编制日期：2026-09-13
- 关联文档：`docs/daily-report-plan.md`、`docs/plan.md`、`docs/design.md`
- 建议分支：`fix/daily-report-history-data`
- 目标：修复「按指定历史日期补生成日报」时出现的三项「本日该数据不可用」

---

## 1. 问题现象

用户按 2026-09-11（当前 2026-09-13，9-11 为上一交易日）补生成股市日报，正文出现三处：

1. 「成交额方面，本日各指数成交额数据均为 0，本日该数据不可用」
2. 「本日全市场涨跌家数数据缺失，本日该数据不可用」
3. 「本日行业板块涨跌数据缺失，本日该数据不可用」

## 2. 根因分析

| 现象 | 根因 | 位置 |
| --- | --- | --- |
| 成交额全为 0 | 历史分支把 `amount` 硬编码为 0；侧车 `/index/kline` 未返回成交额字段（上游腾讯日线其实有） | `src/lib/daily-report.ts` 历史分支、`data-service/app/main.py` |
| 涨跌家数缺失 | `collectDailyReportData` 在 `!isToday` 时直接把 `breadth` 置为 null，从未尝试采集 | `src/lib/daily-report.ts` |
| 行业板块缺失 | 同上，`!isToday` 直接置 null，历史日期根本没有取数路径 | `src/lib/daily-report.ts` |

补充结论：三处缺失里，第 2、3 项**不是数据源没有数据，而是代码路径没有尝试**；第 1 项是侧车未透传字段。

## 3. 可行性分析（2026-09-13 实测）

### 3.1 成交额

- 侧车 `_tencent_daily_rows()` 已经解析腾讯日线第 9 位为 `amount`（单位：元），只是 `/index/kline` 出参未包含该字段。
- 实测：`sh000001` 2026-09-11 成交额约 9581.86 亿元，方向与量级正确。
- 结论：**可直接回补**，仅需出参补字段 + web 侧取值。

### 3.2 全市场涨跌家数

- AkShare `stock_market_activity_legu()` 页面只呈现**最新交易日**，无日期参数，不能任意回补历史。
- 但其返回值带 `stat_date`；实测当前（2026-09-13）`stat_date = "2026-09-11 15:00:00"`，即快照仍停留在上一交易日 9-11，与用户要补的日期一致。
- 结论：**当 `stat_date` 与目标日期一致时可直接复用真实数据**；更早的历史日期无公开历史接口。

### 3.3 行业板块（历史）

- 新浪 `stock_sector_spot()` 仅当日口径，无日期字段，无法证明对应哪一天。
- 同花顺 `stock_board_industry_index_ths(symbol, start_date, end_date)` **支持历史日期**，返回「日期/开盘价/最高价/最低价/收盘价/成交量/成交额」，可用相邻两日收盘价算涨跌幅。
- 实测：90 个行业板块并发 6 线程拉取 2026-09-11 涨跌幅 → **成功 90 / 失败 0，耗时 14.5 秒**；单板块约 0.4-0.7 秒。
- 结论：**可回补**，需要并发 + 按日期缓存控制耗时。

### 3.4 补充可用源

- `stock_zt_pool_em(date)` / `stock_zt_pool_dtgc_em(date)`：支持历史日期，实测 2026-09-11 涨停 40 家 / 跌停 21 家，耗时不足 1 秒。

## 4. 方案设计

### 4.1 侧车（`data-service/app/main.py`）

1. `GET /index/kline`：`days` 增加 `amount` 字段（腾讯日线第 9 位，单位元；缺失为 0）。
2. `GET /market/sectors?date=YYYY-MM-DD`（新增可选 `date`）
   - 未传或等于今日：沿用现有新浪 `stock_sector_spot()`（今日口径）。
   - 历史日期：同花顺 90 行业板块，并发上限 6，按日期缓存；逐板块容错，部分失败仍返回可用板块；全部失败才 502。
   - 历史口径没有「公司家数 / 领涨股」，`companies` 返回 0、`leader` 返回 null。
3. `GET /market/breadth?date=YYYY-MM-DD`（新增可选 `date`）
   - 未传或等于今日：沿用现有乐咕口径。
   - 历史日期：先取乐咕快照，若 `stat_date` 前缀与目标日期一致 → 直接返回真实数据（`stat_scope = "market"`）。
   - 若不一致 → 用行业板块口径近似：统计上涨/下跌/平盘板块数（`stat_scope = "sector"`），并用涨停池/跌停池补 `limit_up` / `limit_down`；`activity_pct` 为 null。
   - 两条路径都不可用 → 502，由 web 侧写入缺失说明。

### 4.2 Web（`src/lib/daily-report.ts`、`src/lib/data-service.ts`、类型）

1. `IndexKlineDay` 增加 `amount?: number | null`；历史分支用真实成交额替换硬编码 0。
2. `MarketBreadthSnapshot` 增加 `stat_scope?: "market" | "sector"`；`limit_up` / `limit_down` / `suspended` 允许为 null。
3. `fetchMarketBreadthFromSidecar(date?)` / `fetchMarketSectorsFromSidecar(limit, date?)` 支持传日期。
4. `collectDailyReportData`：历史日期同样采集涨跌家数与行业板块（传日期），仅当两侧都取不到才写缺失项，并把原因写清楚（区分「上游无历史接口」与「侧车暂不可用」）。
5. 模板与提示词：板块/涨跌家数标注统计口径；指数区块补成交额列；提示词要求「有数据必须引用具体数字」。

## 5. 改动范围

- 修改：`data-service/app/main.py`、`src/lib/daily-report.ts`、`src/lib/data-service.ts`、`src/lib/shared/types/daily-report.ts`
- 新增：无（不新增表、不新增接口路径，仅给既有接口加可选参数）
- 测试：`tests/daily-report.test.ts` 增补历史口径用例

## 6. 验收标准

- [ ] 9-11 股市日报重新生成后，成交额、涨跌家数、行业板块三处不再出现「本日该数据不可用」
- [ ] 成交额与指数日线真实值一致（量级约 10^12 元）
- [ ] 历史板块口径与上游同花顺一致（抽查「半导体」「白酒」）
- [ ] 早于最新交易日的历史日期：涨跌家数给出板块口径标注或明确原因，不再笼统写「不可用」
- [ ] `corepack pnpm test`、`typecheck`、`lint`、`build` 全部通过
- [ ] 当日日报（今日）行为不回归

## 7. 风险与遗留

- 历史板块回补需 90 次上游请求（约 15 秒），已做并发与按日期缓存；上游限流时允许部分板块缺失。
- 更早历史日期的「个股涨跌家数」无公开接口，只能用板块口径近似并显式标注，不能当作真实家数使用。
- 侧车进程内缓存，重启后首次请求会重新拉取。