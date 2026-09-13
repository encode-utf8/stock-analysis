# E 组工程质量方案（编排层测试补强 / 定时任务守护）

- 文档版本：v1.0
- 编制日期：2026-09-13
- 关联文档：`checklist.md`（T1 测试基建、A 组日报收尾）、`docs/next-phase-dev-plan.md`、`docs/design.md`
- 建议分支：`feature/engineering-quality`
- 目标：E1 提升 `src/lib` 编排层测试覆盖；E2 让定时任务不再隐性依赖「有人访问页面」并具备独立守护与断点补跑。

---

## 1. 现状与缺口（已实测）

### 1.1 覆盖率基线（`corepack pnpm test:coverage`，2026-09-13）

| 模块 | 行覆盖率 | 说明 |
| --- | --- | --- |
| `src/lib/**`（含 `lib/db`、`lib/store` 等子目录，即 `vitest.config.mts` 的 coverage include 口径） | 32.69% | 多数编排模块为 0-13% |
| 顶层 `src/lib`（上表 `lib` 行，不含子目录） | 33.05% | 同上 |
| `src/lib/data-service.ts` | 8.33% | 侧车客户端，全部走 `fetch`，可用 stub 覆盖 |
| `src/lib/scheduler.ts` | 9.79% | 任务编排，依赖可被模块 mock 替换 |
| `src/lib/daily-report.ts` | 50.3% | 采集链路（`collectIndices`/`collectSectors`）未覆盖 |
| `src/lib/observability.ts` | 8.47% | 进程内计数器与快照 |
| `src/lib/alert-email.ts` | 35.13% | 摘要构造与「未配置 SMTP」跳过分支未覆盖 |
| `src/lib/store/index.ts` | 14.01% | 内存版 stub 未被直接验证 |

### 1.2 调度缺口

- `startScheduler()` 只在 6 个 admin 路由被调用（`src/app/api/admin/*`）。也就是说：**进程启动后若无人访问这些接口，定时任务永远不会注册** —— 无人值守运行时清理、预警扫描、日报探测全部静默停摆。
- 没有 boot 期注册入口（项目无 `src/instrumentation.ts`），也没有「上一次任务跑了多久前」的对外可观测状态。
- 进程重启/长时间停摆期间的到期任务不会被补齐（`job_runs` 里有记录，但没人消费）。
- 调度表达式分散在 `startScheduler()` 与 `.env` 两处，缺少单一事实来源，守护逻辑无法复用。

---

## 2. 可行性分析

- **测试**：`vitest` 已是现有设施；`data-service.ts` 的全部外部依赖是全局 `fetch`，用 `vi.stubGlobal("fetch", ...)` 即可覆盖成功、非法结构、HTTP 错误、网络异常四类分支；`scheduler.ts` 的任务函数都从模块导入，可用 `vi.mock` 注入替身；vitest 不加载 `.env`，数据层自动回退内存实现，`store.jobRuns` 可直接写入。
- **守护**：Next 16 支持 `src/instrumentation.ts` 的 `register()`，可在服务端启动时确定性注册定时任务；补跑判定可做成纯函数（输入「当前时间 + 各任务最近一次运行时间」），既可单测又不依赖真实时钟。
- **独立 worker**：Node 20+ 自带全局 `fetch`，`scripts/*.mjs` 无需编译即可运行；仓库已有 `scripts/start-data.ps1` 的 pid 文件模式，可照搬做进程生命周期管理。
- **风险**：worker 与进程内 cron 可能重复触发 —— 通过「只在超过 staleness 阈值时才补跑」规避：进程内 cron 正常工作时不会有任务被判为过期。

---

## 3. 关键设计

### 3.1 E1 测试补强

新增测试文件（全部集中在 `tests/`，不改业务逻辑）：

| 文件 | 覆盖内容 |
| --- | --- |
| `tests/data-service-client.test.ts` | 9 个侧车客户端函数的成功/非法结构/HTTP 失败/网络异常；代码校验路径 |
| `tests/daily-report-collect.test.ts` | `collectDailyReportData`：当日路径（快照 + 日线对比）、历史路径（同花顺口径）、缺数据回退、降级自选池剔除 |
| `tests/scheduler-jobs.test.ts` | `runCleanupJob` / `runRefreshJob` / `runFundRefreshJob` / `runAlertScanJob` / `runDailyReportBackfill` 的编排、`job_runs` 落库与失败记录 |
| `tests/scheduler-guard.test.ts` | 调度表、过期判定、状态汇总、补跑编排（纯逻辑 + 模块 mock） |
| `tests/observability.test.ts` | 计数器、快照比率、内存回退路径 |
| `tests/alert-email.test.ts` | `buildAlertDigest` 文案、`isEmailConfigured`、未配置 SMTP/非法收件人时的 `skipped` |

补充测试（同样集中在 `tests/`）：`store-memory`、`store-fallback`、`market-data`、`trading-calendar`、`deterministic`、`cache`、`api-response`、`mock-data`、`utils`、`news-client`、`observability-db` 共 11 个文件，用于把纯计算与内存回退路径一并纳入统计。

约束：不引入新的测试依赖；不访问网络（`fetch` 必须 stub）；不写真实密钥。

### 3.2 E2 定时任务守护

1. `src/instrumentation.ts`：Node 运行时启动即调用 `startScheduler()`（构建阶段跳过），消除「必须有人访问 admin 接口才注册定时任务」的隐性依赖。
2. `src/lib/scheduler-guard.ts`（单一事实来源）：
   - `SCHEDULE_TABLE`：任务键 → 环境变量、默认 cron、过期阈值（分钟）、是否仅交易日。
   - `selectStaleTasks({ now, states, isTradingDay })`：纯函数，返回该补跑的任务；`states` 由 `collectTaskStates()` 从 `job_runs` 与当日日报汇总而来。
   - `summarizeSchedulerStatus(...)`：每个任务最近一次运行时间、是否过期、阈值，供接口与面板展示。
   - `runSchedulerTick({ now, runners, isTradingDay })`：对过期任务逐个补跑，`runners` 由 `scheduler.ts` 的 `SCHEDULER_RUNNERS` 注入；单项失败不影响其它项，结果写入 `job_runs`。
3. 接口：`GET /api/admin/scheduler/status`（状态）、`POST /api/admin/scheduler/tick`（补跑）。写接口用 `SCHEDULER_TOKEN`（请求头 `x-scheduler-token`）鉴权；未配置令牌时只允许本机直连（无代理头或回环地址），避免公网误触发。
4. `scripts/scheduler-worker.mjs`：独立进程，按间隔探测 `/api/health` 与 `/api/admin/scheduler/status`，发现过期任务就调 `tick`；支持 `--once`、`--interval`、`--max-failures`，SIGINT/SIGTERM 优雅退出。
5. 启动集成：`scripts/start-scheduler.ps1`（pid 文件管理）+ `start.bat` / `start.sh` 可选拉起，`SKIP_SCHEDULER_WORKER=1` 可关闭。
6. 配置：`.env.example` 增加 `SCHEDULER_TOKEN`、`SCHEDULER_BASE_URL`、`SCHEDULER_WORKER_INTERVAL_S`；README 补充运行与排障说明。

调度表（默认值与现有 cron 一致）：

| 任务 | 环境变量 | 默认 | 过期阈值 |
| --- | --- | --- | --- |
| 资讯清理 | `CLEANUP_CRON` | `0 3 * * *` | 26 小时 |
| 样例行情刷新 | `REFRESH_CRON` | `30 3 * * *` | 26 小时 |
| 基金数据刷新 | `FUND_REFRESH_CRON` | `45 3 * * *` | 26 小时 |
| 预警扫描 | `ALERT_CRON` | `*/30 9-15 * * 1-5` | 2 小时（仅交易日） |
| 股市日报探测 | `DAILY_STOCK_REPORT_CRON` | `*/10 15-16 * * 1-5` | 26 小时（仅交易日） |
| 基金日报探测 | `DAILY_FUND_REPORT_CRON` | `*/20 20-23 * * 1-5` | 26 小时（仅交易日） |

---

## 4. 改动范围

- 新增：`src/instrumentation.ts`、`src/lib/scheduler-guard.ts`、`src/app/api/admin/scheduler/{status,tick}/route.ts`、`scripts/scheduler-worker.mjs`、`scripts/start-scheduler.ps1`、17 个测试文件、本方案文档。
- 修改：`src/lib/scheduler.ts`（导出调度表所需的运行函数）、`.env.example`、`README.md`、`package.json`（`scheduler:worker`）、`start.bat`、`start.sh`、`checklist.md`。
- 不改动：数据库表结构、既有 cron 默认表达式、日报与预警的业务逻辑。

## 5. 验收标准

- [x] `src/lib/**` 行覆盖率从 32.69% 提升到 45% 以上（顶层 `src/lib` 33.05% → 47.17%），且 `data-service.ts` ≥ 80%、`scheduler.ts` ≥ 60%、`observability.ts` ≥ 70%
- [x] 新增测试不访问网络、不依赖真实时钟与真实数据库；`corepack pnpm test` 全绿
- [x] 服务端启动即注册定时任务（`instrumentation.ts`），无需先访问 admin 接口
- [x] `GET /api/admin/scheduler/status` 返回每个任务最近运行时间与是否过期
- [x] `POST /api/admin/scheduler/tick` 仅补跑过期任务，单项失败不影响其它项
- [x] `node scripts/scheduler-worker.mjs --once` 可在应用未启动时安全退出并打印原因；应用运行时能发现过期任务并触发补跑
- [x] `.env.example`、README、start 脚本均包含守护进程配置与开关
- [x] `corepack pnpm test`、`typecheck`、`lint`、`build` 全部通过；中文注释与提交信息

## 6. 风险与遗留

- 守护进程是「补齐 + 告警式」而非高可用调度：它能发现停摆并补跑到期任务，但不负责拉起已经退出的 Web 进程（进程级守护需 supervisor/计划任务，超出本地单机范围）。
- 补跑阈值是经验值：日报/清理按天（26 小时）判定，预警按 2 小时判定，交易日均由交易日历判断，非交易日不会补跑。
- 覆盖率目标按「编排层可测部分」设定，`chat.ts`/`analysis.ts` 等强依赖模型服务的模块仍不纳入单测。
## 7. 实测结论（2026-09-13）

- E1：`src/lib/**` 行覆盖率 48.25%（基线 32.69%，均为 coverage include 口径的 `All files` 行）；顶层 `src/lib` 33.05% → 47.65%；`data-service.ts` 83.33%、`scheduler.ts` 82.87%、`scheduler-guard.ts` 100%、`observability.ts` 96.61%、`news.ts` 85.02%、`store/index.ts` 91.58%；`corepack pnpm test` 34 文件 / 360 用例全绿。
- E2：`next build` 后另起 `next start` 未访问任何 admin 接口即得到 `schedulerRegistered=true`；`node scripts/scheduler-worker.mjs --once` 发现 3 个过期任务并补跑成功（执行 3、失败 0）；未配置令牌时公网来源写请求返回 403，本机来源放行。
- 回归：`corepack pnpm test`、`typecheck`、`lint`、`build` 全部通过。详见 `checklist.md` 的「E 组工程质量 / 实测结果」。
