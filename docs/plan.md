# 个股盘面分析网站 任务拆解文档

- 文档版本：v1.0
- 编制日期：2026-08-31
- 编制角色：项目经理
- 关联文档：`spec.md`、`design.md`
- 说明：本文档用于粗略划分阶段、任务与验收目标；工作量为人日估算，仅供参考，随实际进展调整。

---

## 1. 阶段总览

| 阶段 | 名称 | 目标 | 预估工作量 |
| --- | --- | --- | --- |
| P0 | 文档编写 | 明确范围、方案与任务 | 2–3 人日 |
| P1 | 工程初始化 | 搭好可运行的 TS + Python 骨架 | 3–5 人日 |
| P2 | MVP 盘面展示 | 查代码、看 K 线与指标 | 5–8 人日 |
| P3 | MVP AI 资讯与分析 | 自动抓资讯并生成教学式报告 | 5–8 人日 |
| P4 | MVP 对话助手 | 多轮追问与流式回答 | 5–8 人日 |
| P5 | MVP 持久化与清理 | 缓存复用、云端存储、定时清理 | 3–5 人日 |
| P6 | 打磨与整体验收 | 完善体验并交付可验收 MVP | 3–5 人日 |
| P7 | 后续迭代 | 已完成 M6-M8，其余候选待评估 | 另评估 |

合计约 26–42 人日；个人业余开发预计 4–8 周。

---

## 2. 各阶段任务

### P0 文档编写（已完成）
- 任务：需求分析、技术设计、任务拆解。
- 交付物：`spec.md`、`design.md`、`plan.md`。
- 验收：范围、数据可得性、技术选型、待定事项均已明确，评审通过。
- 依赖：无。
- 状态：已完成（2026-08-31）。
- 完成记录：`spec.md`、`design.md`、`plan.md` 及 `docs/checklists/` 已评审通过。

### P1 工程初始化
- 任务：
  - 建立 Git 分支规范，初始化仓库。
  - 创建 Next.js + TypeScript 前端/后端工程。
  - 创建 FastAPI + AkShare 行情数据侧车。
  - 配置 `.env`、`.gitignore`、`.env.example`，确保 API Key 不入库。
  - 接入云端存储（Supabase/Neon + Cloudflare R2）。
  - 编写本地开发脚本与健康检查。
- 交付物：可本地启动的工程骨架与环境配置说明。
- 验收：前端、后端、行情侧车均能启动并通过健康检查；密钥不入库；云端存储连通。
- 依赖：P0。
- 分支建议：`feature/scaffold`。
- 状态：已完成（2026-08-31），见 `docs/checklists/00-feature-scaffold.md`。

### P2 MVP 盘面展示
- 任务：
  - 股票代码输入、校验与市场识别。
  - 当前行情快照展示。
  - 分时/日/周/月 K 线展示。
  - 技术指标（MA/MACD/KDJ/RSI 等）本地计算。
  - 数据源异常时降级提示。
- 交付物：可用的盘面展示页面。
- 验收：至少 3 只不同市场股票查询正常，数据与公开行情一致，指标正确，界面无报错。
- 依赖：P1。
- 分支建议：`feature/quote-kline`。
- 状态：已完成（2026-09-01）；真实行情分支 `feature/real-market-data`，见 `docs/checklists/01-feature-quote-kline.md`、`data-service/checklist.md`。

### P3 MVP AI 资讯与分析
- 任务：
  - 封装 Tavily 搜索，按股票抓取相关资讯。
  - 资讯去重、利好/利空/中性分类、置信度与影响周期判定。
  - DeepSeek 分析工作流：数据面、消息面、情绪面、教学讲解、风险提示。
  - 报告落库与展示。
- 交付物：AI 分析报告功能。
- 验收：报告含来源、影响周期与风险提示；不输出“必然涨/必然跌”的确定性承诺。
- 依赖：P2（行情数据）与 P1。
- 分支建议：`feature/ai-analysis`。
- 状态：已完成（2026-09-01）；真实 LLM 分支 `feature/llm-analysis`，见 `docs/checklists/02-feature-ai-analysis.md`、`docs/checklists/06-feature-integration-next.md`。

### P4 MVP 对话助手
- 任务：
  - 类 ChatGPT 聊天界面。
  - 多轮上下文记忆与流式输出。
  - 工具调用：读行情、指标、资讯、历史报告。
  - 对话记录持久化到云端。
- 交付物：可用的对话式追问助手。
- 验收：连续 3 轮以上追问上下文正确，回答可追溯所引用数据。
- 依赖：P3。
- 分支建议：`feature/chat-assistant`。
- 状态：已完成（2026-09-01）；真实对话分支 `feature/llm-chat`，见 `docs/checklists/03-feature-chat-assistant.md`、`docs/checklists/06-feature-integration-next.md`。

### P5 MVP 持久化与清理
- 任务：
  - 行情/资讯/报告缓存复用与 TTL 分级。
  - 云端存储回写，控制本地磁盘占用。
  - node-cron 定时清理到期资讯，长期消息保留，软删除/归档。
- 交付物：缓存与清理机制。
- 验收：同代码第二次查询明显减少外部调用；本地磁盘占用可控；清理日志可查。
- 依赖：P3、P4 的数据写入。
- 分支建议：`feature/persistence-cleanup`。
- 状态：已完成（2026-09-01）；真实持久化与调度分支 `feature/scheduler-observability`，见 `docs/checklists/04-feature-persistence-cleanup.md`、`docs/checklists/06-feature-integration-next.md`。

### P6 打磨与整体验收
- 任务：
  - 历史分析与对话时间线回看。
  - 风险提示、免责声明、数据更新时间与新鲜度展示。
  - 可观测性（外部调用、失败率、复用命中）。
  - 整体测试验收与缺陷修复。
- 交付物：可交付的 MVP。
- 验收：满足需求文档 M1–M5 全部验收标准。
- 依赖：P2–P5。
- 分支建议：`feature/polish`。
- 状态：已完成（2026-09-02）；集成分支 `feature/integration-next`，M1–M5 全部通过，见根 `checklist.md`、`docs/checklists/06-feature-integration-next.md`。

### P7 后续迭代（部分完成）
- 状态：M6-M8 已完成并合并到 `main`（2026-09-03）；其余候选待评估。
- 已完成：
  - M6 自选股池与多股票切换：`feature/p7-watchlist`。
  - M7 历史复盘与命中率统计（仅学习）：`feature/p7-replay`。
  - M8 数据源健康与调度面板：`feature/p7-datasource-scheduler-dashboard`。
  - 公共底座与集成验收：`feature/p7-base`、`feature/p7-integration`。
  - 验收记录见根 `checklist.md`、`docs/checklists/07-feature-datasource-scheduler-dashboard.md`、`docs/checklists/08-feature-p7-integration.md`。
- 待评估：实时行情推送与预警、港股/美股与多语言资讯、情绪指标与策略回测（仅用于学习）。
- 开发编排、Agent 提示词与 worktree 命令见 `docs/next-phase-dev-plan.md`。

---

## 3. 里程碑与验收对照

| 里程碑 | 对应阶段 | 验收要点 |
| --- | --- | --- |
| M1 盘面展示 | P2 | 3 只不同市场股票查询正常，K 线与行情一致 |
| M2 AI 资讯与分析 | P3 | 报告含来源、影响周期、风险提示，不做确定性预测 |
| M3 对话式助手 | P4 | 3 轮以上追问上下文正确，回答可追溯数据 |
| M4 持久化与清理 | P5 | 第二次查询明显减少外部调用，到期资讯被清理 |
| M5 学习体验 | P6 | 历史回看可用，界面标注数据时间与免责声明 |
| M6 自选股与多股票 | P7 | 添加/删除/切换 3 只以上正常，刷新可恢复，切换后全链路股票一致 |
| M7 历史复盘与命中率 | P7 | 时间线可回看，统计口径清晰，仅学习用途且无收益承诺 |
| M8 数据源健康与调度 | P7 | 四类数据源状态与降级原因可见，手动刷新/清理日志可查 |

---

## 4. 质量与协作约定

- 每个功能开发前新建独立分支，完成后测试验收再合并。
- 代码注释使用中文，与用户交流使用中文。
- API Key 等敏感信息只写入本地 `.env`，不入库。
- 每个阶段结束以“验收要点”作为完成标准，避免功能堆叠而不可用。

---

## 5. 主要风险与依赖

- 数据源稳定性：AkShare 依赖非官方网页源，可能影响 P2/P3，需缓存与降级。
- LLM 与搜索成本/配额：需配额监控，超出时降级。
- 筹码分布准确性：首期为估算值，需明确标注。
- 跨语言维护：TS 主工程 + Python 行情侧车，需保持接口契约清晰。

---

## 6. 下一步

- P0–P6 / M1–M5 已完成并合并到 `main`；P7 的 M6-M8 已完成并合并到 `main`，工作区干净。
- 已完成：个股投资组合与策略回测学习台（2026-09-11，`feature/stock-portfolio-backtest`，见根 `checklist.md`、`docs/stock-portfolio-backtest-plan.md`）。
- 进行中/待开发：实时行情推送与站内预警（规划见 `docs/realtime-quote-push-plan.md`）。
- 后续候选：多市场/多语言、情绪指标与策略回测扩展，均需先做可行性分析。
- 开发编排、Agent 提示词与 worktree 命令见 `docs/next-phase-dev-plan.md`。
