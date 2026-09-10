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
- 基金工作台：支持基金档案、历史净值、场内实时/场外估算、季度持仓、回撤与风险指标。
- 基金回撤：本地计算区间收益、年化收益、波动、夏普/索提诺/卡玛、最大回撤与回撤修复耗时，并在净值曲线中叠加区间矩形。
- 基金复盘：按 7/30/90 天回看基金 AI 分析与对话时间线，仅用于学习。
- 基金数据源：数据源健康面板展示基金上游状态，支持手动刷新基金档案、净值、持仓与风险指标。
- 基金对比：输入 2–5 个基金代码，按同一区间横向比较净值、收益、波动、回撤与风险收益指标，并提供归一化累计收益曲线叠加。
- 基金组合：支持百分比权重、目标权重区间或持仓份额输入，按共同交易日合成组合，展示组合收益/回撤曲线、目标权重区间、再平衡偏离提醒与单基金风险贡献拆解。
- 基金定投回测：支持单基金与多基金组合定投、每日/每周/每两周/每月频率，展示收益率曲线、最大回撤修复区间、扣款日收益差异，并对比定投与一次性买入表现。
- 自选池预警（预警中心）：为最多 3 个自选股/自选基金配置条件（单条件或 2–4 个条件 AND/OR 组合）；股票用行情快照，基金用盘中估算净值（场内实时价 / 场外用新浪财经盘中估值，取不到时回退东财估值排行），在交易日盘中（09:30–11:30、13:00–15:00）每 30 分钟扫描一次；接入 AkShare 交易日历自动跳过周末与法定节假日，同一规则 12 小时冷却，命中后写入事件流并可按需发送摘要邮件。预警面板跟随所在工作台（个股台看股票预警、基金台看基金预警），左侧自选池增删后下拉选项实时同步，无需刷新页面。
- 交易日历：侧车 `/trading-calendar` 基于 AkShare 交易日历提供交易日查询，预警判定与面板状态共用；侧车不可用时自动回退「工作日」近似并标注来源。

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

终止脚本会按端口 `3000`、`8000` 以及项目进程命令行特征停止完整进程树，包括 `next dev` 和 `uvicorn --reload` 的子进程。

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
| `ALERT_CRON` | 可选 | 预警扫描定时表达式，默认 `*/30 9-15 * * 1-5`（交易日每 30 分钟，实际仅在有效时段触发） |
| `ALERT_MAX_TARGETS` | 可选 | 可配置预警任务的自选标的数量上限（股票 + 基金合计），默认 `3` |
| `ALERT_EMAIL_TO` | 可选 | 默认收件邮箱；也可在预警中心面板里修改并保存在本地 |
| `SMTP_HOST` | 可选 | SMTP 服务器地址，QQ 邮箱为 `smtp.qq.com`；未配置时预警仅页面展示，不发送邮件 |
| `SMTP_PORT` | 可选 | SMTP 端口，默认 `465`（465 使用 SSL，其它端口使用 STARTTLS） |
| `SMTP_USER` | 可选 | SMTP 账号，QQ 邮箱填 `你的QQ号@qq.com` |
| `SMTP_PASS` | 可选 | SMTP 授权码（QQ 邮箱为 16 位授权码，不是登录密码） |
| `SMTP_FROM` | 可选 | 发件人地址，默认与 `SMTP_USER` 相同 |

> `DATABASE_URL` 未携带端口时会自动补默认端口 `5432`；本地 Docker 配置默认使用 `postgresql://postgres:postgres@localhost:5432/stock_analysis`。
>
> 预警邮件：SMTP 账号与授权码只写入本地 `.env`，仓库仅保留 `.env.example` 占位；未配置 SMTP 时预警事件照常记录，只是不发送邮件。

## 数据与降级

- 未配置 `DATABASE_URL` 时，分析报告、资讯、会话等使用进程内内存；自选股会写入 `.data/watchlist.json`，自选基金会写入 `.data/fund-watchlist.json`，重启后仍保留。
- 预警规则与事件同样支持回退：数据库不可用时写入 `.data/alerts.json`，邮件收件人与开关写入 `.data/alert-settings.json`，重启后仍保留。
- 交易日历优先取侧车 AkShare 数据；侧车未启动时退回「工作日」近似（无法识别法定节假日），面板会标注当前日历来源。
- 基金盘中估算：场内基金（ETF/LOF）用腾讯实时价与 IOPV，覆盖稳定；场外基金来自东财估值排行，覆盖有限，取不到估算时该次判定按「缺少指标观测值」跳过，不会用降级数据报假警。
- 未配置 `TAVILY_API_KEY` 时，资讯使用本地演示数据。
- 未配置 `DEEPSEEK_API_KEY` 或模型输出未包含具体行情/资讯数据时，AI 分析自动回退到包含最新价、K 线和指标的教学式报告。
- R2 快照写入有超时保护，失败不会阻塞主流程。
- 本地生成文件 `.env`、`.logs/`、`.data/` 不会提交到仓库。

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

## 免责声明

本项目仅供学习参考，不构成投资建议。所有行情、资讯与 AI 输出均可能存在延迟或误差，请独立判断并自行承担盈亏。
