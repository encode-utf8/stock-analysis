# Agent 执行轨迹可视化与步骤耗时（agent-trace）方案

- 分支：`feature/agent-trace`
- 关联验收：`docs/checklists/09-feature-agent-trace.md`、`checklist.md` 中「Agent 执行轨迹可视化与步骤耗时（2026-09-20，待验收）」章节
- 状态：方案待确认（确认后再开工，确认前不改业务代码）

## 1. 需求改写（原始描述 → 规范化功能需求）

### 1.1 原始描述

> 1、针对系统内所有有关 agent 调用工具的功能，对其执行轨迹进行可视化处理，仿照 codex 和 claude 等成熟代码 agent 相似的功能呈现。
> 2、对每一步思考或者执行耗时进行展示。所有步骤操作结束之后自动去除轨迹痕迹，仅保留最终输出的结果（即未开发该功能时的结果呈现）。
> 3、将功能描述改写得更加专业和规范，并对其进行开发规划。

### 1.2 规范化改写

**功能名称**：Agent 执行轨迹可视化与步骤耗时观测（Agent Execution Trace & Step Timing）

**问题陈述**：系统内 AI 能力由「编排层 + 大模型 + 本地工具 / 数据源」构成，但执行过程对用户完全不可见。对话提交后只有「回复中…」与逐字正文，用户无法判断模型是在规划、在读取行情，还是在检索资讯；单次回答动辄数十秒，用户分不清「卡住」与「正在工作」；失败时只有一句错误文案，缺少可定位的上下文。

**功能需求**：

- **R1 执行轨迹可视化**：对系统中所有由 Agent 编排（多步骤调用本地工具 / 数据源，或分阶段调用大模型）的功能，在运行期实时呈现本次执行的步骤轨迹。呈现形态对齐 Codex、Claude Code 等成熟代码 Agent 的通用范式：按时间顺序的步骤流，每步包含类型标识、中文可读名称、关键参数或结果摘要、状态（进行中 / 成功 / 失败 / 跳过）；轨迹面板可手动折叠与展开。
- **R2 步骤耗时与整体耗时**：每个步骤展示自身耗时；面板头部展示步骤数与累计耗时；对模型调用额外展示首字时延（TTFT），用于区分「模型慢」与「工具慢」。
- **R3 轨迹即时性与自动清理**：轨迹是运行期临时产物。单次执行结束后，轨迹自动收起并清理，界面回到「未引入本功能时」的最终结果呈现（正文、来源、风险提示、既有工具调用摘要块、AI 调用标记）；用户主动中断时不残留半成品轨迹；轨迹不落库、不可回放，历史会话与历史报告结构保持不变。

**范围约束（明确不做）**：

- 不展示大模型原始思维链（chain-of-thought）与原始提示词。本功能展示的是编排层「可观测的思考阶段」（第几轮规划、模型调用、首字时延），不涉及模型私有推理内容，也不外泄内部上下文。
- 不改变任何业务结果：正文、报告、来源、风险提示与合规校验逻辑一律不变。
- 不新增持久化表、不写业务日志文件；轨迹只存在于 SSE 生命周期与前端运行期状态中。
- 既有「工具调用」摘要块、来源列表、风险提示、`aiInvoked` 标记属于「未开发该功能时的结果呈现」，保持原样不动。

## 2. 现状勘察

### 2.1 可复用的既有基础

- 事件契约：`src/lib/shared/types/next-phase.ts` 已冻结 `ChatStreamEvent`（`meta | delta | tool | done | error`）与 `AnalysisStreamEvent`；`src/lib/shared/types/funds.ts` 已冻结 `FundAnalysisStreamEvent`。
- SSE 通道：`/api/chat`、`/api/fund-chat`、`/api/stocks/[code]/analysis/stream`、`/api/funds/[code]/analysis/stream` 四条路由已是流式 SSE。
- 工具执行已有结构化记录：`src/lib/chat.ts` 的 `executeTool()` 返回 `ToolExecution`（name / arguments / summary / resultText / sources），并已落为 `messages.tool_calls`。
- 观测底座：`src/lib/observability.ts` 的 `recordTaskRun()` 已在四条链路上计数。
- 前端已具备 SSE 分块解析与消息态更新（`StockWorkbench.tsx`、`FundWorkbench.tsx`）。

### 2.2 覆盖对象（Agent 编排链路清单）

| 编号 | 功能 | 编排入口 | 编排形态 | 轨迹内容 | 优先级 |
| --- | --- | --- | --- | --- | --- |
| T1 | 个股对话助手 | `src/lib/chat.ts` → `streamChat()`（`/api/chat`） | function calling，6 个工具，最多 4 轮 | 每轮：规划思考 → 工具调用（入参 / 摘要 / 耗时）→ 结果回流 | P0 |
| T2 | 个股 AI 分析 | `src/lib/analysis.ts` → `streamAnalysis()` | 数据装配 → 模型流式 → 合规与事实校验 → 落库 | 阶段轨迹 + TTFT | P1 |
| T3 | 基金 AI 分析 | `src/lib/fund-analysis.ts` → `streamFundAnalysis()` | 数据装配 → 模型流式 → 合规与事实校验 → 落库 | 阶段轨迹 + TTFT | P1 |
| T4 | 基金对话助手 | `src/lib/fund-chat.ts` → `streamFundChat()` | 上下文并行装配 → 模型流式 | 装配步骤 + 模型步骤 | P1 |
| T5 | 每日复盘日报 | `src/lib/daily-report.ts` → `runDailyReportJob()` / `buildDailyReport()` | 采集 → 模型或模板 → 落库（当前无 SSE 通道） | 需新增进度通道 | P2（本期不做） |

**不纳入范围**：`data-consistency.ts` 数据一致性巡检、`scheduler.ts` 调度器、`datasource-health.ts` 数据源健康探测、`alert-scan.ts` 预警扫描——均为确定性批处理，不含大模型编排，不接入轨迹体系。

### 2.3 现状差距

1. 轨迹只有终态摘要：`tool` 事件一次性推送 `toolCalls` 数组，既无步骤开始时刻，也无每步耗时。
2. 无时间维度：全链路没有任何耗时字段，用户无法判断长耗时发生在模型还是工具。
3. 无运行期可视化：`ChatPanel` 仅在结束后渲染「工具调用」列表；`AnalysisPanel`、`FundAnalysisPanel` 只有「生成中…」文案。
4. 无自清理语义：轨迹一旦进入视图就没有生命周期概念，也没有「结束后回到原有呈现」的约束。

## 3. 关键设计

### 3.1 轨迹数据契约（新增 `src/lib/shared/types/agent-trace.ts`）

```ts
/** 轨迹步骤类型：供前端选择图标与配色。 */
export type AgentTraceStepKind = thinking | tool | data | model | guard | persist;

/** 步骤与整轮状态。 */
export type AgentTraceStatus = running | success | failed | skipped | aborted;

/** 轨迹作用域：标明这是哪个功能的执行。 */
export type AgentTraceScope = stock-chat | stock-analysis | fund-chat | fund-analysis;

/** 单步轨迹。 */
export interface AgentTraceStep {
  id: string;
  index: number;              // 从 1 开始，展示顺序
  kind: AgentTraceStepKind;
  label: string;              // 中文可读名，例如「读取行情快照」
  detail?: string;            // 参数或结果摘要（截断 ≤180 字，不含密钥与原始提示词）
  status: AgentTraceStatus;
  round?: number;             // 工具循环轮次，非多轮链路为空
  started_at: string;         // ISO，服务端时钟
  finished_at?: string;
  duration_ms?: number;       // 结束时回填
  ttft_ms?: number;           // 仅模型步骤：首字时延
  error?: string;             // 失败摘要（截断 ≤180 字）
}

/** 单次执行的完整轨迹快照。 */
export interface AgentTraceRun {
  run_id: string;
  scope: AgentTraceScope;
  target: string;             // 股票 / 基金代码
  status: AgentTraceStatus;
  started_at: string;
  finished_at?: string;
  duration_ms?: number;
  steps: AgentTraceStep[];
}
```

### 3.2 SSE 协议扩展（只增不改，保持向后兼容）

在既有事件类型联合上**新增一个字面量** `trace`，并在事件 `data` 上**新增可选字段** `trace?: AgentTraceRun`：

- `ChatStreamEventType`（`next-phase.ts`）、`AnalysisStreamEventType`（`next-phase.ts`）、`FundAnalysisStreamEventType`（`funds.ts`）各增加 `trace`；
- 推送语义：**全量快照**。每次推送都携带完整 `AgentTraceRun`，前端以覆盖方式应用，天然幂等，无需增量合并状态机，也不怕丢包与乱序；
- `done` / `error` 事件结构不变，且**不携带轨迹**——前端收到 `done` / `error` 后按 §3.5 策略清理轨迹；
- 既有 `meta` / `delta` / `tool` 事件语义、字段、顺序一律不变，旧消费端遇到未知 `type` 直接忽略。

### 3.3 服务端记录器（新增 `src/lib/agent-trace.ts`）

```ts
export interface TraceStepHandle {
  finish(patch?: { status?: AgentTraceStatus; detail?: string; error?: string }): AgentTraceStep;
}

export interface TraceRunRecorder {
  readonly runId: string;
  startStep(input: { kind: AgentTraceStepKind; label: string; detail?: string; round?: number }): TraceStepHandle;
  /** 包装一次异步操作：自动计时、自动回填成功 / 失败与错误摘要。 */
  measure<T>(input, task: () => Promise<T>): Promise<T>;
  /** 结束整轮并回填总耗时。 */
  finish(status?: AgentTraceStatus): AgentTraceRun;
  /** 当前完整快照，用于 yield `{ type: trace, data: { trace } }`。 */
  snapshot(): AgentTraceRun;
}

export function createTraceRun(scope: AgentTraceScope, target: string, now?: () => number): TraceRunRecorder;

/** 步骤上限与摘要截断，防止异常循环产生噪声。 */
export const TRACE_LIMITS = { maxSteps: 24, detailMaxLength: 180 } as const;
```

设计要点：

- 纯内存、零外部依赖，`now()` 可注入，便于单测获得确定性耗时；
- 并发步骤（`Promise.all`）各自独立计时，互不干扰；
- 超过 `maxSteps` 后不再追加新步骤，并在快照上标记截断，避免异常循环刷屏；
- 不落库、不写文件，仅在 SSE 生命周期内存在（R3）。

### 3.4 服务端埋点（落到函数）

**T1 个股对话 `src/lib/chat.ts`**

- `streamChat()`：创建 run → 每轮插入一条 `thinking` 步骤（界面标签 `Thinking`，摘要「第 N 轮：理解问题并规划工具调用」），在收到首个 delta 或首个 tool_call 时结束（该步 `ttft_ms` 即真实首字时延）→ 每个工具一条 `tool` 步骤，由 `executeTool()` 记录入参摘要、结果摘要、来源与耗时 → 每步收尾立即 yield 一次快照。
- 工具中文名映射：`get_quote` → 「读取行情快照」、`get_kline` → 「读取 K 线数据」、`get_indicators` → 「计算技术指标」、`search_news` → 「检索相关资讯」、`get_report` → 「读取历史报告」、`save_report` → 「生成并保存分析报告」。
- `executeTool()` 增加**可选** `trace` 参数，保持既有调用点与返回结构不变。
- `buildFallbackReply()` 兜底链路的每个工具同样计入轨迹，模型步骤标记「未调用 AI（本地兜底）」。

**T2 个股 AI 分析 `src/lib/analysis.ts:streamAnalysis()`**

`data`「装配行情 / K 线 / 技术指标数据」→ `thinking`「生成分析报告（模型流式输出，含首字时延）」→ `guard`「合规与事实性校验」→ `persist`「保存分析报告」，每步后 yield 快照。

**T3 基金 AI 分析 `src/lib/fund-analysis.ts:streamFundAnalysis()`**

`data`「装配基金档案 / 净值 / 行情 / 持仓 / 风险指标」→ `thinking` → `guard` → `persist`，同上。

**T4 基金对话 `src/lib/fund-chat.ts:streamFundChat()`**

`data`「装配基金上下文（档案 / 盘中 / 持仓 / 指标）」→ `thinking`「生成回答」，兜底路径标记「本地摘要」。

**T5 日报生成**：本期不做，理由与二期备选方案见 §7。

### 3.5 前端呈现与自动清理

**新增 `src/lib/agent-trace-client.ts`（纯函数状态机，可单测）**

- `applyTraceSnapshot(state, run)`：以快照覆盖本地状态（幂等）；
- `reduceTraceLifecycle(state, event)`：按 `meta → trace* → done | error | abort` 推进生命周期；
- 生命周期：`idle` → `live`（收到首个 `trace`）→ `lingering`（收到 `done` / `error`，折叠为单行摘要）→ `cleared`（800ms 后从视图移除，仅保留最终结果）；
- 中断（用户点「停止回复」）：直接 `live` → `cleared`，不渲染半成品轨迹；
- 策略 `AgentTracePolicy = ephemeral | keep-collapsed`：默认 `ephemeral`（严格对齐 R3），用户可在设置项切换到 `keep-collapsed`（结束后折叠为单行摘要保留，可再展开）；选择持久化在 `localStorage`（键 `sa.agent-trace.policy`），与 `ui-background-client.ts`、`realtime-quote-client.ts` 的既有前端偏好模式一致。

**新增 `src/components/panels/AgentTraceSettingsEntry.tsx`**：顶部设置栏入口（与「背景与光效」「数据一致性清理」并列），下拉内提供两项单选项——「结束后清除（默认）」与「结束后折叠保留」——切换即时生效并持久化。

**新增 `src/components/panels/AgentTracePanel.tsx`**

- 折叠头：状态圆点（进行中脉冲 / 成功 / 失败 / 已中断）+「执行轨迹」+ 步骤计数 + 累计耗时（进行中按 100ms 刷新，`prefers-reduced-motion` 下停止脉冲与滚动动效）；
- 步骤行：类型图标 + 中文名 + 摘要 + 右侧耗时（`328ms` / `1.4s`）；模型步骤额外展示首字时延；失败步骤展开错误摘要；
- 样式沿用现有科技风语义（半透明面板 + 语义色），新增规则集中在 `src/app/globals.css`。

**挂载点**

- `ChatPanel.tsx`：`ChatViewMessage` 新增 `trace?: AgentTraceRun`，运行期在气泡正文上方渲染轨迹面板；
- `StockWorkbench.tsx` / `FundWorkbench.tsx`：SSE 分发新增 `trace` 分支，`done` / `error` / `AbortError` 时触发清理；
- `AnalysisPanel.tsx` / `fund/FundAnalysisPanel.tsx`：生成期在报告占位区渲染轨迹面板，结束后自动清理；
- 历史会话 / 历史报告回看：消息模型不新增轨迹字段，因此不渲染轨迹（R3）。

## 4. 影响范围

| 文件 | 动作 | 说明 |
| --- | --- | --- |
| `src/lib/shared/types/agent-trace.ts` | 新增 | 轨迹数据契约 |
| `src/lib/shared/types/next-phase.ts` | 修改（只增） | `ChatStreamEventType`、`AnalysisStreamEventType` 各增加 `trace`；`data` 增加可选 `trace` |
| `src/lib/shared/types/funds.ts` | 修改（只增） | `FundAnalysisStreamEventType` 增加 `trace`；`data` 增加可选 `trace` |
| `src/lib/agent-trace.ts` | 新增 | 服务端轨迹记录器（计时、快照、上限与截断） |
| `src/lib/agent-trace-client.ts` | 新增 | 前端轨迹状态机与自清理策略 |
| `src/lib/chat.ts` | 修改 | T1 埋点：每轮 `think` + 每个工具 `tool`；`executeTool()` 增加可选 `trace` 参数 |
| `src/lib/analysis.ts` | 修改 | T2 埋点：`data` / `think` / `guard` / `persist` |
| `src/lib/fund-analysis.ts` | 修改 | T3 埋点：同上 |
| `src/lib/fund-chat.ts` | 修改 | T4 埋点：`data` / `think` |
| `src/app/api/chat/route.ts`、`src/app/api/fund-chat/route.ts`、`src/app/api/stocks/[code]/analysis/stream/route.ts`、`src/app/api/funds/[code]/analysis/stream/route.ts` | 修改 | 透传 `trace` 事件；错误分支补发收尾快照 |
| `src/components/panels/AgentTracePanel.tsx` | 新增 | 轨迹面板（折叠头 + 步骤流 + 耗时） |
| `src/components/panels/AgentTraceSettingsEntry.tsx` | 新增 | 顶部设置栏入口：清除 / 折叠保留策略切换 |
| `src/app/page.tsx` | 修改 | 顶部设置栏挂载轨迹设置入口 |
| `src/components/panels/ChatPanel.tsx` | 修改 | 消息气泡内渲染运行期轨迹 |
| `src/components/panels/AnalysisPanel.tsx`、`src/components/panels/fund/FundAnalysisPanel.tsx` | 修改 | 生成期渲染阶段轨迹 |
| `src/components/workbench/StockWorkbench.tsx`、`src/components/workbench/FundWorkbench.tsx` | 修改 | SSE `trace` 分支 + 结束 / 中断清理 |
| `src/app/globals.css` | 修改 | 轨迹面板样式与动效降级 |
| `tests/agent-trace.test.ts`、`tests/agent-trace-client.test.ts`、`tests/e2e/agent-trace.spec.ts` | 新增 | 记录器、状态机、端到端用例 |
| `README.md`、`docs/agent-trace-plan.md`、`docs/checklists/09-feature-agent-trace.md`、`checklist.md` | 修改 | 文档与验收记录 |

**不改动**：数据库结构与迁移、`messages.tool_calls` 结构、报告结构、合规校验逻辑、`recordTaskRun()` 既有计数语义。

## 5. 实施步骤（分阶段，每阶段自测）

### P0 契约与记录器（串行前置）

1. 新增 `src/lib/shared/types/agent-trace.ts`，并在三个事件类型上做只增扩展（补充类型注释，注明「只增不改」）。
2. 新增 `src/lib/agent-trace.ts`：`createTraceRun()`、`startStep()`、`measure()`、`snapshot()`、`finish()`，含 `now()` 注入、`maxSteps` 上限与 `detail` 截断。
3. 新增 `tests/agent-trace.test.ts`：计时、状态流转、并发步骤、失败与异常回填、超限截断、快照不可变性。
4. 自测：`corepack pnpm typecheck`、`corepack pnpm test`。

### P1 个股对话轨迹打通（P0 里程碑，端到端可用）

5. `src/lib/chat.ts` 埋点（`think` / `tool` / 兜底标记），`executeTool()` 加可选 `trace` 参数。
6. `/api/chat` 路由透传 `trace` 事件。
7. 新增 `src/lib/agent-trace-client.ts`（快照覆盖 + 生命周期 + 自清理）。
8. 新增 `src/components/panels/AgentTracePanel.tsx`，接入 `ChatPanel.tsx` 与 `StockWorkbench.tsx`。
9. 新增 `tests/agent-trace-client.test.ts`：幂等覆盖、乱序与重复事件、`done` 后清理、中断清理。
10. 自测：`typecheck`、`lint`、`test`，并手工验证有密钥 / 无密钥两条路径。

### P2 分析与基金链路

11. `analysis.ts`、`fund-analysis.ts`、`fund-chat.ts` 埋点。
12. 三个 SSE 路由透传；`AnalysisPanel.tsx`、`FundAnalysisPanel.tsx`、`FundWorkbench.tsx` 接入。
13. 自测：`typecheck`、`lint`、`test`，手工验证「生成分析 → 轨迹 → 自动清理 → 仅剩报告」。

### P3 收尾与验收

14. 样式与无障碍：`prefers-reduced-motion` 降级、键盘可达的折叠开关、对比度达标。
15. 边界：停止回复、SSE 中断、模型报错、兜底路径、超长步骤链（>24 步）。
16. 新增 `tests/e2e/agent-trace.spec.ts`。
17. 回归：`typecheck` / `lint` / `test` / `build` / `test:e2e`。
18. 文档：README 能力说明、方案文档实测结果、验收清单勾选。

## 6. 测试与验收方式

### 6.1 单元测试（vitest，无外部依赖）

- `tests/agent-trace.test.ts`：注入固定时钟，断言每步 `duration_ms`、整轮总耗时、并发步骤互不串扰、失败步骤 `status=failed` 且带 `error`、超 24 步被截断、`detail` 截断至 180 字、快照为深拷贝（外部修改不影响内部状态）。
- `tests/agent-trace-client.test.ts`：快照覆盖幂等、事件重复 / 乱序不产生重复步骤、`done` 后进入 `lingering` 且在 800ms 后 `cleared`、`AbortError` 直接 `cleared`、`keep-collapsed` 策略保留折叠态。

### 6.2 端到端（Playwright）

`tests/e2e/agent-trace.spec.ts`：**关键可测性**在于——即使未配置 `DEEPSEEK_API_KEY`，`streamChat()` 也会走 `buildFallbackReply()` 的工具链，轨迹照常产生。因此用例可在无密钥环境稳定断言：

1. 发送一条消息后，轨迹面板出现且步骤数 ≥ 1；
2. 结束后轨迹面板消失，页面只保留正文、来源、风险提示与既有「工具调用」摘要块；
3. 点击「停止回复」后不残留轨迹节点。

### 6.3 手工验收

- 有密钥：观察多轮工具循环（≥2 轮）的步骤顺序与耗时、模型步骤首字时延；确认结束后轨迹自动清除。
- 无密钥：确认兜底链路轨迹标注「未调用 AI（本地兜底）」。
- 回归：个股 / 基金的行情、K 线、指标、资讯、分析、对话、历史回看功能表现与改造前一致。

### 6.4 验证命令

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
corepack pnpm test:e2e
```

## 7. 风险、取舍与备选方案

| # | 风险 / 取舍 | 说明 | 应对 |
| --- | --- | --- | --- |
| 1 | 「思考」的可观测边界 | 大模型不返回思维链；展示原始提示词会外泄内部上下文 | 只展示编排层可观测阶段（轮次规划、模型调用、首字时延），标签统一为「规划 / 生成」，不出现原始提示词与推理原文 |
| 2 | 冻结契约扩展 | `next-phase.ts` 约定「只新增，不改变既有字段语义」 | 仅新增字面量与可选字段，不改既有事件字段与顺序；旧消费端忽略未知 `type` |
| 3 | SSE 流量 | 每步推送全量快照 | 步骤上限 24、`detail` 截断 180 字，单次运行净增预计 < 8 KB |
| 4 | 耗时口径 | 并发工具各自计时，总耗时不等于分步之和 | 前端分别展示「每步耗时」与「整轮总耗时」，不做求和误导；统一服务端时钟 |
| 5 | 历史 `tool_calls` 落库 | 既有结构会在历史回看时显示工具摘要 | 视为「未开发本功能时的结果呈现」，本期保持不动；若后续要求历史也不留痕，另开分支评估 |
| 6 | T5 日报生成不在本期 | 无 SSE 通道，需新增进度接口与前端消费 | 二期备选：把 `runDailyReportJob()` 接入同一记录器，新增 `/api/admin/daily-reports/progress`（SSE 或轮询）后复用同一面板 |
| 7 | 轨迹不落库 | 与 R3 一致，但缺少事后排查证据 | 保留既有 `recordTaskRun()` 计数；如需留痕，二期增加默认关闭的调试开关 |
| 8 | 无密钥兜底路径 | 无 TTFT 语义 | 兜底步骤标注「未调用 AI（本地兜底）」，不展示首字时延 |

## 8. 决策记录（2026-09-20 已确认）

1. **自清理严格度 = C**：默认 `ephemeral`（结束后完全移除，严格对齐 R3），并提供设置项可切换到 `keep-collapsed`（结束后折叠为单行摘要保留、可再展开）。
2. **覆盖范围**：本期不包含 T5 日报生成，作为二期评估。
3. **分支基线**：从 `main` 新建 `feature/agent-trace`（当前工作分支）。
4. **步骤命名 = thinking**：思考步骤统一使用 `thinking` 标识，界面标签 `Thinking`，摘要文案保持中文，避免与模型私有思维链混淆。

## 9. 实测记录（2026-09-20，`feature/agent-trace`）

### 9.1 服务端链路（配置真实密钥，本地 `pnpm dev`）

| 链路 | 轨迹帧 | 实测步骤与耗时 | 整轮 |
| --- | --- | --- | --- |
| T1 个股对话（600519） | 6 | 第 1 轮 Thinking 1.34s（首字 878ms，决定调用 3 个工具）→ 读取行情快照 11ms → 读取 K 线数据 8ms → 计算技术指标 10ms → 第 2 轮 Thinking 4.94s（首字 618ms，直接生成回答） | 6.32s |
| T2 个股分析（600519） | 4 | 装配行情与指标 1.26s → Thinking 12.27s（首字 990ms）→ 合规与事实性校验 1ms → 保存分析报告 3.02s | 16.55s |
| T3 基金分析（000001） | 4 | 装配基金数据 27.25s → Thinking 9.50s（首字 775ms）→ 合规与事实性校验 1ms → 保存分析报告 7.53s | 44.28s |
| T4 基金对话（000001） | 4 | 装配基金上下文 13ms → Thinking 3.23s（首字 598ms） | 3.24s |

- T3 的装配耗时包含确定性降级取数（本机未启动数据侧车），因此明显长于 T2。
- 步骤耗时与整轮耗时均取自服务端同一时钟；并发工具各自计时，前端不做求和。
- 事件顺序实测：T1 为 `meta → trace* → delta/tool → trace(finish) → done`；T2 / T3 / T4 为 `trace(首帧) → meta → trace* → delta → trace(finish) → done`。既有事件类型、字段与语义均未变化，旧消费端忽略未知类型即可。

### 9.2 前端呈现（生产构建 + 无密钥兜底链路）

- `corepack pnpm test:e2e tests/e2e/agent-trace.spec.ts`：4 例全绿。
  - 运行期：标题行展示「执行轨迹 · N 步 · 已完成 M 步 · 总耗时」，步骤行含中文名、轮次、状态、摘要与耗时，Thinking 步骤额外展示首字时延。
  - 结束后：默认策略下面板在 800ms 宽限后整体移除，正文「数据概览」、来源列表与风险提示保持原样。
  - 折叠保留：设置项切换并刷新后仍生效（localStorage），结束后面板折叠为一行摘要（实测 `4 步 · 15.1s`），展开可回看每步耗时。
  - 中断：请求进行中点击「停止回复」后无轨迹残留。
- 人工核查（1440×960 截图，真实密钥链路）：对话面板与分析面板中的位置、暗色主题配色与对齐符合既有设计；`prefers-reduced-motion` 下不启用脉冲动画与实时计时采样。

### 9.3 全量回归

| 命令 | 结果 |
| --- | --- |
| `corepack pnpm typecheck` | 通过 |
| `corepack pnpm lint` | 通过 |
| `corepack pnpm test` | 49 个文件 / 598 例通过（含新增 24 例） |
| `corepack pnpm build` | 通过 |
| `corepack pnpm test:e2e` | 9 例通过（含新增 4 例） |
