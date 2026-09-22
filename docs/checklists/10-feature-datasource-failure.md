# 10 数据源故障处理与降级快照验收清单

- 分支：`feature/datasource-failure-ux`
- 关联方案：`docs/datasource-failure-plan.md`
- 目标：数据源不可用时，官方快照可降级复用并明确标注；无快照则提示故障并禁用触发按钮 10 秒；确定性演示数据不再面向用户。
- 状态：已完成（2026-09-20），等待用户确认后提交。

## 验收项

### 服务端

- [x] `src/lib/shared/types/datasource.ts`：提示文案、冷却时长、来源判定、降级标注类型
- [x] `src/lib/datasource.ts`：`DataSourceUnavailableError`、快照挑选与标注、错误响应映射
- [x] 行情：`getMarketQuote` / `getKlines` / `getIndicators` 无官方快照时抛错，不再返回确定性数据
- [x] 基金：`getFundProfile` / `getFundNav` / `getFundHoldings` / `getFundIntraday` 同上
- [x] 资讯：`getNews` / `searchNews` 移除演示资讯回退，官方快照可降级
- [x] 接口层：受影响路由统一返回 503 `SERVICE_UNAVAILABLE` + `retry_after_ms = 10000`
- [x] SSE：个股 / 基金的分析与对话错误事件带 `code` 与 `retry_after_ms`
- [x] 后台任务：预警扫描、日报生成、调度刷新捕获该错误并按跳过 / 标注处理，不中断其它任务
- [x] 对话链路：单一工具（如资讯检索）不可用时跳过并在回答中说明，核心行情不可用时整体提示故障

### 客户端

- [x] `useDatasourceGuard()`：冷却 10 秒、倒计时、提示文案、`guardError` 统一入口
- [x] 冷却状态全站共享：任一功能触发失败后，所有触发按钮同步禁用
- [x] `DatasourceUnavailableNotice` / `DatasourceUnavailableBanner` 统一呈现提示与剩余秒数
- [x] 个股工作台：查询 / 刷新、K 线周期、资讯搜索、AI 分析、对话发送 均受守卫约束
- [x] 基金工作台：查询、分析、对话、对比 / 组合 / 定投 / 持仓 / 风格 / 行业资讯 均受守卫约束
- [x] 个股组合 / 策略回测 / 日报补生成 受守卫约束
- [x] 降级快照展示：来源行标注「降级快照（数据源故障，降级于 …）」与抓取时间

### 测试与文档

- [x] 单测：快照回退、无快照抛错、错误映射、守卫冷却
- [x] 端到端：新增数据源故障用例（提示 + 按钮禁用 + 10 秒恢复）
- [x] 端到端：本地 mock 侧车保证正常链路用例仍可验证
- [x] 回归：`typecheck` / `lint` / `test` / `build` / `test:e2e` 全绿
- [x] 文档：README「数据与降级」、方案文档、清单勾选

## 验证记录（2026-09-20）

| 命令 | 结果 |
| --- | --- |
| `corepack pnpm typecheck` | 通过 |
| `corepack pnpm lint` | 通过（0 error / 0 warning） |
| `corepack pnpm test` | 51 个文件 / 624 个用例通过 |
| `corepack pnpm build` | 通过 |
| `corepack pnpm test:e2e` | 11 个用例通过（含 2 个数据源故障用例） |

- 新增单测：`tests/datasource.test.ts`、`tests/datasource-guard-client.test.ts`；`tests/format.test.ts` 补降级标注文案用例。
- 更新单测：`tests/market-data.test.ts`、`tests/news-client.test.ts` 改为验证官方快照降级与无快照抛错。
- 新增端到端：`tests/e2e/datasource-failure.spec.ts`；`tests/e2e/mock-sidecar.mjs` 提供官方来源数据与故障开关。

## 通过标准

- 数据源故障时功能不再展示任何合成行情 / 净值 / 资讯；
- 有官方快照时功能可用且明确标注降级来源与抓取时间；
- 无快照时提示统一、按钮 10 秒内不可重复触发，倒计时结束后恢复；
- 后台任务与实时推送保持既有降级策略，不产生未捕获异常。

## 风险与遗留

- 快照时效依赖本地历史数据，界面已成对展示降级与抓取时间；
- 端到端 mock 侧车覆盖的是官方来源链路，真实上游异常仍需本机联调验证；
- 实时推送条为被动订阅，保持既有「降级重连中」策略，不在按钮禁用范围内。