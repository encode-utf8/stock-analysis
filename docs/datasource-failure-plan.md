# 数据源故障处理与降级快照方案（R1–R5）

- 分支：`feature/datasource-failure-ux`
- 关联验收：`docs/checklists/10-feature-datasource-failure.md`、`checklist.md`

## 1. 背景与问题

系统当前的实时数据读取链路（`market-data.ts`、`fund-data.ts`、`fund-holdings.ts`、`fund-intraday.ts`、`news.ts`）在行情侧车不可达或上游不可用时，会回退到本地生成的**确定性演示数据**（`source = deterministic-fallback`，侧车自身也会返回该标记）。

这类数据是伪随机生成的演示值，与真实市场无关：

- 用户看到的是「看似正常、实际错误」的价格、净值与涨跌幅，据此做判断会被误导；
- 界面虽有「确定性降级数据」来源标注，但功能仍在正常执行，用户难以意识到结果不可用；
- 已有的编排层（回测、定投、风格、预警）已经拒绝确定性数据，行情展示层却仍在使用，口径不一致。

## 2. 目标与规则

**R1 官方快照可降级复用**：当数据源（行情侧车 / 上游 AkShare、腾讯、乐咕、同花顺、新浪）不可用时，若本地存储中存在**官方来源**的历史快照（行情、K 线、基金档案、净值、持仓、盘中估算、资讯），则基于该快照继续提供服务，功能正常执行，同时在数据与界面上明确标注「降级快照」及其抓取时间。

**R2 无快照即明确失败**：若既无法访问数据源、也没有任何官方来源快照，则该功能**不返回任何数据**，统一提示「当前数据源故障，请稍后再试」，并将该功能的触发按钮**自动禁用 10 秒**（倒计时展示），避免连续点击。

**R3 确定性演示数据不再面向用户**：所有面向用户的实时 / 最新数据读取路径不再返回 `deterministic-fallback` 数据；该标记一律按「数据源故障」处理。

**R4 后台任务不受按钮语义影响**：定时任务（日报生成、预警扫描、数据一致性巡检、调度守护、实时推送总线）保持既有策略——跳过降级观测值、记录跳过原因或计入失败重试，不引入「按钮禁用」，也不因数据源故障中断其他任务。

**R5 统一错误契约与前端守卫**：服务端以同一错误码与文案返回，客户端以统一的守卫 Hook 处理冷却与提示，避免各面板各写一套倒计时。

## 3. 判定规则

| 判定 | 规则 |
| --- | --- |
| 官方来源 | `source` 属于 `akshare`、`tencent`、`sina`、`legulegu`、`ths`、`eastmoney` 等真实上游标识 |
| 合成数据 | `source === "deterministic-fallback"`，或以「演示」开头的资讯来源 |
| 快照回退 | 侧车调用失败或返回合成数据时，取本地存储中最近一条官方来源记录（不限制新鲜度，但界面必须展示抓取时间） |
| 无快照 | 抛出 `DataSourceUnavailableError`，由接口层转换为 503 + `SERVICE_UNAVAILABLE` |

## 4. 服务端方案

1. 新增共享模块 `src/lib/shared/types/datasource.ts`：常量（提示文案、冷却时长）、来源判定函数、降级快照标注类型。
2. 新增 `src/lib/datasource.ts`：`DataSourceUnavailableError`、快照挑选与标注、错误到响应体的映射辅助。
3. 数据编排层改造：
   - `market-data.ts`：`getMarketQuote` / `getKlines` / `getIndicators` 改为「缓存 → 内存 Store 官方数据 → 侧车官方数据 → 官方快照（标注降级）→ 抛错」；
   - `fund-data.ts`、`fund-holdings.ts`、`fund-intraday.ts`：同上；
   - `news.ts`：移除演示资讯回退，改为「缓存 → Store 官方资讯 → Tavily → 官方快照（标注降级）→ 抛错」。
4. 接口层：新增 `apiDatasource()` 包装，受影响路由返回 503：
   ```json
   { "success": false, "error": { "code": "SERVICE_UNAVAILABLE", "message": "当前数据源故障，请稍后再试。", "details": { "retry_after_ms": 10000, "feature": "行情快照" } } }
   ```
5. SSE 链路（个股分析 / 对话、基金分析 / 对话）：`error` 事件补充 `code` 与 `retry_after_ms`，客户端据此进入冷却。
6. 后台任务：`alert-scan.ts`、`daily-report.ts` 捕获该错误并按「跳过本轮 / 标注不可用」处理。

## 5. 客户端方案

1. 新增 `src/lib/datasource-guard-client.ts`：
   - `DatasourceUnavailableError` 客户端类型与解析函数（识别 503 + `retry_after_ms`）；
   - `useDatasourceGuard()`：`blocked` / `remainingSeconds` / `message` / `guardError()` / `reportDatasourceFailure()` / `clear()`，内部维护 10 秒冷却计时。
2. 新增 `DatasourceUnavailableNotice` 组件：统一展示「数据源故障，请稍后再试（N 秒后可重试）」。
3. 接入触发入口（按钮禁用 + 提示）：个股查询 / 刷新、AI 分析、对话发送、资讯搜索、K 线周期切换、基金查询 / 分析与对话、基金对比 / 组合 / 定投 / 持仓 / 风格、个股组合与回测、日报补生成等。
4. 降级快照的展示：数据来源行追加「降级快照」标注（含抓取时间），例如「来源：AkShare 实时行情（降级快照，抓取于 …）」。

## 6. 覆盖清单

| 功能 | 数据入口 | 无快照时表现 |
| --- | --- | --- |
| 个股行情快照 / 盘面 | `/api/stocks/:code/quote` | 提示 + 查询按钮禁用 10 秒 |
| K 线 / 技术指标 | `/api/stocks/:code/kline`、`/indicators` | 提示 + 周期切换禁用 10 秒 |
| 个股资讯 | `/api/stocks/:code/news` | 提示 + 搜索按钮禁用 10 秒 |
| 个股 AI 分析 | `/api/stocks/:code/analysis(/stream)` | SSE 错误事件 + 生成按钮禁用 10 秒 |
| 对话助手 / 基金对话 | `/api/chat`、`/api/fund-chat` | SSE 错误事件 + 发送按钮禁用 10 秒 |
| 基金档案 / 净值 / 盘中 / 持仓 | `/api/funds/:code/*` | 提示 + 对应加载按钮禁用 10 秒 |
| 基金对比 / 组合 / 定投 / 风格 | `/api/fund-*` | 提示 + 计算按钮禁用 10 秒 |
| 个股组合 / 策略回测 | `/api/stock-portfolio`、`/api/stock-backtest` | 提示 + 运行按钮禁用 10 秒 |
| 日报生成 / 补生成 | `/api/admin/daily-reports/backfill` 等 | 提示 + 按钮禁用 10 秒 |
| 实时行情推送条 | `/api/stream/quotes` | 保持既有「降级重连中」状态（无按钮） |
| 预警扫描 / 调度任务 | 后台任务 | 跳过降级观测值并记录原因（无按钮） |

## 7. 测试与验收

- 单测：数据编排层的「快照回退」「无快照抛错」「合成数据不入库」；错误映射与守卫 Hook 的冷却计算。
- 组件/交互：提示文案与按钮禁用、倒计时结束后恢复可用。
- 端到端：新增 `tests/e2e/datasource-failure.spec.ts`，通过接口拦截构造 503，断言提示、按钮禁用与 10 秒后恢复；同时为端到端增加本地 mock 侧车（官方来源），保证既有对话 / 分析用例仍能验证正常链路。
- 回归：`typecheck`、`lint`、`test`、`build`、`test:e2e` 全绿。

## 8. 风险与遗留

- 官方快照可能较旧（如停牌、长假），界面必须成对展示抓取时间，避免误读为实时值；
- 无快照时功能直接不可用属于产品取舍：优先保证「不误导」，代价是离线演示能力下降；
- 端到端引入 mock 侧车后，用例覆盖的是「官方来源」链路，真实上游波动仍依赖本机联调；
- 实时推送条为被动订阅，保持既有降级重连策略，不在按钮禁用范围内。
