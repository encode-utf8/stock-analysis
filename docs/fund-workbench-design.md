# 基金分析工作台 技术设计文档

- 文档版本：v1.0
- 编制日期：2026-09-07
- 编制角色：项目负责人 / 架构师
- 关联文档：`docs/fund-workbench-spec.md`（基金工作台需求）、`docs/spec.md`（个股工作台需求）、`docs/design.md`（个股工作台技术设计）
- 文档性质：基金工作台的技术方案与选型；与个股工作台技术设计分离

---

## 1. 设计目标

- 在现有“Next.js 全栈 + Python 行情侧车”工程内增量实现基金工作台，不推倒重建现有个股工作台。
- 通过全局工作台切换实现个股/基金两套页面共存，并保证状态、会话、缓存、报告相互隔离。
- 基金数据源与指标计算解耦：真实数据来自扩展后的行情侧车，指标由本地计算，数据源失败时降级为确定性基金数据。
- AI 分析与对话复用现有 DeepSeek 接入、SSE 流式与确定性回退能力，但使用基金专属工具和上下文。
- 首期优先满足主流公募基金，重点保障历史净值、当日实时/估算涨跌、季度持仓与回撤修复指标。

---

## 2. 关键取舍

| 需求/问题 | 取舍决策 | 理由 |
| --- | --- | --- |
| 工作台切换 | 单 Next.js 应用内实现，不拆多应用；`page.tsx` 收敛为 Shell，增加 `WorkbenchSwitcher` | 保持本地单机启动简单，避免路由/状态割裂 |
| 基金数据源 | 扩展现有 FastAPI 侧车，新增基金接口；继续使用 AkShare，失败时走基金确定性降级 | 复用现有基础设施，最小化新服务数量 |
| 场内/场外基金 | 统一为基金模型，`intraday` 返回 `realtime` 或 `estimate` 两种模式 | 场内 ETF/LOF 有实时价，场外基金只有盘中估算，避免两套接口 |
| 盘中估算涨跌 | 场外基金标记 `estimate`，官方净值发布后自动以 `official` 覆盖 | 估算值非官方数据，必须在数据模型、界面与 AI 提示词中显式区分 |
| 持仓详情 | 使用最新季度报告，不做“实时持仓”承诺 | 基金完整持仓披露滞后，公开源无法实时获取 |
| 回撤/修复指标 | 全部基于历史净值在 TypeScript 本地计算，不依赖外部平台 | 计算口径可控、可测试、成本低 |
| AI 分析 | 复用 DeepSeek + SSE，新增基金专属 tools 和 `fund_analysis_reports` | 避免复制整套 AI 基础设施，同时隔离业务数据 |
| 数据模型 | 新增 `funds_*` 表，不复用 `stocks_*` 表并塞入类型字段 | 个股/基金字段差异大，独立模型更清晰，避免破坏既有迁移 |
| 页面状态 | 个股/基金各自维护 active code、查询结果、会话与报告状态，只共享 UI 基础组件 | 防止切换工作台后股票上下文串入基金分析 |

结论：基金工作台采用“现有工程底座 + 基金专用数据/路由/类型/AI 工具”的增量方案，不改变现有个股工作台的数据语义与验收行为。

---

## 3. 技术栈总览

- 语言：TypeScript（前端/后端/Agent）+ Python 3.12（行情与基金数据侧车）。
- 前端：Next.js App Router、React、TypeScript、Tailwind CSS、shadcn/ui、ECharts（净值曲线、回撤曲线、持仓分布）。
- 后端与 Agent：Next.js Route Handlers、SSE 流式接口、OpenAI 兼容接口调用 DeepSeek。
- 基金数据服务：FastAPI + AkShare，扩展基金档案、净值、盘中估算、持仓接口。
- 搜索：Tavily，用于基金公告、定期报告、行业政策与市场资讯检索。
- 数据库：PostgreSQL + Drizzle ORM，新增基金专用表。
- 对象存储：Cloudflare R2，保存基金分析报告快照与关键持仓/净值快照。
- 调度：node-cron，基金资讯清理、净值与持仓刷新。
- 可观测：复用现有 `observability.ts`，扩展基金数据源健康状态。

---

## 4. 总体架构

组件分层：
- 展示层：Next.js 页面 Shell、`WorkbenchSwitcher`、`StockWorkbench`、`FundWorkbench` 及基金面板。
- 应用/Agent 层：基金数据编排、指标计算、AI 分析、对话助手、缓存策略。
- 基金数据层：Python FastAPI + AkShare，提供基金 profile/nav/intraday/holdings 标准化 JSON。
- 情报层：Tavily 搜索，基金公告/报告/资讯去重、分类与影响周期判定。
- 存储层：Postgres（基金结构化数据）+ R2（报告与快照）。
- 调度层：node-cron（净值/持仓刷新、资讯清理）。
- 模型层：DeepSeek（基金分析、教学讲解、对话与风险提示）。

数据流：
- 基金查询：前端 → `fund-data.ts` 查内存/缓存 → 命中直接返回；未命中调 Python 侧车 → 回写 Postgres 与缓存并返回。
- 指标计算：前端请求 `/api/funds/:code/metrics` → `fund-metrics.ts` 读取历史净值 → 本地计算回撤/修复/风险指标 → 返回快照。
- AI 分析：前端 POST `/api/funds/:code/analysis/stream` → `fund-analysis.ts` 拉取基金档案、净值、盘中行情、持仓、指标与资讯 → DeepSeek 流式生成 → 落库 `fund_analysis_reports`。
- 对话：前端 POST `/api/fund-chat` → `fund-chat.ts` 以当前基金上下文回答，会话写入 `fund_conversations` / `fund_messages`。

---

## 5. 模块设计

### 5.1 Web 展示层
- `src/components/workbench/WorkbenchSwitcher.tsx`：顶部全局切换控件，维护 `workbench: "stock" | "fund"`。
- `src/components/workbench/StockWorkbench.tsx`：从现 `page.tsx` 收敛而来的个股工作台容器，仅做迁移，不改变业务行为。
- `src/components/workbench/FundWorkbench.tsx`：基金工作台容器，维护基金代码、模块可见性与基金各面板状态。
- `src/components/panels/fund/FundProfilePanel.tsx`：基金档案与净值快照。
- `src/components/panels/fund/FundNavChartPanel.tsx`：历史净值曲线、区间切换、单位/累计净值切换。
- `src/components/panels/fund/FundIntradayPanel.tsx`：场内实时行情或场外盘中估算。
- `src/components/panels/fund/FundHoldingsPanel.tsx`：最新季度持仓、行业/资产分布、集中度。
- `src/components/panels/fund/FundRiskPanel.tsx`：最大回撤、当前回撤、修复指标与风险收益指标。
- `src/components/panels/fund/FundAnalysisPanel.tsx`：基金 AI 报告列表与流式生成状态。
- `src/components/panels/fund/FundChatPanel.tsx`：可复用现有 `ChatPanel` 的 UI 层，但 API 与数据上下文切换为基金。

### 5.2 应用/Agent 层
- `src/lib/fund-market.ts`：基金代码校验、类型识别、默认基金解析。
- `src/lib/fund-data.ts`：基金数据编排，缓存命中优先、store 次之、侧车再次、确定性回退最后。
- `src/lib/fund-metrics.ts`：收益、波动、回撤、修复、夏普/索提诺/卡玛等本地计算。
- `src/lib/fund-analysis.ts`：基金 AI 分析编排与流式输出。
- `src/lib/fund-chat.ts`：基金对话上下文构建与流式回复。
- `src/lib/fund-news.ts`：基金公告与资讯抓取、去重、分类、过期清理。
- `src/lib/fund-deterministic.ts`：无外部数据源时的确定性基金数据生成。
- `src/lib/fund-watchlist.ts`：自选基金仓储与文件/数据库回退。

### 5.3 数据服务层
- `data-service/app/fund_routes.py`：基金数据侧车路由，统一返回 `source` 与 `fetched_at`。
- 建议内部函数：`_build_akshare_fund_profile`、`_build_akshare_fund_nav`、`_build_akshare_fund_intraday`、`_build_akshare_fund_holdings`、`_build_fallback_fund_*`。
- `data-service/app/main.py` 仅注册路由，不把基金逻辑塞入既有股票端点。

### 5.4 共享类型
- `src/lib/shared/types/funds.ts`：冻结基金领域类型。
- `src/lib/shared/types/index.ts`：增加 `export * from "./funds"`。
- 既有股票类型不做破坏性修改。

---

## 6. 数据模型

### 6.1 共享类型草案

```ts
export type FundType =
  | "stock"
  | "hybrid"
  | "index"
  | "bond"
  | "qdii"
  | "fof"
  | "reits"
  | "other";

export type FundTradingMode = "otc" | "exchange";
export type FundIntradayMode = "realtime" | "estimate";

export interface FundProfile {
  code: string;
  name: string;
  type: FundType;
  trading_mode: FundTradingMode;
  manager: string | null;
  company: string | null;
  benchmark: string | null;
  establish_date: string | null;
  scale: number | null;
  risk_level: string | null;
  source: string;
  fetched_at: string;
}

export interface FundNavPoint {
  code: string;
  nav_date: string;
  unit_nav: number;
  cumulative_nav: number;
  daily_change_pct: number | null;
  source: string;
  fetched_at: string;
}

export interface FundIntraday {
  code: string;
  mode: FundIntradayMode;
  ts: string;
  price: number | null;
  estimated_nav: number | null;
  change_pct: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  amount: number | null;
  iopv: number | null;
  premium_rate: number | null;
  official_nav: number | null;
  official_nav_date: string | null;
  source: string;
  fetched_at: string;
}

export interface FundHoldingItem {
  code: string | null;
  name: string;
  weight_pct: number;
  change_pct: number | null;
  industry: string | null;
}

export interface FundHoldings {
  code: string;
  report_date: string;
  published_at: string | null;
  top_holdings: FundHoldingItem[];
  asset_allocation: Record<string, number>;
  industry_allocation: Record<string, number>;
  top10_weight_pct: number | null;
  top1_weight_pct: number | null;
  source: string;
  fetched_at: string;
}

export interface FundRiskMetrics {
  code: string;
  range: string;
  start_date: string;
  end_date: string;
  max_drawdown_pct: number;
  max_drawdown_start: string;
  max_drawdown_end: string;
  current_drawdown_pct: number;
  longest_recovery_days: number | null;
  average_recovery_days: number | null;
  current_recovery_progress_pct: number | null;
  annualized_return_pct: number | null;
  annualized_volatility_pct: number | null;
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  updated_at: string;
}
```

### 6.2 Drizzle 表

- `funds`：`code`（PK）、`name`、`type`、`trading_mode`、`manager`、`company`、`benchmark`、`establish_date`、`scale`、`risk_level`、`meta`、`source`、`fetched_at`。
- `fund_navs`：`code`、`nav_date`、`unit_nav`、`cumulative_nav`、`daily_change_pct`、`source`、`fetched_at`；主键 `(code, nav_date)`，索引 `(code, nav_date)`。
- `fund_intraday`：`code`、`ts`、`mode`、`price`、`estimated_nav`、`change_pct`、`open`、`high`、`low`、`volume`、`amount`、`iopv`、`premium_rate`、`official_nav`、`official_nav_date`、`source`、`fetched_at`；主键 `(code, ts)`。
- `fund_holdings`：`code`、`report_date`、`published_at`、`top_holdings`（JSONB）、`asset_allocation`（JSONB）、`industry_allocation`（JSONB）、`top10_weight_pct`、`top1_weight_pct`、`source`、`fetched_at`；主键 `(code, report_date)`。
- `fund_risk_metrics`：`code`、`range`、`start_date`、`end_date`、`max_drawdown_pct`、`max_drawdown_start`、`max_drawdown_end`、`current_drawdown_pct`、`longest_recovery_days`、`average_recovery_days`、`current_recovery_progress_pct`、`annualized_return_pct`、`annualized_volatility_pct`、`sharpe`、`sortino`、`calmar`、`updated_at`；主键 `(code, range)`。
- `fund_news_items`：同现 `news_items` 结构，但使用 `fund_code` 或直接 `code`，并增加 `news_type`（`announcement` / `report` / `market`）。
- `fund_analysis_reports`：`id`（PK）、`code`、`created_at`、`data_snapshot`（JSONB）、`news_refs`（JSONB）、`content`、`risk_note`。
- `fund_conversations`：`id`（PK）、`code`、`title`、`created_at`。
- `fund_messages`：`id`（PK）、`conversation_id`、`role`、`content`、`tool_calls`（JSONB）、`created_at`。
- `fund_watchlist`：`code`（PK）、`name`、`type`、`trading_mode`、`note`、`sort_order`、`added_at`。

### 6.3 Store 扩展

在 `src/lib/store/index.ts` 新增基金仓库接口，并同步实现内存版与 Drizzle 版：
- `FundRepository`
- `FundNavRepository`
- `FundIntradayRepository`
- `FundHoldingsRepository`
- `FundRiskMetricsRepository`
- `FundNewsRepository`
- `FundAnalysisReportRepository`
- `FundConversationRepository`
- `FundMessageRepository`
- `FundWatchlistRepository`

仓库方法只暴露基金领域所需查询，不复用个股仓库接口，避免语义耦合。

---

## 7. 接口设计

### 7.1 Python 数据侧车

- `GET /fund/profile?code=510300`：基金档案与类型识别。
- `GET /fund/nav?code=110022&start=2020-01-01&end=2026-09-07&nav_type=unit|cumulative`：历史净值。
- `GET /fund/intraday?code=510300`：场内实时行情，`mode=realtime`；场外基金返回 `mode=estimate`。
- `GET /fund/holdings?code=110022`：最新季度持仓，含报告期与披露时间。
- 所有响应统一带 `source`、`fetched_at`；AkShare 或上游失败时返回 `source=deterministic-fallback`。

### 7.2 Next.js 基金 API

- `GET /api/funds/[code]/profile`
- `GET /api/funds/[code]/nav?range=1m|3m|6m|1y|3y|all&type=unit|cumulative`
- `GET /api/funds/[code]/intraday`
- `GET /api/funds/[code]/holdings`
- `GET /api/funds/[code]/metrics?range=1y|3y|all`
- `GET /api/funds/[code]/news?days=30&refresh=1`
- `POST /api/funds/[code]/analysis`
- `POST /api/funds/[code]/analysis/stream`
- `POST /api/funds/[code]/analysis/stop`
- `GET /api/funds/[code]/reports`
- `DELETE /api/funds/[code]/reports/[id]`
- `POST /api/fund-chat`：SSE 流式基金对话。
- `GET /api/fund-conversations?code=`
- `GET /api/fund-conversations/[id]`
- `DELETE /api/fund-conversations/[id]`
- `GET|POST|DELETE /api/fund-watchlist`

统一响应继续使用 `ApiResponse<T>`；基金 API 的错误码复用 `BAD_REQUEST`、`NOT_FOUND`、`UPSTREAM_ERROR`、`RATE_LIMITED` 等。

---

## 8. Agent 设计

### 8.1 基金工具

- `get_fund_profile`：读取基金档案与类型。
- `get_fund_nav`：读取指定区间历史净值。
- `get_fund_intraday`：读取场内实时行情或场外盘中估算，必须返回 `mode` 与数据时间。
- `get_fund_holdings`：读取最新季度持仓、行业/资产分布与集中度。
- `get_fund_metrics`：读取本地计算的回撤、修复与风险收益指标。
- `search_fund_news`：搜索基金公告、定期报告、经理变更与市场资讯。
- `get_fund_report`：读取历史基金分析报告。
- `save_fund_report`：持久化基金分析报告。

### 8.2 分析工作流

1. 规划：识别基金代码、类型与用户意图。
2. 取数：并行拉取基金档案、历史净值、实时/估算行情、持仓、指标与资讯。
3. 归纳：对基金资讯去重并判定 `sentiment`、`impact_days`、`news_type`。
4. 分析：分别完成基金概览、业绩与净值、持仓风格、风险解读、数据时效观察。
5. 教学：解释“为什么这样看”“下一步应观察什么”。
6. 风险：输出不确定性与免责声明，禁止确定性买卖建议。
7. 落库：保存基金报告与资讯快照。

### 8.3 对话工作流

- 以当前基金的最新档案、净值、实时/估算行情、持仓、风险指标与最近报告作为检索上下文。
- 会话写入 `fund_conversations` / `fund_messages`，不与股票会话混用。
- 护栏：必须区分“官方净值”和“盘中估算”；必须提示持仓披露滞后；禁止“必涨、必跌、现在买入/卖出”。

---

## 9. 关键算法

### 9.1 收益与风险

- 区间收益率：`r = nav_end / nav_start - 1`。
- 年化收益率：`annualized = (1 + r) ** (365 / max(days, 1)) - 1`。
- 日收益序列：`daily_return_i = nav_i / nav_{i-1} - 1`。
- 年化波动率：`std(daily_returns) * sqrt(252)`。
- 夏普比率：`(annualized_return - risk_free_rate) / annualized_volatility`，默认无风险利率 `0.02`（2%）。
- 索提诺比率：`(annualized_return - risk_free_rate) / downside_deviation`，下行偏差只统计负收益。
- 卡玛比率：`annualized_return / abs(max_drawdown)`。

### 9.2 最大回撤与修复

最大回撤：
1. 遍历净值序列，维护历史峰值 `peak`。
2. 对每个时点计算 `drawdown = nav / peak - 1`。
3. `max_drawdown = min(drawdown)`，并记录对应起止日期。

回撤修复：
- 对每个历史峰值，记录净值重新回到该峰值或创新高所需交易日数。
- `longest_recovery_days`：所有完整修复区间的最长天数。
- `average_recovery_days`：所有完整修复区间的平均天数。
- `current_recovery_progress_pct`：若当前仍处于回撤中，计算 `(nav_current - trough_since_peak) / (peak - trough_since_peak)`，限制在 `[0, 100]`。

口径：优先使用累计净值或复权净值计算长期指标；单位净值更适合观察分红后的价格变化，界面需标明当前口径。

### 9.3 场外盘中估算

- 理想模型：使用最新季度前十大持仓权重乘以对应资产当日涨跌幅，再加剩余仓位按业绩基准指数估算。
- 实际约束：完整持仓不可得，估算值必须标记 `estimate`，不得写入官方净值口径。
- 官方净值发布后，`fund-data.ts` 以 `official_nav` 覆盖展示；估算值仅作为盘中参考。

### 9.4 持仓集中度

- `top10_weight_pct = sum(top_holdings.weight_pct)`。
- `top1_weight_pct = max(top_holdings.weight_pct)`。
- 行业/资产分布由持仓数据聚合，缺失行业字段时展示为“未知”而非推断。

---

## 10. 缓存、限流与配额

- 缓存键统一使用 `fund:*` 前缀，与 `quote:*`、`kline:*` 隔离。
- TTL 分级：
  - 基金档案：24 小时。
  - 官方净值：按交易日更新，闭市后短 TTL，当天净值发布后缓存到下一交易日。
  - 场内实时行情：1–5 分钟。
  - 场外盘中估算：30–60 秒，且不跨交易日复用。
  - 季度持仓：12–24 小时。
  - 风险指标：1–24 小时，按区间缓存。
  - 基金资讯：按现有资讯 TTL 与 `expire_at` 管理。
- 回写：查询未命中时请求源并写缓存；失败不覆盖已有有效数据。
- 降级：侧车不可用时返回最近一次有效数据或确定性基金数据，并在 `source` 与界面提示中明确标注。
- 配额：复用现有 `observability.ts` 记录外部调用，Tavily/DeepSeek 配额用尽时降级。

---

## 11. 清理与快照

- `fund_news_items` 按 `expire_at` 定时软删除，长期公告/定期报告可标记保留。
- 历史净值与持仓为时间序列数据，不做默认删除；可归档到 R2 作为快照。
- 基金 AI 报告保存到 Postgres 与 R2，删除报告时保持软删除或可追溯。
- 基金风险指标可重新计算，缓存清理后不影响主流程。

---

## 12. 安全与密钥

- API Key（DeepSeek、Tavily、Postgres、R2）只写入本地 `.env`，仓库仅保留 `.env.example`。
- 基金 API 与个股 API 一样绑定 `127.0.0.1`，不暴露公网。
- 基金代码输入统一校验为 6 位数字，防止路径注入。
- AI 输出继续要求来源引用与风险提示，避免给出确定性建议。

---

## 13. 部署方案

- 本地开发：`next dev` 与现有 FastAPI 侧车并行运行；基金端点随同一侧车启动，不新增常驻服务。
- 可选容器化：现有 Docker Compose 只增加基金环境变量或保持不动。
- 云端化（可选）：基金工作台与个股工作台共用同一 Next.js 应用，部署形态一致。
- 无数据库或无外部密钥时，基金工作台使用内存 store 与确定性基金数据，保证首屏可运行。

---

## 14. 技术里程碑

- TF0 基金领域契约与工作台 Shell：新增 `funds.ts` 类型、工作台切换骨架与空基金面板。
- TF1 基金档案与净值：完成 Python 基金端点、TS 编排、缓存与净值曲线。
- TF2 实时/估算与持仓：完成场内行情、场外估算、季度持仓与持仓面板。
- TF3 指标计算：完成收益、波动、最大回撤、修复与风险收益指标。
- TF4 AI 分析与对话：完成基金 AI 工作流、工具调用、报告与基金会话。
- TF5 持久化与集成验收：完成基金表迁移、清理任务、降级提示与个股/基金无回归验证。

---

## 15. 风险与技术债

- 场外估算不准确：估算模型依赖滞后持仓，必须显著标注且不参与官方净值展示。
- AkShare 基金接口稳定性：通过基金确定性回退、失败重试与缓存降低影响。
- 持仓披露滞后：界面与 AI 报告固定展示报告期，禁止把季度持仓描述为当前持仓。
- 工作台状态串扰：基金路由、缓存键、store、会话全部使用 `fund_*` 前缀，代码评审重点检查。
- 个股/基金模块重复：分析、聊天、报告等存在相似逻辑，先允许重复实现，后续再抽取公共底座，避免过早抽象。
- 数据库迁移风险：基金表只做新增，不改现有个股表结构；迁移先本地验证再合并。
- QDII/FOF/REITs 字段不稳定：数据层以可空字段和降级提示处理，不阻断主流基金。
