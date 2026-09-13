# 个股盘面分析网站 技术设计文档

- 文档版本：v1.0
- 编制日期：2026-08-31
- 编制角色：资深项目经理/架构师
- 关联文档：`spec.md`
- 文档性质：技术方案与选型，已从需求文档中剥离

---

## 1. 设计目标

- 支撑“单机本地运行 + 云端存储”的个人学习工具。
- 在可接受预算内（首期免费或百元/月以内）覆盖需求文档的功能范围。
- 产品与 AI Agent 主体用 TypeScript 实现，保证前端、后端、Agent 的类型一致与流式体验。
- 行情数据源与 Agent 解耦，便于替换供应商。

---

## 2. 关键取舍（对需求文档的批判性决策）

| 需求内容 | 取舍决策 | 理由 |
| --- | --- | --- |
| “复现同花顺各类全面数据” | 不做 100% 复现，定义 MVP 数据清单 | 全面复现依赖 Level-2 与商业数据，个人成本极高，多数数据非刚需 |
| 筹码分布 | 首期用“换手率衰减”估算并标注，不采购 Level-2 | 公开源无直接字段，精确值需 5 万+/年，投入产出低 |
| 免费组合数据源（AkShare） | 起步采用，但独立成 Python 数据服务 | AkShare 零成本、覆盖广，但仅 Python 可用 |
| “Agent 更流行用 TS 写” | 产品与 Agent 主体用 TS，行情服务保留 Python | TS 在前端、Agent 工具链、流式与类型复用上更好；AkShare 是 Python，故保留薄侧车 |
| LLM 用 DeepSeek | 通过 OpenAI 兼容接口接入 | 生态兼容、成本低、已确定 |
| 单机无登录 | 不做 Auth，本地绑定 127.0.0.1 | 仅本人使用，避免过度设计 |
| 云端存储 | Supabase/Neon + Cloudflare R2 | 免费档基本够用，本地少占磁盘 |
| 定时清理 | 单机 node-cron 调度 | 单机无需分布式队列，够用即可 |

结论：采用“TypeScript 全栈 + Python 行情侧车”的混合语言方案，而不是为了统一语言强行用 TS 调 AkShare，也不是为了 AkShare 放弃 TS 的 Agent 生态。

---

## 3. 技术栈总览

- 语言：TypeScript（前端/后端/Agent）+ Python 3.12（行情数据服务）。
- 前端：Next.js（App Router）、React、TypeScript、Tailwind CSS、shadcn/ui、K 线图表库（klinecharts 或 lightweight-charts）、ECharts（指标/筹码）、Zustand（状态）。
- 后端与 Agent：Next.js Route Handlers 或 Hono；LangGraph.js 编排 + Vercel AI SDK（工具调用与流式输出）。
- LLM：DeepSeek（OpenAI 兼容接口）。
- 搜索：Tavily（TS SDK）。
- 行情数据服务：FastAPI + AkShare，提供标准化 JSON 接口。
- 数据库：Supabase Postgres（或 Neon）+ Drizzle ORM。
- 对象存储：Cloudflare R2（或 Supabase Storage），存资讯原文与历史快照。
- 缓存：Upstash Redis（可选），单机可先内存缓存。
- 调度：node-cron（清理任务、行情刷新）。
- 可观测：OpenTelemetry + Sentry（后期按需）。

---

## 4. 总体架构

组件分层：
- 展示层：Next.js 前端（盘面、报告、聊天）。
- 应用/Agent 层：TypeScript 服务，负责编排、分析、报告、对话、缓存策略。
- 行情数据层：Python FastAPI + AkShare，负责行情/财务/资金流的抓取与标准化。
- 情报层：Tavily 搜索，AI 做去重、分类、影响周期判定。
- 存储层：Postgres（结构化）+ R2（文件/快照）。
- 调度层：node-cron（定时刷新与清理）。
- 模型层：DeepSeek（分析、教学、对话、影响周期判定）。

数据流：
- 查询：前端 → TS 服务查缓存 → 命中直接返回；未命中调 Python 行情服务 → 回写并返回。
- 分析：TS Agent 编排 → 拉行情与资讯 → LLM 判定影响周期并生成报告 → 持久化 → 流式返回。
- 对话：前端 → TS 服务 → 检索当前股票数据/资讯/报告作为上下文 → DeepSeek 流式回答。

---

## 5. 模块设计

- web：Next.js 页面与组件。
- api：路由与业务接口。
- agent：LangGraph 工作流 + 工具定义 + 提示词 + 护栏。
- data-service：Python FastAPI + AkShare，提供 quote/kline/fundamental/moneyflow 接口。
- search：Tavily 封装。
- store：数据库访问（Drizzle）与对象存储封装。
- scheduler：node-cron 任务（清理、行情刷新、配额统计）。
- shared：类型与工具函数（供前端与后端复用）。

---

## 6. 数据模型

- stocks：code（PK）、name、exchange、industry、meta。
- market_quotes：code、ts、price、change_pct、open、high、low、prev_close、volume、amount、turnover_rate、pe、pb、market_cap、float_cap、source、fetched_at。
- klines：code、period、ts、open、high、low、close、volume、amount、adj_type。
- news_items：id、code、title、summary、url、source、published_at、fetched_at、sentiment、confidence、impact_days、expire_at、tags、status、pinned。
- analysis_reports：id、code、created_at、data_snapshot、news_refs、content、risk_note。
- conversations：id、code、title、created_at。
- messages：id、conversation_id、role、content、tool_calls、created_at。
- job_runs：id、job_name、status、started_at、finished_at、detail。

> 上表是 F0 阶段的设计基线。当前实现共 23 张表，完整列定义以 `src/lib/db/schema.ts` 为准，迁移文件位于 `drizzle/`。F0 之后新增的表（按能力分组）：
>
> - 自选与持仓：`watchlist`（自选股）、`stock_holdings`（个股持仓：投入金额 + 当前持仓收益）、`fund_watchlist`（自选基金）、`fund_positions`（持有基金：代码 + 当前持有金额 + 当前累计收益）。
> - 基金数据：`fund_profiles`、`fund_navs`、`fund_holdings`、`fund_risk_metrics`、`fund_news_items`。
> - 基金 AI：`fund_conversations`、`fund_messages`、`fund_analysis_reports`。
> - 预警与运维：`alert_rules`、`alert_events`、`observability_metrics`。

---

## 7. 接口设计

- `GET /api/stocks/:code`：股票元数据。
- `GET /api/stocks/:code/quote`：当前行情快照。
- `GET /api/stocks/:code/kline?period=day|week|month|minute&adjust=qfq`：K 线。
- `GET /api/stocks/:code/indicators`：技术指标（本地计算）。
- `GET /api/stocks/:code/news`：已抓取资讯。
- `POST /api/stocks/:code/analysis`：触发 AI 分析。
- `GET /api/stocks/:code/reports`：历史报告。
- `POST /api/chat`：SSE 流式对话。
- `GET /api/conversations/:id`：对话历史。
- `POST /api/admin/refresh`、`POST /api/admin/cleanup`：单机管理任务。

---

## 8. Agent 设计

工具：
- get_quote / get_kline / get_indicators：读行情与指标。
- search_news：搜索资讯并抓取摘要。
- get_report：读历史报告。
- save_report：持久化报告。

分析工作流（LangGraph）：
1. 规划：识别股票与用户意图。
2. 取数：并行拉行情 + 搜索资讯。
3. 分类：对每条资讯判利好/利空/中性、置信度、`impact_days`。
4. 分析：数据面、消息面、情绪面分别推理。
5. 教学：以职业投资者视角解释判断依据。
6. 风险：输出不确定性与免责声明，禁止确定性收益承诺。
7. 落库：保存报告与资讯。

对话工作流：
- 以当前股票的最新行情、未过期资讯、最近报告作为检索上下文。
- 多轮上下文取该会话的 messages；流式输出。
- 护栏：必须引用来源、禁止“必涨必跌”、回答附风险提示。

影响周期判定：
- LLM 输出 `impact_days` 并给出理由；异常值回退到默认（短期 7 天、长期 30 天）。
- 长期消息标记 `long_term`，清理任务不对其自动删除。

---

## 9. 关键算法

- 技术指标：MA、MACD、KDJ、RSI、BOLL 均基于 K 线在本地计算，不依赖数据源。
- 筹码估算：采用“换手率衰减”法，按历史成交量与换手率推算持仓成本分布；界面明确标注为估算。
- 消息去重：按 URL 或“标题+来源+发布时间”哈希去重。

---

## 10. 缓存、限流与配额

- TTL 分级：当前行情 1–5 分钟；分时短 TTL；日 K 按交易日更新；财务按披露周期；报告按资讯时效。
- 回写：查询未命中时请求源并写缓存；失败不覆盖已有有效数据。
- 去重与配额：对外部源做限流与失败退避，配额用尽时降级为缓存并提示更新时间。

---

## 11. 清理任务

- node-cron 每日扫描 `expire_at < now` 且非 pinned 的资讯，软删除。
- 长期消息默认不自动清理；用户可手动保留或调整。
- 关键资讯快照可归档至 R2，保留追溯能力。

---

## 12. 安全与密钥

- API Key（DeepSeek、Tavily、Supabase、R2）写入本地 `.env`，已在 `.gitignore` 忽略。
- 仓库仅提交 `.env.example` 模板。
- 单机服务绑定 `127.0.0.1`，不暴露公网；云端存储使用最小权限密钥。

---

## 13. 部署方案

- 本地开发：Next.js + Python FastAPI 侧车并行运行；云端数据库与 R2 通过环境变量连接。
- 可选容器化：Docker Compose（web、data-service、可选 redis）。
- 云端化（可选）：Next.js 可部署 Vercel/Fly，但单机个人使用优先本地。

---

## 14. 技术里程碑

- TM1：TS 前端骨架 + K 线/指标展示 + Python 行情侧车。
- TM2：Tavily 搜索 + DeepSeek 分析工作流 + 报告落库。
- TM3：对话助手（流式、上下文、工具调用）。
- TM4：云端存储 + 缓存复用 + node-cron 清理任务。
- TM5：风险提示、历史回看与可观测性打磨。

---

## 15. 风险与技术债

- Python 侧车带来跨语言维护成本：通过清晰 HTTP 契约隔离，后续可切 Tushare HTTP 去除 Python。
- AkShare 依赖非官方网页源，稳定性一般：加失败重试、缓存与降级。
- 报告/对话的时效性：以资讯 `expire_at` 与行情 `fetched_at` 控制上下文新鲜度。
- LLM 幻觉：强制引用来源与风险提示，关键结论要求给出依据。
- 云端存储迁移成本：使用 Drizzle + 对象存储抽象，降低锁定。