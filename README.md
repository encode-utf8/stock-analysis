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

> `DATABASE_URL` 未携带端口时会自动补默认端口 `5432`；本地 Docker 配置默认使用 `postgresql://postgres:postgres@localhost:5432/stock_analysis`。

## 数据与降级

- 未配置 `DATABASE_URL` 时，分析报告、资讯、会话等使用进程内内存；自选股会写入 `.data/watchlist.json`，自选基金会写入 `.data/fund-watchlist.json`，重启后仍保留。
- 未配置 `TAVILY_API_KEY` 时，资讯使用本地演示数据。
- 未配置 `DEEPSEEK_API_KEY` 或模型输出未包含具体行情/资讯数据时，AI 分析自动回退到包含最新价、K 线和指标的教学式报告。
- R2 快照写入有超时保护，失败不会阻塞主流程。
- 本地生成文件 `.env`、`.logs/`、`.data/` 不会提交到仓库。

## 常用命令

```bash
corepack pnpm typecheck
corepack pnpm lint
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
