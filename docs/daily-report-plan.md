# AI 收盘日报（股市日报 / 基金日报）开发方案

- 版本：v0.2（需求已确认，开发中）
- 目标分支：`feature/daily-report`
- 关联文档：`docs/plan.md`、`docs/design.md`、`docs/fund-workbench-design.md`、`docs/alert-center-plan.md`

## 1. 背景与目标

现有系统已具备行情、净值、资讯、AI 分析与预警能力，但所有 AI 产物都是「按需生成、绑定单一标的」。用户希望增加**收盘日报**，把当日全局信息沉淀成可回看的历史列表：

1. 两类日报：**股市日报**（个股视角）与**基金日报**（基金视角）。
2. **当日数据更新完成后立即触发**生成，而不是固定写死某个时刻。
3. 日报**优先保存到云端**（Cloudflare R2），本地兜底。
4. 系统内提供**按日期倒序（越新越靠前）的列表**，点击查看详情。

## 2. 可行性分析

### 2.1 依赖现状（已核实）

| 依赖 | 现状 | 结论 |
| --- | --- | --- |
| LLM | `.env` 已配置真实 `DEEPSEEK_API_KEY`，模型 `deepseek-chat`，`src/lib/analysis.ts`、`src/lib/fund-analysis.ts` 已有非流式与流式生成封装 | 可复用 |
| 云端存储 | `.env` 已配置真实 R2（account/ak/sk/bucket/public url），`src/lib/r2.ts` 已封装 `putJsonObject`/`getJsonObject`/`objectExists`/`deleteObject` | 可用，需补「按前缀列举」能力 |
| 定时任务 | `src/lib/scheduler.ts` 用 node-cron 在 Next 进程内注册任务，已有 cleanup / refresh / fund-refresh / alert-scan 四个任务，统一写 `job_runs` | 可按同样方式扩展 |
| 交易日历 | 侧车 `GET /trading-calendar`（AkShare），Web 端 `src/lib/trading-calendar.ts` 带 12h 缓存与工作日降级 | 可直接判断「今天是否该出日报」 |
| 股票行情/资讯 | 侧车 `/quote`、`/kline`、`/news`，Web 端 `src/lib/market-data.ts`、`src/lib/news.ts` | 可复用（自选股维度） |
| 基金净值/行情 | 侧车 `/fund/nav`、`/fund/intraday`（场内腾讯实时、场外新浪估值） | 可复用（自选基金维度） |
| 降级策略 | 项目既有约定：外部依赖不可用时用确定性模板数据并标注 `source` | 日报沿用同一约定 |

### 2.2 数据时点（决定「数据更新后立即触发」怎么实现）

- **大盘/个股行情**：交易日 15:00 收盘，行情快照通常在 15:00–15:30 之间稳定。
- **场外基金净值**：T 日净值一般 20:00–24:00 陆续公布，个别基金次日才更新。
- 因此「立即触发」采用**探测式触发**：在预置窗口内轮询「当日数据是否就绪」，就绪即生成，当天只生成一次；未就绪则本轮跳过，等下一个探测点。

### 2.3 关键风险

- **大盘指数与个股代码冲突**：`000001` 在 A 股既是平安银行又是上证指数。现有 `normalizeStockCode` 只支持 6 位 A 股代码，指数需要**侧车新增独立接口**（腾讯 `sh000001`/`sz399001`/`sz399006`）。
- **R2 无列举能力**：现有 `src/lib/r2.ts` 没有 list 接口，需补 `ListObjectsV2`（`@aws-sdk/client-s3` 已安装）。
- **定时任务只在 Next 进程存活时运行**：与现有 cleanup/预警扫描一致，属已知约束；手动「立即生成」可兜底。
- **LLM 成本**：每天最多 2 次生成（股市 + 基金），按 deepseek-chat 价格与单次约 2–4k tokens 估算，成本可忽略。

### 2.4 数据源实测结论（2026-09-10 实测）

| 数据源 | 接口 | 状态 | 说明 |
| --- | --- | --- | --- |
| 大盘指数 | 腾讯 `qt.gtimg.cn`（GBK） | 可用 | 已新增侧车 `/index/quote`，白名单校验；实测上证 3934.40 -0.43%、深成 13617.67 -0.77%、创业板 3338.42 -0.49% |
| 全市场涨跌家数 | AkShare `stock_market_activity_legu()` | 可用 | 已新增侧车 `/market/breadth`；实测上涨 931 / 下跌 4192 / 平盘 83 / 涨停 39 / 跌停 14 |
| 行业板块 | AkShare `stock_sector_spot()` | 可用 | 已新增侧车 `/market/sectors`（49 个板块，约 0.2 秒）；实测涨幅前 3：船舶制造 +2.61%、电力行业 +1.38%、金融行业 +0.93% |
| 东方财富系列 | `stock_zh_a_spot_em` / `stock_board_industry_name_em` | 不可用 | 本机代理不通，已放弃 |

结论：日报所需的「全市场涨跌 + 板块涨幅」两个 AkShare 轻量接口即可满足，无需引入东财重接口。

## 3. 关键设计

### 3.1 数据模型（`src/lib/shared/types/daily-report.ts`）

```text
DailyReportKind      = "stock" | "fund"
DailyReportSource    = "deepseek" | "template"      // 模板=未配置/调用失败时的确定性日报
DailyReportSummary   = { kind, date, generated_at, source, title, headline, metrics: DailyReportMetric[] }
DailyReport          = { ...summary, markdown, data: {...} }   // 列表用 summary，详情用 full
DailyReportMetric    = { label, value, change_pct? }
```

- `date` 为北京时间交易日（`YYYY-MM-DD`），是列表排序与去重的唯一键。
- 列表接口只返回 `summary`，避免一次拉全量正文。

### 3.2 存储设计（云优先 + 本地兜底）

- R2 对象键：`daily-reports/{kind}/{date}.json`
- 写入：`putJsonObject`（3 秒硬超时，沿用现有封装）
- 列表：新增 `listJsonObjects(prefix)`，基于 `ListObjectsV2Command` 取键名 → 解析日期 → **按日期倒序**
- 读取：`getJsonObject(key)`
- 兜底：R2 不可用或未配置时，写/读本地 `.data/daily-reports/{kind}/{date}.json`，列表按文件名倒序；面板标注「本地存储」

### 3.3 生成流程（`src/lib/daily-report.ts`）

1. `isReportReady(kind, date)`：判断当日数据是否就绪
   - 股市：三大指数（或自选股首只）当日行情快照的交易日 == 今天
   - 基金：自选基金当日净值 `nav_date` == 今天（场内看实时价）
2. `collectStockReportData()` / `collectFundReportData()`：汇总指标
   - 股市：三大指数涨跌与成交额、自选股涨跌榜、当日重要资讯标题
   - 基金：自选基金当日涨跌（场外净值 / 场内实时）、自选池等权涨跌、行业资讯
3. `buildDailyReportPrompt(...)` → DeepSeek 非流式生成 markdown（三段：市场概况 / 异动与结构 / 明日关注，并强制风险提示）
4. 失败或未配置密钥 → `buildTemplateDailyReport(...)`（确定性模板，`source = "template"`）
5. `saveDailyReport(report)`：R2 优先，失败落本地
6. `runDailyReportJob(kind)`: 就绪校验 → 已存在则跳过（除非 `force`）→ 生成 → 保存 → 写 `job_runs`

### 3.4 触发与调度

| 任务 | 默认表达式 | 说明 |
| --- | --- | --- |
| `daily-stock-report` | `*/10 15-16 * * 1-5` | 交易日 15:10 起每 10 分钟探测，就绪即生成，当天仅一次 |
| `daily-fund-report` | `*/20 20-23 * * 1-5` | 交易日 20:00 起每 20 分钟探测净值是否已更新 |

- 表达式可用 `DAILY_STOCK_REPORT_CRON` / `DAILY_FUND_REPORT_CRON` 覆盖。
- 任务内部先查交易日历：非交易日直接跳过并记录原因。

### 3.5 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/daily-reports?kind=stock` | 列表（日期倒序，返回 summary + 存储来源） |
| GET | `/api/daily-reports/{kind}/{date}` | 详情（完整 markdown + 指标 + 数据快照） |
| POST | `/api/admin/daily-reports` | 手动生成 `{ kind, date?, force? }`，用于验证与补生成 |
| DELETE | `/api/admin/daily-reports/{kind}/{date}` | 删除某天日报（可选） |

### 3.6 界面

- 个股工作台新增模块「AI 股市日报」，基金工作台新增模块「AI 基金日报」（沿用现有左侧勾选 + 拖拽排序体系，默认不勾选）。
- 列表：日期倒序；每条显示日期、生成时间、来源标签（AI / 模板）、存储位置（云端 / 本地）、一句话摘要。
- 点击进入详情：Markdown 渲染（复用 `react-markdown` + `remark-gfm`），顶部展示关键指标卡片与免责声明。
- 顶部提供「立即生成今日日报」按钮与「按指定日期生成」入口（日期选择 + 生成按钮），生成中禁用并展示状态；无日报时给出空态说明。
- 指定日期校验：必须为 `YYYY-MM-DD`、不晚于今天、且为交易日；前端拦截非法输入，后端同样校验。

## 4. 改动范围

- 新增：`src/lib/shared/types/daily-report.ts`、`src/lib/daily-report.ts`、`src/lib/daily-report-store.ts`、`src/components/panels/DailyReportPanel.tsx`、`src/app/api/daily-reports/**`、`src/app/api/admin/daily-reports/route.ts`
- 修改：`src/lib/r2.ts`（新增列出）、`src/lib/scheduler.ts`（注册两个任务）、`src/components/workbench/StockWorkbench.tsx`、`src/components/workbench/FundWorkbench.tsx`、`src/components/panels/FunctionOptionsSidebar.tsx`、`src/components/panels/fund/FundOptionsSidebar.tsx`、`data-service/app/main.py`（指数行情接口）、`README.md`、`.env.example`
- 不改动：现有 AI 分析、预警、数据库表结构（不新增表）

## 5. 任务拆解

1. **D1 契约与数据采集**：类型定义、指数行情接入、就绪判定、指标汇总（含单测）
2. **D2 生成与存储**：Prompt、DeepSeek 调用、模板降级、R2 写入/列举/读取、本地兜底
3. **D3 调度与接口**：cron 任务、job_runs 记录、列表/详情/手动生成接口
4. **D4 面板**：两个工作台的日报模块、列表倒序、详情查看、手动生成
5. **D5 验收与文档**：单测 + 端到端（R2 真实写入）+ README/文档更新

## 6. 验收标准与测试方式

- 单测（Vitest）：日期键与时区、就绪判定、列表倒序、存储键拼接、模板降级、指标格式化。
- 端到端：`POST /api/admin/daily-reports {kind:"stock"}` → R2 出现 `daily-reports/stock/{今日}.json` → 面板列表首条为今日 → 点击可查看完整日报；基金日报同理。
- 降级：临时改坏 `DEEPSEEK_API_KEY` → 仍能生成 `source=template` 的日报；临时改坏 R2 配置 → 落本地且面板标注「本地存储」。
- 命令：`corepack pnpm test && corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`

## 7. 已确认决策（用户 2026-09-10 答复）

1. **触发时机**：由实现方按数据源实际就绪时间决定，采用探测式触发（股市 15:10 起、基金 20:00 起轮询，就绪即生成）。
2. **日报口径**：必须包含全市场涨跌家数与行业板块涨幅，已在 2.4 与 3.3 落地。
3. **侧车改动**：允许新增指数接口，但必须做代码白名单校验，防止非法输入透传到上游（非法代码返回 400）。
4. **历史日报**：界面上必须提供「按指定日期生成历史日报」入口，而不只是后台接口。

## 8. 遗留与后续可选项

- 全市场涨跌家数与板块数据依赖 AkShare，上游不可用时日报会标注缺失项；后续可评估备用数据源。
- 日报只做当日快照，不含趋势对比；后续可选增加「与前一交易日对比」。
- 定时任务依赖 Next 进程存活，与既有 cleanup / 预警扫描约束一致。