# 实时行情推送与站内预警 规划

- 文档版本：v0.1
- 编制日期：2026-09-11
- 关联文档：`docs/plan.md`、`docs/alert-center-plan.md`、`docs/daily-report-plan.md`
- 建议分支：`feature/realtime-quote-push`
- 目标模块：个股/基金工作台新增实时行情条，预警中心升级为盘中实时判定与站内通知

---

## 1. 背景与目标

现状是「拉取式」：行情靠页面手动/定时刷新，预警靠 `ALERT_CRON`（默认每 30 分钟）批量扫描，命中后只写事件流并按需发邮件，上限 3 个标的。用户盘中无法看到自选池的实时变化，预警最快也要 30 分钟后才可见。

本阶段目标：把自选池行情与预警从「分钟级轮询 + 仅邮件」升级为「秒级推送 + 站内实时可见」。

- 实时行情：自选池（股票 + 基金）行情按秒级推送，页面实时刷新，带连接状态与数据来源标注。
- 实时预警：复用既有规则引擎，在每次推送 tick 顺带判定，命中即刻弹站内通知（可选浏览器通知与提示音），邮件通道保留。
- 解除标的数量限制：`ALERT_MAX_TARGETS` 默认从 3 放宽到 10，并保持可配置。

明确不做（边界）：

- 不做投顾式「买卖提示」，不改变预警「条件命中」的既有语义。
- 不引入 Redis/消息队列；单机单实例内存态实现，文档明确标注不适用多实例部署。
- 不做逐笔（Level-2）行情，只做快照级推送。

## 2. 可行性分析

### 2.1 可复用的既有能力

| 能力 | 现成实现 | 复用方式 |
| --- | --- | --- |
| SSE 流式输出 | `src/app/api/stocks/[code]/analysis/stream/route.ts`、`src/app/api/fund-chat/route.ts` | 复用 ReadableStream + SSE 写法 |
| 批量行情上游 | 侧车 `/index/quote` 已用逗号批量查腾讯 `qt.gtimg.cn` | 抽成通用批量行情接口 |
| 预警规则引擎 | `src/lib/alerts.ts`：`isTradingSession`、`evaluateAlertRule`、`buildAlertEvent`、冷却判断 | 直接复用，无需改判定语义 |
| 预警观测采集 | `src/lib/alert-scan.ts:collectAlertObservations` | 复用采集逻辑 |
| 交易日历 | `src/lib/trading-calendar.ts` | 判断是否处于交易时段 |
| 事件与设置存储 | `src/lib/alert-store.ts`、`.data/alerts.json` 回退 | 复用，不新增表 |
| 定时任务 | `src/lib/scheduler.ts`（node-cron） | 轮询器生命周期挂靠现有调度 |

### 2.2 结论

- 可行性高：SSE、批量上游、规则引擎、交易日历均为现成能力，属于「拼装 + 补前端」。
- 主要成本在前端体验与上游频率治理，不在算法。

### 2.3 主要风险与对策

- 上游限流/封禁（最大风险）：必须服务端合并订阅代码、去重后批量拉取，最小间隔下限 3 秒，默认 5 秒；单次请求代码数上限 50；连续失败指数退避并降低频率；非交易时段停推（每 60 秒一次保活心跳）。
- 长连接资源占用：仅在页面处于可视状态且用户开启实时开关时建连；页面隐藏降频到 30 秒。
- 单实例假设：轮询器为进程内单例，多实例会重复拉取；本机单用户场景可接受，文档标注。
- Next.js 路由限制：SSE 路由需 `runtime = "nodejs"` 与 `dynamic = "force-dynamic"`，避免被静态化或走 Edge。
- 请求放大：所有订阅者共享一个轮询器与一份快照缓存，订阅者数量不线性放大上游请求。

## 3. 功能范围

### 3.1 侧车：批量行情

- 新增 `GET /quotes?codes=600519,000001,510300`（上限 50 个，逐个校验 6 位数字，非法返回 400）。
- 复用腾讯多代码查询并按行解析；单个代码无数据时在结果中标记，不整批失败。
- 保留 `/quote` 单代码接口不变（向后兼容）。

### 3.2 服务端：行情轮询与 SSE

- 新增 `GET /api/stream/quotes?codes=...`（SSE）。
  - 事件类型：`snapshot`（行情数组）、`alert`（命中事件）、`status`（连接与数据源状态）、`heartbeat`。
  - 服务端维护单例轮询器：合并所有连接的代码集合 → 去重 → 批量拉取 → 广播。
  - 交易时段内按 `QUOTE_STREAM_INTERVAL_MS`（默认 5000）推送；非交易时段每 60 秒推送一次快照并标注 `market_closed`。
  - 侧车不可用时推送降级快照并标注 `source`，不中断连接（连续失败时降频）。
- 新增 `GET /api/stream/status`：返回轮询器状态（连接数、最近一次拉取时间、上游状态），供前端指示灯与数据源面板使用。

### 3.3 前端：实时行情与站内通知

- 顶部（或侧栏）新增实时行情条 `src/components/panels/RealtimeQuoteBar.tsx`：展示自选池前若干标的的价格/涨跌幅、连接状态灯、最近更新时间、「实时」开关与提示音开关。
- 自选池边栏（`WatchlistSidebar`、`FundWatchlistPanel`）与持仓面板在有实时快照时优先使用快照价，并标注「实时」。
- 预警中心（`AlertPanel`）订阅 `alert` 事件：命中即刻插入事件列表、弹站内 toast、可选浏览器通知（Notification API，需用户授权）与提示音。
- 实时开关默认关闭，用户开启后才建立 SSE 连接，避免无谓占用。

### 3.4 预警实时判定

- 轮询器每次拿到快照后，对启用的规则调用现有 `evaluateAlertRule` 做增量判定（复用冷逻辑：同一规则 12 小时冷却、`isTradingSession` 校验）。
- 命中即写入事件流（复用 `alertRepository`），并通过 SSE 推给前端；邮件仍按 `alert-email` 通道发送，配置不变。
- 现有 30 分钟 `ALERT_CRON` 保留为兜底（例如页面未打开时仍能发现命中并记录/发邮件）。

## 4. 关键设计

### 4.1 类型

新增 `src/lib/shared/types/realtime.ts`（本分支内新增，不改既有字段）：

- `QuoteSnapshotItem`：code、name、target（stock/fund）、price、change、change_pct、source、fetched_at、is_stale。
- `QuoteStreamEvent`：`{ type: "snapshot" | "alert" | "status" | "heartbeat"; ... }`。
- `QuoteStreamStatus`：connected_clients、last_fetch_at、last_fetch_ok、upstream_source、market_closed、interval_ms。

### 4.2 服务端模块

- `src/lib/quote-bus.ts`：订阅者注册/注销、代码集合合并、轮询循环、退避与广播（单例）。
- `src/lib/quote-scan.ts`：把快照转成预警观测值并调 `evaluateAlertRule`，返回命中事件（纯编排，便于单测注入假数据）。
- `src/lib/data-service.ts` 新增 `fetchQuotesFromSidecar(codes)`。

### 4.3 配置

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `QUOTE_STREAM_INTERVAL_MS` | `5000` | 交易时段推送间隔，下限 3000 |
| `QUOTE_STREAM_MAX_CODES` | `50` | 单次批量拉取代码上限 |
| `QUOTE_STREAM_IDLE_INTERVAL_MS` | `60000` | 非交易时段保活间隔 |
| `ALERT_MAX_TARGETS` | `10` | 由 3 放宽到 10，仍可配置 |

## 5. 里程碑

| 编号 | 内容 | 验收要点 |
| --- | --- | --- |
| B1 | 侧车批量行情 `/quotes` | 批量返回、非法输入 400、单代码缺失不整批失败 |
| B2 | 服务端轮询器与 SSE | 多订阅者共享一次拉取、交易时段按间隔推送、非交易时段降频 |
| B3 | 前端实时行情条与自选池联动 | 开关可控、状态灯正确、断开自动重连 |
| B4 | 预警实时判定与站内通知 | 命中即刻可见、冷却生效、不重复刷屏、邮件通道不变 |
| B5 | 集成与整体验收 | typecheck/lint/test/build 通过，既有预警与日报无回归 |

## 6. 验收方式

- `corepack pnpm test`（新增 `quote-scan` 判定与 `quote-bus` 合并/退避单测）、`typecheck`、`lint`、`build` 全部通过。
- 侧车：`curl "http://127.0.0.1:8000/quotes?codes=600519,000001,510300"` 返回 3 条；`codes=abc` 返回 400。
- 端到端：开启实时开关，观察自选池价格随行情变化刷新，状态灯为已连接，断开侧车后自动降级并重连。
- 端到端：设置「当日涨跌幅 ≤ -0.01%」这类易触发条件，命中后站内立即出现事件与 toast；12 小时冷却内不重复触发。
- 长跑观察：连续连接 10 分钟，确认上游请求次数与推送次数比值接近 1（无订阅放大）。

## 7. 风险与缓解

- 上游限流：批量合并 + 最小间隔 + 失败退避 + 非交易时段停推，四项缺一不可。
- 浏览器通知权限被拒：降级为站内 toast 与角标，不阻塞功能。
- 与个股组合特性并发改同一批文件（`StockWorkbench.tsx`、`FunctionOptionsSidebar.tsx`）：串行开发，本特性在组合特性合并后再开分支。
- 实时数据被误读为「投资信号」：保持「条件命中」口径与免责声明，不新增推荐性文案。

## 8. 依赖与配置

- 无新增密钥。邮件通道沿用既有 SMTP 配置。
- 依赖侧车与本机 Web 服务常驻；浏览器需支持 EventSource（现代浏览器均支持）。
