# 基金分析工作台 任务拆解文档

- 文档版本：v0.1
- 编制日期：2026-09-07
- 编制角色：项目负责人
- 关联文档：`docs/fund-workbench-spec.md`、`docs/fund-workbench-design.md`
- 说明：本文档用于粗略划分基金工作台开发阶段、任务与验收目标；工作量为人日估算，仅供参考，随实际进展调整。

---

## 1. 阶段总览

| 阶段 | 名称 | 目标 | 预估工作量 | 依赖 |
| --- | --- | --- | --- | --- |
| F0 | 基金契约与工作台 Shell | 冻结基金类型、表结构草案与工作台切换骨架 | 2–3 人日 | 无 |
| F1 | 基金档案与历史净值 | 查基金、看档案、历史净值曲线与区间业绩 | 4–6 人日 | F0 |
| F2 | 实时/估算与持仓 | 场内实时行情、场外盘中估算、季度持仓详情 | 4–6 人日 | F0 |
| F3 | 回撤与风险指标 | 本地计算最大回撤、修复与风险收益指标 | 2–4 人日 | F1 |
| F4 | 基金 AI 分析与对话 | AI 分析基金、多轮追问、报告与会话持久化 | 5–8 人日 | F1、F2、F3 |
| F5 | 持久化与集成验收 | 缓存复用、清理任务、降级提示、个股/基金无回归 | 3–5 人日 | F1–F4 |

合计约 20–32 人日；个人业余开发预计 4–7 周。

---

## 2. 各阶段任务

### F0 基金契约与工作台 Shell
- 任务：
  - 新增 `src/lib/shared/types/funds.ts`，冻结基金领域类型：`FundProfile`、`FundNavPoint`、`FundIntraday`、`FundHoldings`、`FundRiskMetrics` 等。
  - 从 `types/index.ts` 导出基金类型，不修改既有个股类型字段语义。
  - 将 `src/app/page.tsx` 收敛为页面 Shell，增加 `WorkbenchSwitcher`、`StockWorkbench` 容器与 `FundWorkbench` 空容器。
  - 新增基金 panel 空组件，确保工作台切换后页面可渲染。
  - 在 `data-service/app/` 预留基金路由模块与空端点，避免后续并行开发互相改文件。
- 交付物：可切换的个股/基金工作台骨架、基金共享类型、空面板。
- 验收：`corepack pnpm typecheck`、`lint`、`build` 通过；个股工作台行为无回归；工作台切换至少 3 次状态不丢失。
- 依赖：无。
- 分支建议：`feature/fund-base`。
- 状态：已完成（2026-09-07，分支 `feature/fund-base`）。

### F1 基金档案与历史净值
- 任务：
  - 实现基金代码校验、类型识别与默认基金解析（`fund-market.ts`）。
  - 在 FastAPI 侧车完成 `/fund/profile`、`/fund/nav`，并接入 AkShare 与基金确定性回退。
  - 实现 `fund-data.ts` 的缓存/Store/侧车/回退编排。
  - 新增 `GET /api/funds/[code]/profile` 与 `GET /api/funds/[code]/nav`。
  - 完成基金档案面板与历史净值曲线，支持区间、单位/累计净值切换。
- 交付物：可用的基金查询、档案展示与净值走势。
- 验收：至少 3 只不同类型基金查询正常；净值曲线可切换区间；数据带 `source`、`fetched_at`；无外部数据源时可确定性降级。
- 依赖：F0。
- 分支建议：`feature/fund-nav`。
- 状态：已完成（2026-09-07，分支 `feature/fund-nav`）。

### F2 实时/估算与持仓
- 任务：
  - 在 FastAPI 侧车完成 `/fund/intraday`、`/fund/holdings`，区分场内 `realtime` 与场外 `estimate`。
  - 实现 `fund-intraday.ts` 与 `fund-holdings.ts` 数据编排。
  - 新增 `GET /api/funds/[code]/intraday`、`GET /api/funds/[code]/holdings`。
  - 完成基金实时/估算面板与季度持仓面板。
  - 界面显著标注“估算值，非官方净值”和“持仓报告期，存在滞后”。
- 交付物：场内实时行情、场外盘中估算、最新季度持仓详情。
- 验收：至少覆盖 1 只场内 ETF、1 只场外基金；ETF 展示实时价，场外展示估算并显著标注；持仓展示报告期、前十大资产与占比。
- 依赖：F0。
- 分支建议：`feature/fund-intraday-holdings`。
- 状态：已完成（2026-09-07，分支 `feature/fund-intraday-holdings`）。

### F3 回撤与风险指标
- 任务：
  - 实现 `fund-metrics.ts`：区间收益、年化收益、年化波动、夏普、索提诺、卡玛。
  - 实现最大回撤、当前回撤、最长修复天数、平均修复天数与当前修复进度。
  - 新增 `GET /api/funds/[code]/metrics`。
  - 完成基金风险面板，并在净值曲线中叠加回撤区域。
- 交付物：可用的基金风险指标与回撤修复视图。
- 验收：对样本基金验算最大回撤、当前回撤与最长修复天数，结果与历史净值计算一致；指标定义可悬浮查看。
- 依赖：F1。
- 分支建议：`feature/fund-metrics`。
- 状态：已完成（2026-09-07，分支 `feature/fund-metrics`）。

### F4 基金 AI 分析与对话
- 任务：
  - 实现 `fund-analysis.ts`：拉取基金档案、净值、实时/估算行情、持仓、指标与资讯，生成基金 AI 报告。
  - 新增基金分析工具：`get_fund_profile`、`get_fund_nav`、`get_fund_intraday`、`get_fund_holdings`、`get_fund_metrics`、`search_fund_news`、`get_fund_report`、`save_fund_report`。
  - 新增 `/api/funds/[code]/analysis`、`/analysis/stream`、`/analysis/stop`、`/reports`。
  - 实现 `fund-chat.ts` 与 `/api/fund-chat`，会话与报告写入 `fund_conversations`、`fund_messages`、`fund_analysis_reports`。
  - 完成基金 AI 报告面板与基金对话面板，复用现有 SSE 流式 UI 模式。
- 交付物：基金 AI 分析、报告落库、多轮基金对话。
- 验收：AI 报告包含基金概览、持仓风格、风险解读、数据来源与风险提示，且无确定性买卖建议；连续 3 轮以上追问上下文正确。
- 依赖：F1、F2、F3。
- 分支建议：`feature/fund-ai`。
- 状态：已完成（2026-09-08，分支 `feature/fund-ai`）。

### F5 持久化与集成验收
- 任务：
  - 完成基金 Drizzle 表与迁移，扩展内存/文件降级 store。
  - 基金资讯 `expire_at` 清理、长期公告保留、R2 报告与持仓/净值快照。
  - 数据源健康面板纳入基金数据源状态。
  - 自选基金与历史复盘按 P1 范围决定是否纳入首期；若纳入，补充对应验收。
  - 整体验证 MF1–MF6，确认个股工作台 M1–M8 无回归。
- 交付物：可交付的基金工作台增量。
- 验收：同基金代码第二次查询明显减少外部调用；界面明确标注净值日期、持仓报告期、估算/降级状态与免责声明；`typecheck`、`lint`、`build` 通过。
- 依赖：F1–F4。
- 分支建议：`feature/fund-integration`。
- 状态：已完成（2026-09-08，分支 `feature/fund-integration`）。

---

## 3. 里程碑与验收对照

| 里程碑 | 对应阶段 | 验收要点 |
| --- | --- | --- |
| MF1 工作台切换与基金查询骨架 | F0 | 两个工作台来回切换 3 次以上状态不丢失；3 只以上不同类型基金可识别 |
| MF2 净值与当日涨跌 | F1、F2 | 场内 ETF、场外基金净值曲线正确；实时/估算展示正确且标注清晰 |
| MF3 持仓与风险指标 | F2、F3 | 持仓报告期可见，前十大资产正确；回撤与修复指标可验算 |
| MF4 AI 分析与对话助手 | F4 | 报告含来源、持仓、风险与免责声明；连续 3 轮追问上下文正确 |
| MF5 持久化与历史回看 | F5 | 第二次查询减少外部调用；数据时间、估算/降级与免责声明完整展示 |
| MF6 集成验收 | F5 | 个股工作台 M1–M8 无回归；基金 MF1–MF5 通过；typecheck/lint/build 通过 |

---

## 4. 开发编排与 Worktree 命令

### 第 0 波：串行，基金公共底座

```powershell
git checkout main
git pull
git worktree add ../stock-analysis-fund-base -b feature/fund-base
Set-Location ../stock-analysis-fund-base
corepack pnpm install
```

F0 验收并合并回 `main` 后，再创建 F1/F2 两个并行 worktree：

```powershell
git checkout main
git pull
git worktree add ../stock-analysis-fund-nav -b feature/fund-nav
git worktree add ../stock-analysis-fund-intraday -b feature/fund-intraday-holdings
```

### 第 1 波：并行，净值与行情/持仓

- `feature/fund-nav`：只改基金 profile/nav 数据与净值面板。
- `feature/fund-intraday-holdings`：只改基金 intraday/holdings 数据与对应面板。
- 两者不修改 F0 已冻结的共享类型和 `page.tsx` Shell，避免冲突。

### 第 2 波：串行，指标与 AI

```powershell
git checkout main
git pull
git worktree add ../stock-analysis-fund-metrics -b feature/fund-metrics
```

F3 验收后：

```powershell
git checkout main
git pull
git worktree add ../stock-analysis-fund-ai -b feature/fund-ai
```

### 第 3 波：串行，集成验收

```powershell
git checkout main
git pull
git worktree add ../stock-analysis-fund-integration -b feature/fund-integration
```

---

## 5. 质量与协作约定

- 每个功能开发前新建独立分支，完成后自测、验收再合并。
- 基金共享类型只在 `feature/fund-base` 冻结；后续如需扩展，先在各自模块标注 TODO，由集成阶段统一收口。
- 个股工作台代码与共享类型保持向后兼容，不破坏 `docs/design.md` 中已冻结契约。
- 基金路由、缓存键、store、会话均使用 `fund_*` 前缀或独立表，避免与个股上下文串扰。
- 代码注释与提交信息使用中文；API Key 只写本地 `.env`，仓库仅保留 `.env.example`。
- 每个阶段结束以“验收要点”为完成标准，避免功能堆叠而不可用。

---

## 6. 主要风险与依赖

- AkShare 基金接口稳定性：需在 F1/F2 先做数据可得性验证，无法获取时立即启用确定性回退。
- 场外盘中估算准确性：F2 必须将估算与官方净值分离展示，避免误导。
- 持仓披露滞后：F2/F4 均需固定展示报告期，AI 提示词中不得把季度持仓描述为当前持仓。
- 并行分支冲突：F1/F2 只修改各自模块与 F0 预留文件，不修改共享类型和页面 Shell。
- 数据库迁移：F5 只做新增表，不改现有个股表；迁移先本地验证再合并。
- QDII/FOF/REITs 字段不稳定：F1/F2 以可空字段和降级提示处理，不阻塞主流基金。

---

## 7. 下一步

- F0–F5 已验收，当前基金工作台已具备档案、净值、实时/估算、持仓、回撤/风险指标、AI 分析与持久化能力。
- 基金工作台 P1 能力已全部完成；P2 已先后落地基金对比（F9）与基金组合分析（F10），后续可继续扩展定期报告/异动提醒与定投回测。
