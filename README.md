# 个股与基金盘面分析网站

> 本地运行的 A 股 / 基金盘面分析与 AI 学习台：行情与 K 线、技术指标、基金净值与风险指标、资讯与 AI 报告、多轮问答、交易复盘。

[![CI](https://github.com/encode-utf8/stock-analysis/actions/workflows/ci.yml/badge.svg)](https://github.com/encode-utf8/stock-analysis/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-corepack-F69220?logo=pnpm&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=next.js&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)

## 功能

| 模块 | 能力 |
| --- | --- |
| 个股盘面 | 代码校验与市场识别、行情快照、分时 / 日 / 周 / 月 K 线、MA / MACD / KDJ / RSI / BOLL |
| AI 分析 | 资讯抓取去重与情绪分类、影响周期、教学式报告与风险提示；AI 股市日报（指数、涨跌家数、板块榜、自选复盘） |
| 对话助手 | SSE 流式输出、多轮上下文、工具调用（行情 / K 线 / 指标 / 资讯 / 历史报告 / 保存报告）与来源引用 |
| 执行轨迹 | 运行期展示 Agent 执行步骤与每步耗时（模型步骤含首字时延），结束后自动清除、只保留最终结果，也可切换为「折叠保留」 |
| 基金台 | 基金档案、历史净值、场内实时 / 场外估算、季度持仓、回撤与风险指标（波动、夏普、索提诺、卡玛、回撤修复）、风格因子；AI 基金日报 |
| 基金投研 | 2–5 只基金对比、权重组合与再平衡偏离、定投回测（单基金 / 组合）、历史复盘（7 / 30 / 90 天） |
| 我的持仓 | 个股与基金的持仓收益、当日盈亏、权重与行业分布；点击持仓 / 持有标的即可切换当前查询盘面；数据库不可用时落本地文件 |
| 自选与预警 | 自选股 / 自选基金增删改与上游代码校验；条件预警（单条件或 2–4 条件 AND/OR），交易日盘中扫描 + 实时行情秒级判定，事件流与邮件摘要 |
| 实时行情 | 自选池 SSE 秒级推送（服务端单例轮询、多订阅合并去重、失败指数退避），顶部行情条展示价格、连接状态与更新时间 |
| 数据一致性 | 断连期间的降级数据回填数据库 / R2，模板垃圾清理进 `.data/quarantine/` 并可人工回滚 |
| 界面 | 暗色科技风；功能模块按「当前标的」与「持仓与全局工具」分组切换、分组内独立勾选与拖拽排序；5 种背景预设与自定义图片、光标光效与粒子联动，均可在「背景与光效」中调节 |

## 技术栈

| 层 | 技术 |
| --- | --- |
| Web / Agent | Next.js（App Router）+ TypeScript + Tailwind CSS + shadcn/ui |
| 数据侧车 | Python 3.12 + FastAPI + AkShare / Tencent |
| 存储 | Drizzle ORM + PostgreSQL（Docker，可选）；未配置时使用内存与 `.data/` 文件降级 |
| 可选外部服务 | DeepSeek（AI 生成）、Tavily（资讯检索）、Cloudflare R2（快照存储） |

## 快速开始

环境要求：

- **Node.js** 20+（CI 使用 22）与 pnpm（可用 `corepack` 提供）
- **Python** 3.12+（一键脚本优先复用 `stock-analysis` conda 环境或项目 `.venv`）
- **Docker Desktop**（可选，用于本地 PostgreSQL 16）

```bash
cp .env.example .env          # 按需填写密钥，留空即走降级路径
corepack enable
corepack pnpm install
./scripts/db-up.ps1           # 启动本地 PostgreSQL（可选；Linux / macOS 用 docker compose up -d postgres）
corepack pnpm db:migrate      # 执行迁移（可选）
```

一键启动（推荐）：

```bash
start.bat                     # Windows，也可用 corepack pnpm start:win
./start.sh                    # Linux / macOS
```

- 启动参数：`--install` 强制校验依赖、`--skip-install` 跳过依赖检查、`--no-browser` 不自动打开浏览器（PowerShell 脚本使用 `-Install -NoBrowser`）。
- 停止服务：`stop.bat` / `./stop.sh`，按端口 `3000`、`8000` 与进程特征停止完整进程树，并回收定时任务守护进程。
- 访问入口：Web `http://127.0.0.1:3000`（顶部切换个股 / 基金工作台，基金可试 `510300`、`000001`、`110022`），数据侧车健康检查 `http://127.0.0.1:8000/health`。

手工启动：

```bash
corepack pnpm dev             # Web
corepack pnpm dev:data        # 数据侧车（Windows）
corepack pnpm dev:all         # 同时启动 Web 与侧车（Windows）
```

Linux / macOS 单独启动侧车：`python -m uvicorn app.main:app --app-dir data-service --host 127.0.0.1 --port 8000`。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `corepack pnpm dev` / `build` / `start` | 开发 / 构建 / 生产启动 |
| `corepack pnpm typecheck` / `lint` / `test` | 类型检查 / ESLint / 单元测试（Vitest） |
| `corepack pnpm test:coverage` | 单元测试覆盖率 |
| `corepack pnpm test:e2e` / `test:e2e:install` | 端到端测试（Playwright，需先 `build`）/ 首次安装 Chromium |
| `corepack pnpm db:generate` / `db:migrate` / `db:studio` | Drizzle 迁移生成 / 执行 / 可视化（需 `DATABASE_URL`） |
| `corepack pnpm scheduler:worker` / `scheduler:once` | 定时任务守护进程 / 单轮补跑 |
| `corepack pnpm data:cleanup` | 数据一致性扫描（加 `--apply` 执行清理） |

## 配置

复制 `.env.example` 为 `.env` 后按需填写，未配置的项自动走降级路径。

| 变量 | 说明 |
| --- | --- |
| `DEEPSEEK_API_KEY` | AI 分析与对话；未配置时使用本地确定性报告 |
| `TAVILY_API_KEY` | 外部资讯检索；未配置时使用本地演示资讯 |
| `DATABASE_URL` | PostgreSQL 连接串（缺省端口自动补 `5432`）；未配置时使用内存存储 + `.data/` 文件回退 |
| `DATA_SERVICE_URL` | 数据侧车地址，默认 `http://127.0.0.1:8000` |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME` / `R2_PUBLIC_URL` | Cloudflare R2 快照存储 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | 预警与日报邮件（授权码只写本地 `.env`）；未配置时仅页面展示 |
| `DATA_ROOT` | 本地降级数据根目录（`.data` 位于其下），默认进程工作目录 |

定时任务表达式（资讯清理、行情 / 基金刷新、净值结算、预警扫描、日报探测）、实时行情推送节奏与调度守护等变量，见 `.env.example` 注释。

## 数据与降级

- 未配置 `DATABASE_URL` 时：自选股 / 自选基金 / 持仓 / 预警规则与事件 / 邮件设置写入 `<DATA_ROOT>/.data/*.json`（重启不丢失），分析报告、资讯与会话使用进程内内存。
- 未配置 `DEEPSEEK_API_KEY` 或模型输出缺少具体行情数据时，AI 分析回退为包含最新价、K 线与指标的教学式报告。
- 实时 / 最新数据（行情、K 线、指标、资讯、基金档案 / 净值 / 盘中 / 持仓）在数据源故障时按官方快照降级：只要本地存有官方来源历史快照就继续提供服务，并在来源行标注「降级快照（数据源故障，降级于 …）」与抓取时间，降级结果只做 10 秒短缓存，冷却结束立刻重试真实数据源。
- 没有官方快照时该功能不返回任何数据，统一提示「当前数据源故障，请稍后再试。」，相关触发按钮全站禁用 10 秒并展示倒计时；确定性演示数据（`deterministic-fallback`、演示资讯）不再面向用户返回。
- AI 日报优先写入 R2（对象键 `daily-reports/{kind}/{date}.json`），失败时落 `.data/daily-reports/`，面板标注存储位置；大盘涨跌家数与板块数据来自侧车 AkShare，缺失项在正文与面板显式标注。
- 交易日历优先取侧车 AkShare 数据，侧车不可用时退回「工作日」近似并在面板标注来源。
- 基金盘中估算：场内（ETF / LOF）用腾讯实时价与 IOPV；场外取东财估值排行，取不到估算时按「缺少观测值」跳过，不用降级数据报警。
- `.env`、`.logs/`、`.data/` 不提交仓库；R2 写入带超时保护，失败不阻塞主流程。清理规则见 `docs/data-consistency-cleanup-plan.md`。

## 定时任务

- Web 进程启动即注册定时任务（`src/instrumentation.ts`），调度表集中在 `src/lib/scheduler-guard.ts`。
- `GET /api/admin/scheduler/status` 查看各任务最近运行时间、过期状态与跳过原因；`POST /api/admin/scheduler/tick` 仅补跑过期任务，单项失败不影响其它任务。
- 独立守护进程 `corepack pnpm scheduler:worker` 负责「发现停摆 + 补齐过期任务」（`start.*` 会随应用拉起，`SKIP_SCHEDULER_WORKER=1` 可关闭）；Windows 可用 `scripts/start-scheduler.ps1` 管理，`-Stop` 停止。

## 测试与 CI

| 类型 | 运行方式 | 说明 |
| --- | --- | --- |
| 单元测试 | `corepack pnpm test` | Vitest，纯本地、无外部依赖 |
| 端到端 | `corepack pnpm build && corepack pnpm test:e2e` | Playwright，自动拉起行情侧车替身与 `next start`（端口 3100），覆盖首页外壳、工作台切换、模块分组、自选股、持仓点击切换、背景设置、执行轨迹与数据源故障 |
| 持续集成 | push / PR 自动触发 | `install → typecheck → lint → test → build`，侧车仅做 Python 语法检查 |

- 端到端用例的数据隔离：`DATA_ROOT` 指向临时目录，数据库、SMTP 与外部密钥一律置空，不会读写本机 `.data`；行情侧车由 `tests/e2e/mock-sidecar.mjs` 以官方来源（`akshare`）替身提供，`DATA_SERVICE_URL` 指向该替身（端口 `E2E_SIDECAR_PORT`，默认 3199）。
- 数据源故障用例通过侧车替身的 `/__control?online=0` 开关构造 503，验证故障提示、按钮 10 秒禁用与冷却后自动恢复。
- 失败时的截图与 trace 落在 `.logs/e2e`；`E2E_PORT`、`E2E_DATA_ROOT` 可覆盖端口与数据目录。
- 方案与验收记录见 `docs/ci-plan.md`、`docs/e2e-plan.md` 与 `checklist.md`。

## 健康检查

```bash
curl http://127.0.0.1:3000/api/health                  # Web
curl http://127.0.0.1:8000/health                      # 数据侧车
curl http://127.0.0.1:8000/index/quote?codes=sh000001,sz399001,sz399006
curl http://127.0.0.1:8000/market/breadth              # 涨跌家数，可加 ?date=YYYY-MM-DD 回补
curl http://127.0.0.1:8000/market/sectors?limit=5      # 行业板块
curl http://127.0.0.1:8000/index/kline?code=sh000001&limit=60
curl http://127.0.0.1:3000/api/funds/510300/metrics?range=all
curl "http://127.0.0.1:3000/api/daily-reports?kind=stock"
curl http://127.0.0.1:3000/api/admin/scheduler/status
```

日报补生成与删除：`POST /api/admin/daily-reports/backfill`（`{"kind":"stock","days":5,"force":false}`）、`DELETE /api/admin/daily-reports/{kind}/{date}`。

## 项目结构

```text
src/app            Next.js 页面与 API 路由
src/components     工作台、面板与 UI 组件
src/lib            行情 / 基金 / AI 编排 / 存储 / 调度等领域逻辑
data-service       FastAPI 数据侧车（行情、基金、交易日历、大盘与板块）
scripts            启动、停止、数据库、数据清理与调度守护脚本
tests              单元测试（tests/）与端到端测试（tests/e2e/）
docs               设计、方案与验收文档
```

## 文档索引

| 文档 | 内容 |
| --- | --- |
| `docs/design.md`、`docs/spec.md` | 总体设计与接口约定 |
| `docs/plan.md`、`docs/next-phase-dev-plan.md` | 阶段规划与后续演进 |
| `docs/fund-workbench-design.md`、`docs/fund-workbench-plan.md`、`docs/fund-workbench-spec.md` | 基金工作台设计与规格 |
| `docs/agent-trace-plan.md` | Agent 执行轨迹可视化方案与实测 |
| `docs/daily-report-plan.md`、`docs/alert-center-plan.md`、`docs/realtime-quote-push-plan.md` | 日报、预警与实时行情 |
| `docs/data-consistency-cleanup-plan.md`、`docs/ci-plan.md`、`docs/e2e-plan.md`、`docs/engineering-quality-plan.md` | 数据一致性、CI 与工程化 |
| `checklist.md`、`docs/checklists/` | 各功能验收清单 |

## 免责声明

本项目仅供学习参考，不构成投资建议。所有行情、资讯与 AI 输出均可能存在延迟或误差，请独立判断并自行承担盈亏。