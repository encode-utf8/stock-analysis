# Agent 执行轨迹可视化与步骤耗时 验收清单

- 关联方案：`docs/agent-trace-plan.md`
- 关联文档：`docs/design.md`、`docs/next-phase-dev-plan.md`
- 分支：`feature/agent-trace`
- 状态：开发完成，自测通过（2026-09-20，待用户验收）

## 已确认决策

- 自清理严格度 **C**：默认结束后完全移除；新增设置项可切换「结束后折叠保留」。
- 本期不含日报生成（T5）。
- 分支策略：从 `main` 新建 `feature/agent-trace`。
- 思考步骤命名使用 **thinking**（标签 `Thinking`，摘要中文）。

## 任务目标

- R1：所有 Agent 编排链路（T1 个股对话 / T2 个股分析 / T3 基金分析 / T4 基金对话）在运行期可视化执行轨迹，形态对齐成熟代码 Agent。
- R2：每个步骤展示耗时，面板展示步骤数与整轮总耗时，模型步骤展示首字时延。
- R3：执行结束后轨迹自动收起并清理，界面仅保留未引入本功能时的最终结果呈现；中断不残留。

## 范围

- 范围：新增轨迹契约、服务端记录器、前端状态机与轨迹面板；四条 SSE 链路埋点与透传；样式与文档。
- 非范围：日报生成进度通道（T5，二期）、数据一致性巡检 / 调度器 / 数据源健康 / 预警扫描（确定性批处理）、轨迹持久化与回放、数据库结构变更。

## 验收清单

### 契约与记录器（P0）

- [x] 新增 `src/lib/shared/types/agent-trace.ts`，导出 `AgentTraceStepKind` / `AgentTraceStatus` / `AgentTraceScope` / `AgentTraceStep` / `AgentTraceRun`
- [x] `ChatStreamEventType`、`AnalysisStreamEventType`、`FundAnalysisStreamEventType` 各新增 `trace`，且既有字段与语义未变
- [x] `ChatStreamEvent.data` / `AnalysisStreamEvent.data` / `FundAnalysisStreamEvent.data` 新增可选 `trace` 字段
- [x] 新增 `src/lib/agent-trace.ts`：`createTraceRun()` / `startStep()` / `measure()` / `snapshot()` / `finish()`
- [x] 记录器支持注入时钟，单测可产出确定性耗时
- [x] 步骤上限 24 与 `detail` 截断 180 字生效，超限不抛错
- [x] 记录器不落库、不写文件（纯内存）

### 个股对话轨迹（P1，P0 里程碑）

- [x] `streamChat()` 每轮插入 `thinking` 步骤，流式结束或收到工具调用后收尾，并记录首字时延
- [x] 每个工具调用产生一条 `tool` 步骤，含中文可读名、入参摘要、结果摘要与耗时（`runTracedTool()` 包装，未改动 `executeTool()` 本身）
- [x] 六个工具的中文名映射完整（行情 / K 线 / 指标 / 资讯 / 历史报告 / 保存报告）
- [x] `/api/chat` 透传 `trace` 事件；实测顺序 `meta → trace* → delta/tool → trace(finish) → done`
- [x] `executeTool()` 的既有调用点与返回结构未破坏（路由与工具层零改动，仅新增包装函数）
- [x] 无密钥兜底链路同样产生轨迹，且模型步骤标注「未调用 AI（本地兜底）」

### 分析链路与基金链路（P2）

- [x] `streamAnalysis()` 产出 `data` / `thinking` / `guard` / `persist` 四类步骤（含模型失败与被拦截时的 `skipped` / `failed` 结论）
- [x] `streamFundAnalysis()` 产出与个股分析同构的步骤
- [x] `streamFundChat()` 产出 `data` / `thinking` 步骤
- [x] 三条分析 / 对话路由均为通用透传（`send(event)` 直接序列化生成器事件），无需改动即可透传 `trace`；生成器中断时由前端按 `error` / 中断分支收尾清理

### 前端呈现与自清理（P1 / P2）

- [x] 新增 `src/lib/agent-trace-client.ts`：`applyTraceSnapshot()` 幂等覆盖，重复 / 乱序事件不产生重复步骤
- [x] 生命周期正确：`idle → live → lingering → cleared`，`lingering` 持续 800ms 后移除（`useTraceAutoClear()` 统一接线）
- [x] 设置项：`AgentTraceSettingsEntry` 可切换「结束后清除 / 折叠保留」，选择持久化并在刷新后生效（e2e 断言）
- [x] 收到 `done` / `error` 后轨迹自动清理，仅保留正文、来源、风险提示、既有「工具调用」摘要块与 AI 调用标记
- [x] 用户中断（停止回复）时直接清理，不渲染半成品轨迹（`stopChat` / `stopFundChat` 立即复位）
- [x] 新增 `AgentTracePanel.tsx`：折叠头（状态圆点 + 步骤计数 + 累计耗时）与步骤行（图标 + 名称 + 摘要 + 耗时 + 失败原因）
- [x] 模型步骤展示首字时延（TTFT）
- [x] 轨迹面板可手动折叠 / 展开，键盘可达（原生 `button` + `aria-expanded`）
- [x] `prefers-reduced-motion` 下停用脉冲动画与实时计时采样
- [x] `ChatPanel` 运行期渲染轨迹；`AnalysisPanel` 与 `FundAnalysisPanel` 生成期渲染轨迹
- [x] 历史会话与历史报告回看不渲染轨迹（轨迹只来自运行期 SSE，不参与落库与回放），消息与报告结构未变

### 回归与质量

- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm test` 全绿：49 个文件 / 598 例（含新增 2 个单测文件共 24 例）
- [x] `corepack pnpm build` 通过
- [x] `corepack pnpm test:e2e` 通过：9 例（含新增 `tests/e2e/agent-trace.spec.ts` 4 例）
- [x] 既有功能回归一致：行情、K 线、指标、资讯、分析报告、对话、历史回看（e2e 全量 + 手工核查）
- [x] 未改动数据库结构与迁移、未新增持久化表
- [x] 代码注释与文档均为中文
- [x] 未提交真实密钥

## 验证方式

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
corepack pnpm test:e2e
```

- 单测：`tests/agent-trace.test.ts`（记录器计时 / 状态 / 截断 / 并发）、`tests/agent-trace-client.test.ts`（幂等 / 乱序 / 清理策略）
- 端到端：`tests/e2e/agent-trace.spec.ts`（无密钥兜底路径即可稳定覆盖：轨迹出现 → 结束后消失 → 仅剩最终结果 → 中断不残留）
- 手工：`corepack pnpm dev` 后分别在配置密钥与未配置密钥两种环境下验证轨迹与耗时展示

## 风险与遗留

- 不展示模型私有思维链与原始提示词，仅展示编排层可观测阶段
- 并发工具步骤各自计时，整轮总耗时不等于分步之和（前端分别展示，不做求和）
- 既有 `messages.tool_calls` 落库结构本期保持不变（属「未开发本功能时」的既有呈现）
- T5 日报生成进度通道留待二期评估
- 轨迹不落库，事后排查依赖既有 `recordTaskRun()` 计数
