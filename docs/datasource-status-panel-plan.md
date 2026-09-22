# 数据源状态入口上移与健康探测超时修复方案

- 分支：`feature/datasource-failure-ux`
- 关联验收：`docs/checklists/14-feature-datasource-status-entry.md`
- 关联文档：`docs/workbench-scope-layout-plan.md`、`docs/checklists/12-feature-workbench-scope-layout.md`、`docs/datasource-failure-plan.md`

## 1. 需求与问题

1. **数据源状态位置不合理**：`数据源与调度` 只是个股工作台「持仓与全局工具」组里的一个模块，但它描述的是整个站点的数据源健康状况，与当前标的、与工作台都无关，用户需要先勾选模块才能看到。
2. **数据源面板「怎么刷新都是请求超时」**：
   - 实测 `/api/admin/datasources` 响应耗时 **> 60 秒**（curl 60 秒被截断），而面板客户端超时为 20 秒 → 每次打开/刷新都提示「请求超时，请稍后重试。」；
   - 定位到根因：R2 健康探测 `objectExists()` 没有任何超时约束，本机网络到 `*.r2.cloudflarestorage.com` 不可达（`TimeoutError: read ECONNRESET`），单次探测实测 **51.3 秒**才失败；
   - 其余探测（行情侧车、基金侧车、Tavily、DeepSeek）都有 8 秒超时，唯独 R2 遗漏；面板的四个操作按钮在动作完成后都会再拉一次快照，于是「怎么刷新都是超时」。
   - 另有次要问题：`刷新基金数据` 任务本身实测耗时 **49.3 秒**（`target=all`，4 只样本基金），超过面板 20 秒的请求超时，任务其实成功却会被判为失败。

## 2. 目标

- 数据源健康与调度状态从工作台模块中抽出，放到页面右上角功能区（与「背景与光效 / 轨迹显示 / 数据一致性」并列），两个工作台都能直接用。
- `/api/admin/datasources` 必须在预算内返回：每个探测都有硬超时，快照整体也有总预算，外部依赖不可达时降级为「离线 + 原因」而不是挂住。
- 长耗时后台任务不再被客户端的短超时误判为失败。

## 3. 设计

### 3.1 入口上移（`DataSourceStatusEntry`）

- 新增 `src/components/panels/DataSourceStatusEntry.tsx`：右上角按钮「数据源状态」+ 弹窗（`createPortal`，`z-[80]`，样式与「数据一致性」一致）。
- 弹窗内保留原有内容：5 张数据源卡片（状态、延迟、最近检查 / 成功、连续失败、原因）+ 调度任务（Cron、最近运行、启用状态、最近 5 次运行记录）+ 四个操作按钮（刷新状态 / 手动刷新 / 刷新基金数据 / 清理过期资讯）。
- 快照改为**打开弹窗时懒加载**：避免每次进入页面都触发外部探测；加载成功后按钮上显示状态点（离线 > 降级 > 在线 取最差）。
- 删除 `DataSourcePanel.tsx`，并从 `MODULE_OPTIONS`（个股工作台）与 `StockWorkbench` 的模块渲染中移除 `datasource`；个股分组由「8 + 6」变为「8 + 5」。

### 3.2 服务端探测超时（`src/lib/datasource-health.ts`）

- 新增常量：`PROBE_TIMEOUT_MS = 8_000`（可用 `DATA_SOURCE_PROBE_TIMEOUT_MS` 覆盖）、`SNAPSHOT_BUDGET_MS = 12_000`（可用 `DATA_SOURCE_SNAPSHOT_BUDGET_MS` 覆盖）；行情 / 基金 / Tavily / DeepSeek 复用该超时，R2 探测用 `Promise.race` 加同样的硬超时（S3 客户端不支持从应用侧注入 requestHandler，故在调用处加界）。
- `getDataSourceHealthSnapshot()` 用总预算兜底：整体超过 `SNAPSHOT_BUDGET_MS` 时，未返回的数据源统一返回「离线 · 健康探测超过 N 秒未返回」，保证接口响应时间上界 ≈ 12 秒 + 调度任务查询（store 侧 2 秒超时）< 客户端 20 秒。
- 超时文案统一为「XX 探测超时（N 秒未响应）」，便于用户区分「网络不可达」与「上游返回异常」。

### 3.3 客户端超时（`DataSourceStatusEntry`）

- 只读快照请求保持 20 秒（服务端已保证 ≤ ~12 秒）；
- 三个任务触发请求改用 `JOB_TIMEOUT_MS = 180_000`，超时文案改为「任务执行超时，请稍后刷新状态确认结果。」，避免把仍在服务端执行的任务误报为失败。

## 4. 改动范围

| 文件 | 改动 |
| --- | --- |
| `src/components/panels/DataSourceStatusEntry.tsx` | 新增：右上角入口 + 弹窗 + 懒加载 + 任务超时 |
| `src/components/panels/DataSourcePanel.tsx` | 删除（内容迁入入口） |
| `src/app/page.tsx` | 右上角功能区新增「数据源状态」入口 |
| `src/components/panels/FunctionOptionsSidebar.tsx` | 移除 `datasource` 模块与分组说明中的相应文案 |
| `src/components/workbench/StockWorkbench.tsx` | 移除 `DataSourcePanel` 引入与渲染分支 |
| `src/lib/datasource-health.ts` | 探测硬超时 + 快照总预算 + 超时文案 |
| `tests/datasource-health.test.ts` | 新增：R2 挂起时快照仍在预算内返回离线 |
| `tests/module-scope.test.ts`、`tests/e2e/module-scope.spec.ts` | 个股全局分组计数 6 → 5 |
| `tests/e2e/home.spec.ts` | 新增：右上角数据源状态入口可打开并展示数据源卡片 |

## 5. 测试与验收

- 单测：探测超时保护（R2 挂起 → 离线 + 超时文案 + 总耗时在预算内）；模块分组划分更新。
- 端到端：右上角入口打开后可见数据源卡片与调度任务；个股工作台模块栏不再出现「数据源与调度」，全局分组计数为 5。
- 回归：`typecheck` / `lint` / `test` / `build` / `test:e2e`。
- 手工验证：本地 `.env`（R2 不可达）下 `GET /api/admin/datasources` 应在 ~12 秒内返回 R2 = 离线。

## 6. 非目标

- 不改数据源探测的判定规则（在线 / 降级 / 离线的语义与文案主体不变）；
- 不处理 R2 上传路径（日报 / 资讯快照上传）在 R2 不可达时的长时间等待，仅在验收中提示；
- 不改调度任务本身的执行耗时与并发策略。