# 个股与基金盘面分析网站

本地运行的个股/基金盘面分析与 AI 学习工具。支持 A 股与基金代码查询、行情/K 线/技术指标、基金净值/持仓/风险指标、资讯分析报告、多轮对话与历史回看。

## 当前能力

- 盘面：股票代码校验与市场识别、行情快照、分时/日/周/月 K 线、MA/MACD/KDJ/RSI/BOLL。
- 分析：资讯抓取与去重、利好/利空/中性分类、影响周期、教学式报告与风险提示。
- 对话：SSE 流式输出、多轮上下文、工具调用与来源引用。
- 持久化与清理：TTL 缓存复用、资讯软删除、任务日志与可观测性指标。
- 降级：未配置外部密钥时自动使用确定性演示数据，并明确标注来源与更新时间。
- 自选股：支持增删、备注、排序；数据库不可用时自动回退到本地 `.data/watchlist.json`，重启不丢失。
- 自选基金：支持添加、删除、备注与点击切换；数据库不可用时自动回退到本地 `.data/fund-watchlist.json`，重启不丢失。
- 自选池代码校验：新增自选股/自选基金前先向上游（腾讯行情、东财基金名录）确认代码可查，查不到时弹窗提示「当前无数据，请检查输入代码是否正确」并阻止写入；上游不可用时放行以免误拦；写入成功后用上游真实名称回填，避免出现「股票 xxxxxx」这类占位名；历史遗留的占位名会在读取自选列表时自动回填并落库。
- 基金工作台：支持基金档案、历史净值、场内实时/场外估算、季度持仓、回撤与风险指标。
- 基金回撤：本地计算区间收益、年化收益、波动、夏普/索提诺/卡玛、最大回撤与回撤修复耗时，并在净值曲线中叠加区间矩形。
- 基金复盘：按 7/30/90 天回看基金 AI 分析与对话时间线，仅用于学习。
- 基金数据源：数据源健康面板展示基金上游状态，支持手动刷新基金档案、净值、持仓与风险指标。
- 基金对比：输入 2–5 个基金代码，按同一区间横向比较净值、收益、波动、回撤与风险收益指标，并提供归一化累计收益曲线叠加。
- 基金组合：支持百分比权重、目标权重区间或持仓份额输入，按共同交易日合成组合，展示组合收益/回撤曲线、目标权重区间、再平衡偏离提醒与单基金风险贡献拆解。
- 基金定投回测：支持单基金与多基金组合定投、每日/每周/每两周/每月频率，展示收益率曲线、最大回撤修复区间、扣款日收益差异，并对比定投与一次性买入表现。
- 自选池预警（预警中心）：为最多 10 个自选股/自选基金配置条件（默认上限，可用 `ALERT_MAX_TARGETS` 调整；单条件或 2–4 个条件 AND/OR 组合）；股票用行情快照，基金用盘中估算净值（场内实时价 / 场外用新浪财经盘中估值，取不到时回退东财估值排行），在交易日盘中（09:30–11:30、13:00–15:00）每 30 分钟兜底扫描一次，开启实时行情后改为秒级增量判定并即时推送；接入 AkShare 交易日历自动跳过周末与法定节假日，同一规则 12 小时冷却，命中后写入事件流并可按需发送摘要邮件。预警面板跟随所在工作台（个股台看股票预警、基金台看基金预警），左侧自选池增删后下拉选项实时同步，无需刷新页面。
- 实时行情推送：自选池行情通过 SSE 秒级推送（服务端单例轮询、多订阅者合并去重、交易时段默认 5 秒、休市降频、失败指数退避），自选池边栏与顶部行情条展示实时价、连接状态与更新时间；实时开关与提示音默认关闭，浏览器通知需用户授权，被拒时降级为站内提示。
- 交易日历：侧车 `/trading-calendar` 基于 AkShare 交易日历提供交易日查询，预警判定与面板状态共用；侧车不可用时自动回退「工作日」近似并标注来源。
- AI 收盘日报：分为股市日报（大盘指数、全市场涨跌家数、行业板块涨跌榜、自选股复盘）与基金日报（大盘背景、自选基金当日涨跌与净值口径），正文含与前一交易日的指数涨跌幅、成交额环比与板块轮动对比。交易日数据更新后自动探测生成（股市 15:10 起、基金 20:00 起），当天每类只生成一次，非交易日自动跳过；正文由 DeepSeek 生成，未配置或调用失败时降级为确定性模板；优先保存到 Cloudflare R2，未配置或失败时落本地 `.data/daily-reports/`；工作台内按日期倒序列表查看，支持按指定日期补生成、按最近 N 个交易日批量回补、删除单日日报，并在配置 SMTP 后推送摘要邮件。

- 我的持仓组合：手动录入个股的投入金额与当前持仓收益，自动推导市值与收益率，并结合最新行情估算当日盈亏，展示持仓权重与行业分布；数据库不可用时回退本地 `.data/stock-portfolio.json`，重启不丢失。
- 持有基金（养基宝式）：只录入基金代码、当前持有金额与当前累计收益，自动推导本金、累计收益率、当日实时收益（按盘中涨跌幅）与持仓占比，并结合盘中估值与最新官方净值展示当日涨跌幅、昨收净值与实时估值；数据库不可用时回退本地 `.data/fund-positions.json`，重启不丢失。
- 策略回测：支持双均线、MACD、RSI、布林带四类单标的策略与组合权重再平衡回测，可调周期参数、初始资金、手续费/印花税/滑点，输出净值曲线、总收益、年化、最大回撤与修复、夏普/索提诺/卡玛、交易次数、胜率以及买入持有基准对比；固定使用前复权日/周线并标注仅供学习；取不到真实历史 K 线时直接拒绝，不会用降级数据出结果。
- 界面风格：暗色科技风（深空蓝黑底 + 霓虹青主色），全站颜色统一走 `src/app/globals.css` 的语义令牌；卡片为半透明科技面板并带悬停辉光，图表网格/坐标/悬浮提示在暗底上重新调色，正文对比度 ≥ 12:1、次级文字 ≥ 7:1。
- 交互光效：光标跟随光晕与光环（指数缓动 + 拖尾距离封顶，快速甩动也不会掉队）、点击涟漪与粒子迸发、卡片与按钮的悬停/按压反馈；在「粒子星链」下光标会作为节点自动联结 180px 内的星链（越近越亮），并把粒子轻吸到 74px 停靠环上，离开半径立即断开；仅在精细指针设备启用，尊重系统「减少动态效果」，并可在「背景与光效」中开关与调节强度。
- 自定义背景：5 种内置预设（科技网格 / 粒子星链 / 星域 / 极光 / 纯净），五种预设各自主色调与结构都不同（明亮蓝网格、墨青绿星链、紫罗兰星域、青紫极光、纯色底），切换后一眼可辨；「极光」是 canvas 逐列绘制的真实帘幕动景（5 条帘幕、射线纹理、随气流摆动与明暗跳动），不是静态渐变；另有自定义图片上传（PNG/JPEG/WebP/GIF，≤8MB）。可调背景遮罩、模糊、面板不透明度与粒子密度（密度实时换算为 0~240 颗粒子，0 即清空），参数即时预览并自动保存；设置存 `.data/ui-background.json`、图片存 `.data/backgrounds/`，遮罩过淡或面板过透时给出对比度提示。
## 技术栈

- Web/Agent：Next.js App Router + TypeScript + Tailwind CSS + shadcn/ui
- 行情/基金数据侧车：Python 3.12 + FastAPI + AkShare/Tencent
- 数据库：Drizzle ORM + Docker PostgreSQL（本地）
- 包管理：Node 20+，pnpm

## 环境要求

- Node.js 20+
- pnpm，或可用的 `corepack`
- Python 3.12+（一键启动脚本会优先使用 `stock-analysis` conda 环境或项目 `.venv`）
- 推荐本地服务：Docker Desktop（PostgreSQL 16）
- 可选外部服务：DeepSeek、Tavily、Cloudflare R2

## 快速开始

```bash
cp .env.example .env
corepack enable
corepack pnpm install
```

Windows PowerShell 启动本地 PostgreSQL 并执行迁移：

```powershell
./scripts/db-up.ps1
corepack pnpm db:migrate
```

Linux/macOS 或不想使用脚本时：

```bash
docker compose up -d postgres
corepack pnpm db:migrate
```

Windows 推荐双击 `start.bat`，或在项目根目录运行：

```bat
start.bat
```

Linux/macOS：

```bash
chmod +x start.sh
./start.sh
```

启动后访问：

- Web 前端：http://127.0.0.1:3000
- 行情/基金数据侧车健康检查：http://127.0.0.1:8000/health

进入基金工作台：在页面顶部切换到“基金工作台”，输入 6 位基金代码（如 `510300`、`000001`、`110022`）即可查询。

## 启动参数

| 参数 | 作用 |
| --- | --- |
| `--skip-install` | 跳过前端依赖安装检查 |
| `--install` | 强制重新安装/校验前端依赖 |
| `--no-browser` | 启动后不自动打开浏览器 |

Windows `start.ps1` 使用 PowerShell 参数风格：

```powershell
./start.ps1 -Install -NoBrowser
```

Linux/macOS `start.sh` 使用长参数风格：

```bash
./start.sh --install --no-browser
```

## 停止服务

Windows：

```bat
stop.bat
```

Linux/macOS：

```bash
chmod +x stop.sh
./stop.sh
```

终止脚本会按端口 `3000`、`8000` 以及项目进程命令行特征停止完整进程树，包括 `next dev`、`uvicorn --reload` 的子进程，并回收定时任务守护进程（`.logs/scheduler-worker.pid`）。

## 手动开发启动

```bash
corepack pnpm dev
```

行情/基金数据侧车单独启动（Windows PowerShell）：

```powershell
corepack pnpm dev:data
```

同时启动 Web 与行情/基金数据侧车（依赖 PowerShell，适用于 Windows）：

```powershell
corepack pnpm dev:all
```

Linux/macOS 建议使用 `./start.sh`，或手动启动行情/基金数据侧车：

```bash
python -m uvicorn app.main:app --app-dir data-service --host 127.0.0.1 --port 8000
```

## 环境变量

复制 `.env.example` 为 `.env` 后按需填写：

| 变量 | 是否必需 | 说明 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | 可选 | DeepSeek LLM 密钥；未配置时 AI 报告使用本地确定性报告 |
| `DEEPSEEK_BASE_URL` | 可选 | OpenAI 兼容接口地址，默认 `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | 可选 | 默认 `deepseek-chat` |
| `DEEPSEEK_ANALYSIS_TIMEOUT_MS` | 可选 | 单次 AI 分析/对话的模型调用超时（毫秒），默认 `45000` |
| `TAVILY_API_KEY` | 可选 | 外部资讯搜索；未配置时使用确定性资讯 |
| `DATABASE_URL` | 可选 | 本地 Docker PostgreSQL 连接串；未配置时使用内存，自选股使用本地文件回退 |
| `R2_ACCOUNT_ID` | 可选 | Cloudflare R2 账户 ID |
| `R2_ACCESS_KEY_ID` | 可选 | R2 访问密钥 |
| `R2_SECRET_ACCESS_KEY` | 可选 | R2 访问密钥 |
| `R2_BUCKET_NAME` | 可选 | R2 桶名称 |
| `R2_PUBLIC_URL` | 可选 | R2 公共访问地址 |
| `DATA_SERVICE_URL` | 可选 | 行情/基金数据侧车地址，默认 `http://127.0.0.1:8000` |
| `CLEANUP_CRON` | 可选 | 资讯清理定时表达式，默认 `0 3 * * *` |
| `REFRESH_CRON` | 可选 | 个股行情刷新定时表达式，默认 `30 3 * * *` |
| `FUND_REFRESH_CRON` | 可选 | 基金数据刷新定时表达式，默认 `45 3 * * *` |
| `FUND_SETTLE_CRON` | 可选 | 持有基金净值结算定时表达式（官方净值落定：手动持仓跨日推进 + 估算锚定的校准重锚），默认 `30 21 * * 1-5`（交易日 21:30） |
| `ALERT_CRON` | 可选 | 预警扫描定时表达式，默认 `*/30 9-15 * * 1-5`（交易日每 30 分钟，实际仅在有效时段触发） |
| `ALERT_MAX_TARGETS` | 可选 | 可配置预警任务的自选标的数量上限（股票 + 基金合计），默认 `10` |
| `ALERT_EMAIL_TO` | 可选 | 默认收件邮箱；也可在预警中心面板里修改并保存在本地 |
| `QUOTE_STREAM_INTERVAL_MS` | 可选 | 实时行情交易时段推送间隔（毫秒），下限 `3000`，默认 `5000` |
| `QUOTE_STREAM_IDLE_INTERVAL_MS` | 可选 | 实时行情非交易时段保活间隔（毫秒），下限 `10000`，默认 `60000` |
| `QUOTE_STREAM_MAX_CODES` | 可选 | 实时行情单次批量拉取的代码上限，默认 `50` |
| `DAILY_STOCK_REPORT_CRON` | 可选 | 股市日报探测表达式，默认 `*/10 15-16 * * 1-5`（交易日 15:10 起每 10 分钟探测，数据就绪即生成） |
| `DAILY_FUND_REPORT_CRON` | 可选 | 基金日报探测表达式，默认 `*/20 20-23 * * 1-5`（交易日晚间每 20 分钟探测净值是否公布） |
| `DAILY_REPORT_TIMEOUT_MS` | 可选 | 单篇日报的模型生成超时（毫秒），默认 `60000` |
| `DAILY_REPORT_EMAIL_TO` | 可选 | 日报摘要邮件收件人；留空时回退 `ALERT_EMAIL_TO`，两者都没配置则跳过推送 |
| `SCHEDULER_TOKEN` | 可选 | 调度补跑写接口令牌（请求头 `x-scheduler-token`）；留空时只允许本机来源触发 |
| `SCHEDULER_BASE_URL` | 可选 | 独立守护进程目标地址，默认 `http://127.0.0.1:3000` |
| `SCHEDULER_WORKER_INTERVAL_S` | 可选 | 守护进程轮询间隔（秒），默认 `300` |
| `SCHEDULER_WORKER_MAX_FAILURES` | 可选 | 守护进程连续失败上限，达到后退出，默认 `5` |
| `SKIP_INPROCESS_SCHEDULER` | 可选 | 设为 `1` 时不再注册进程内 cron，只依赖独立守护进程补跑 |
| `SCHEDULER_TIMEZONE` | 可选 | 调度任务时区（IANA 名称），默认 `Asia/Shanghai` |
| `SKIP_SCHEDULER_WORKER` | 可选 | 设为 `1` 时一键启动脚本不拉起独立守护进程 |
| `SMTP_HOST` | 可选 | SMTP 服务器地址，QQ 邮箱为 `smtp.qq.com`；未配置时预警仅页面展示，不发送邮件 |
| `SMTP_PORT` | 可选 | SMTP 端口，默认 `465`（465 使用 SSL，其它端口使用 STARTTLS） |
| `SMTP_USER` | 可选 | SMTP 账号，QQ 邮箱填 `你的QQ号@qq.com` |
| `SMTP_PASS` | 可选 | SMTP 授权码（QQ 邮箱为 16 位授权码，不是登录密码） |
| `SMTP_FROM` | 可选 | 发件人地址，默认与 `SMTP_USER` 相同 |

> `DATABASE_URL` 未携带端口时会自动补默认端口 `5432`；本地 Docker 配置默认使用 `postgresql://postgres:postgres@localhost:5432/stock_analysis`。
>
> 预警邮件：SMTP 账号与授权码只写入本地 `.env`，仓库仅保留 `.env.example` 占位；未配置 SMTP 时预警事件照常记录，只是不发送邮件。

## 定时任务守护

- 服务端进程启动时会自动注册定时任务（`src/instrumentation.ts`），不再依赖「先访问管理接口」；调度表达式统一来自 `src/lib/scheduler-guard.ts` 的 `SCHEDULE_TABLE`。
- `GET /api/admin/scheduler/status` 返回每个任务的最近运行时间、过期状态与跳过原因；`POST /api/admin/scheduler/tick` 只补跑过期任务，单项失败不影响其它任务。
- 独立守护进程：`corepack pnpm scheduler:worker`（等价于 `node scripts/scheduler-worker.mjs`）定期探测 `/api/health` 与调度状态，发现停摆就触发补跑。
  - `--once` 只检查一轮后退出（应用未启动时安全退出并打印原因），`--interval` 调整轮询间隔，`--max-failures` 控制连续失败上限。
  - Windows 可用 `scripts/start-scheduler.ps1` 管理进程（pid 文件 `.logs/scheduler-worker.pid`），加 `-Stop` 停止。
  - `start.bat` / `start.ps1` / `start.sh` 会随应用一起拉起守护进程，设置 `SKIP_SCHEDULER_WORKER=1` 可关闭。
- 定位：守护进程做「发现停摆 + 补齐过期任务」，不负责拉起已退出的 Web 进程（进程级守护需要 supervisor / 计划任务）。

## 数据与降级

- 未配置 `DATABASE_URL` 时，分析报告、资讯、会话等使用进程内内存；自选股会写入 `.data/watchlist.json`，自选基金会写入 `.data/fund-watchlist.json`，重启后仍保留。
- 预警规则与事件同样支持回退：数据库不可用时写入 `.data/alerts.json`，邮件收件人与开关写入 `.data/alert-settings.json`，重启后仍保留。
- 持仓组合同样支持回退：个股写入 `.data/stock-portfolio.json`，基金写入 `.data/fund-positions.json`，重启后仍保留。
- 交易日历优先取侧车 AkShare 数据；侧车未启动时退回「工作日」近似（无法识别法定节假日），面板会标注当前日历来源。
- AI 收盘日报优先写入 Cloudflare R2（对象键 `daily-reports/{kind}/{date}.json`）；R2 未配置或写入失败时回退到 `.data/daily-reports/`，面板会标注「云端存储 / 本地存储」。全市场涨跌家数与行业板块数据来自侧车 AkShare 接口，上游不可用时日报正文与面板会显式标注缺失项。
- 基金盘中估算：场内基金（ETF/LOF）用腾讯实时价与 IOPV，覆盖稳定；场外基金来自东财估值排行，覆盖有限，取不到估算时该次判定按「缺少指标观测值」跳过，不会用降级数据报假警。
- 未配置 `TAVILY_API_KEY` 时，资讯使用本地演示数据。
- 未配置 `DEEPSEEK_API_KEY` 或模型输出未包含具体行情/资讯数据时，AI 分析自动回退到包含最新价、K 线和指标的教学式报告。
- R2 快照写入有超时保护，失败不会阻塞主流程。
- 本地生成文件 `.env`、`.logs/`、`.data/` 不会提交到仓库。

## 数据一致性清理

- 场景：数据库（或 R2）断连期间应用会把数据降级写入 `.data/`，且降级开关是「进程内一次性切换」，恢复后不会自动合并。
- 能力：数据库确认可用后，把本地降级文件里的确定性事实数据（自选、持仓、预警规则、AI 日报）回填到数据库/R2，把断连期间产生的模板垃圾（空文件、非法条目、模板降级日报、悬空索引）清除出 `.data`。
- 判定基准：以「数据更新时间」为准，而不是单纯比较内容差异 —— 内容指纹一致 → 冗余；数据库最后改动时间早于本地文件修改时间 → 数据库版本落后，以本地为准覆盖；数据库更新 → 本地视为老旧冗余（文件仍归档在 `.data/quarantine/`）。任一侧时间读不到时保守处理，不覆盖数据库。
- 触发方式：工作台顶部右上角「数据一致性」按钮，或命令行 `corepack pnpm data:cleanup`（默认只扫描）与 `corepack pnpm data:cleanup --apply`（执行）。
- 安全约束：数据库不可用、关键表缺失或迁移落后时拒绝执行；执行前先出扫描计划；所有清除都移入 `.data/quarantine/<时间戳>/` 可人工回滚；`.data` 下的日志与未识别文件只报告不处理。
- 实现与判定规则见 `docs/data-consistency-cleanup-plan.md`。

## 常用命令

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm test:coverage
corepack pnpm build
corepack pnpm dev
```

先启动本地数据库：

```powershell
./scripts/db-up.ps1
```

再执行数据库相关命令（仅在配置真实 `DATABASE_URL` 后使用）：

```bash
corepack pnpm db:generate
corepack pnpm db:migrate
corepack pnpm db:studio
```

停止本地数据库：

```powershell
./scripts/db-down.ps1
```

## 健康检查

- `GET http://127.0.0.1:3000/api/health`
- `GET http://127.0.0.1:8000/health`
- `GET http://127.0.0.1:3000/api/funds/510300/metrics?range=all`
- `GET http://127.0.0.1:3000/api/fund-positions`（持有基金估值与组合汇总）
- `GET http://127.0.0.1:8000/index/quote?codes=sh000001,sz399001,sz399006`
- `GET http://127.0.0.1:8000/market/breadth`
- `GET http://127.0.0.1:8000/market/sectors?limit=5`
- `GET http://127.0.0.1:8000/index/kline?code=sh000001&limit=60`（含成交额 `amount`）
- `GET http://127.0.0.1:8000/market/breadth?date=2026-09-11`（历史日期回补：乐咕快照日期一致用真实家数，否则为行业板块口径近似）
- `GET http://127.0.0.1:8000/market/sectors?date=2026-09-11`（历史日期走同花顺行业板块指数回补，90 个板块约 13 秒，按日期缓存）
- `GET http://127.0.0.1:8000/market/sectors?date=2026-09-11&history=1`（强制同花顺历史口径，返回各板块前一日涨跌幅与 `comparison` 轮动块供日报对比）
- `GET http://127.0.0.1:3000/api/daily-reports?kind=stock`
- `POST http://127.0.0.1:3000/api/admin/daily-reports/backfill`（请求体 `{"kind":"stock","days":5,"force":false}`，按最近 N 个交易日回补）
- `DELETE http://127.0.0.1:3000/api/admin/daily-reports/stock/2026-09-09`（删除单日日报并同步索引）

## 免责声明

本项目仅供学习参考，不构成投资建议。所有行情、资讯与 AI 输出均可能存在延迟或误差，请独立判断并自行承担盈亏。
