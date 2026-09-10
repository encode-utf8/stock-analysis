# M5 集成与整体验收清单

- 关联文档：`docs/plan.md`、`docs/design.md`、`docs/checklists/05-feature-integration-polish.md`
- 分支：`feature/integration-polish`
- 负责阶段：P6 打磨与整体验收

## 验收项

- [x] 已创建 `integration` 并合并 M1–M4 功能分支
- [x] 已基于集成分支创建 `feature/integration-polish`
- [x] 盘面、资讯、分析、对话、持久化/清理全链路联调通过
- [x] 沪深北三市场示例股票查询正常
- [x] 行情、K 线、MA/MACD/KDJ/RSI/BOLL 指标返回正常
- [x] AI 分析报告含来源、影响周期与风险提示
- [x] 对话 SSE 流式输出、工具调用与 3 轮上下文回看正常
- [x] 历史报告与历史会话时间线可回看
- [x] 行情数据时间、新鲜度、来源与免责声明已展示
- [x] 可观测性指标含外部调用次数、失败率、缓存复用命中率
- [x] 手动刷新与到期资讯清理任务可执行并记录日志
- [x] 未配置外部密钥时自动降级为演示数据并标注
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] Python 侧车 `/quote`、`/kline`、`/health` 已联调通过
- [x] 代码注释为中文，未提交真实密钥

## 验证命令

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm dev
python -m uvicorn app.main:app --app-dir data-service --host 127.0.0.1 --port 8000
```

## 完成记录

- 完成日期：2026-09-01
- 结果：M1–M5 全部验收通过
- 备注：密钥只写入本地 `.env`，仓库仅保留 `.env.example`。


## 真实环境补充验证（2026-09-01）
- [x] Neon 数据库连接成功并应用 Drizzle 迁移
- [x] Drizzle store 写入/读取验证通过
- [x] 资讯清理真实软删除验证通过
- [x] Tavily/DeepSeek 真实调用验证通过
- [x] corepack pnpm build 通过
- [ ] Cloudflare R2 真实写入：待修正 R2_ACCOUNT_ID / R2_SECRET_ACCESS_KEY 格式


## R2 复测通过（2026-09-01）
- [x] R2 字段格式校验通过
- [x] R2 Put/Get/Delete 自检通过
- [x] AI 分析报告快照已写入 R2 并回填 r2_key


## 下一阶段 MVP 底座（page 拆分与契约冻结）

- 关联文档：`docs/plan.md`、`docs/design.md`
- 分支：`feature/next-mvp`
- 目标：仅做结构拆分与契约新增，页面功能与展示效果无回归

### 验收项

- [x] 已确认开发分支为 `feature/next-mvp`，未直接在 `main` 上修改
- [x] `src/app/page.tsx` 已拆分为 10 个 panel 组件
- [x] 页面容器保留全部状态管理与旧交互逻辑
- [x] 新增 `DataSourceStatus`、`SchedulerJob`、`ChatStreamEvent` 共享契约
- [x] 未破坏既有共享类型字段
- [x] `data-service` `/quote`、`/kline` 已补充标准响应契约注释
- [x] 未实现或接入 AkShare
- [x] 未提交任何真实密钥

### 验证命令

```bash
corepack pnpm install
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
```

### 完成记录

- 完成日期：2026-09-01
- 结果：install、typecheck、lint、build 全部通过
- 备注：等待主控合并到 main。


## M6-M8 P7 集成验收（已完成，2026-09-03）

- 关联文档：`docs/plan.md`、`docs/next-phase-dev-plan.md`、`docs/design.md`
- 分支：`feature/p7-base`、`feature/p7-watchlist`、`feature/p7-replay`、`feature/p7-datasource-scheduler-dashboard`、`feature/p7-integration`
- 目标：完成 P7 里程碑 M6-M8，并确认 M1-M5 无回归

### 验收项

- [x] M6 自选股：添加、删除、排序、备注与切换 3 只以上正常，刷新可恢复，切换后全链路股票一致
- [x] M7 历史复盘：`/api/replay/stats` 与 `/api/replay/timeline` 可回看，统计口径清晰，仅学习用途且无收益承诺
- [x] M8 数据源健康：四类数据源状态与降级原因可见，手动 refresh/cleanup 后 `job_runs` 可查
- [x] M1-M5 回归：health/stock/quote/kline/indicators/news/reports/conversations/observability 均正常
- [x] `corepack pnpm typecheck`、`lint`、`build` 全部通过
- [x] 未提交真实密钥，密钥仅保留在 `.env.example` 的占位值

### 完成记录

- 完成日期：2026-09-03
- 结果：M6-M8 全部通过，M1-M5 无回归，typecheck、lint、build 通过
- 详细记录：`docs/checklists/07-feature-datasource-scheduler-dashboard.md`、`docs/checklists/08-feature-p7-integration.md`


## 一键启动脚本验收（2026-09-03）

- 关联文档：`README.md`
- 分支：`feature/one-click-launch`
- 目标：为 Windows/Linux 个人本地使用提供一键启动脚本，A 股行情可无密钥降级启动

### 验收项

- [x] Windows 脚本 `start.ps1` 存在，可检查 Node.js、pnpm、`.env`、Python 环境
- [x] Linux 脚本 `start.sh` 存在，可检查 Node.js、pnpm、`.env`、Python 环境
- [x] 脚本能优先复用 conda 的 `stock-analysis` 环境或本地 `.venv`
- [x] 脚本会安装行情侧车基础依赖，并可选安装 AkShare
- [x] 脚本会启动 `127.0.0.1:8000` 行情侧车并等待健康检查
- [x] 脚本会启动 `127.0.0.1:3000` Web 前端并支持 Ctrl+C 清理
- [x] `.logs/` 日志目录已加入 `.gitignore`
- [x] `README.md` 已补充一键启动用法
- [x] `start.ps1` PowerShell 语法检查通过
- [x] `start.sh` Bash 语法检查通过
- [ ] 未提交真实密钥，仅使用 `.env.example` 占位值

### 验证方式

- Windows：`start.bat` 或 `powershell -NoProfile -ExecutionPolicy Bypass -File ./start.ps1`
- Linux：`./start.sh`
- 健康检查：`GET http://127.0.0.1:8000/health`、`GET http://127.0.0.1:3000/api/health`

### 完成记录

- 完成日期：2026-09-03
- 结果：脚本已创建并完成语法检查；真实端到端启动需在目标系统验证
- 遗留事项：AkShare 为可选依赖，失败时仍通过 Tencent 行情提供沪深 A 股真实数据


## Windows bat 入口更新验收（2026-09-03）

- 关联文档：`README.md`
- 分支：`feature/bat-launch`
- 目标：将 Windows 推荐入口从 PowerShell 调整为更易双击执行的 `start.bat`

### 验收项

- [x] 新增 `start.bat`，作为 Windows 一键启动推荐入口
- [x] `start.bat` 支持 `--skip-install`、`--no-browser` 参数
- [x] `start.bat` 会检查 Node.js、pnpm/corepack、`.env` 与前端依赖
- [x] 新增 `scripts/start-data.ps1` 助手，负责 Python 环境、依赖安装与行情侧车启动
- [x] `start.bat` 在 Web 退出后会清理行情侧车进程
- [x] 行情侧车带看护进程，Ctrl+C 终止 bat 后仍会自动清理 Python 进程
- [x] `package.json` 的 `start:win` 改为 `cmd /c start.bat`
- [x] `README.md` 已将 `start.bat` 标为 Windows 推荐方式
- [x] `start.bat` 基础语法检查通过
- [x] `scripts/start-data.ps1` PowerShell 语法检查通过
- [ ] 未提交真实密钥，仅使用 `.env.example` 占位值

### 验证方式

- Windows 双击：直接运行 `start.bat`
- Windows 命令：`pnpm start:win`
- 健康检查：`GET http://127.0.0.1:8000/health`、`GET http://127.0.0.1:3000/api/health`

### 完成记录

- 完成日期：2026-09-03
- 结果：bat 入口与助手脚本已创建并完成语法与端到端启动检查
- 遗留事项：真实端到端启动依赖目标 Windows 环境的 Node.js、Python 与网络条件
## AI 分析回退问题修复（2026-09-04）

- 关联文档：`docs/spec.md` FR-05、`docs/checklists/02-feature-ai-analysis.md`
- 分支：`fix/ai-analysis-llm-fallback`
- 目标：确保“生成 AI 分析”把具体行情、指标、K 线与资讯真正交给模型解析，而不是静默回退到只数条数的本地模板。

### 验收项

- [x] 模型超时从 6 秒恢复为可配置长超时，避免正常报告因超时回退
- [x] prompt 明确携带股票名称、行业、行情、指标、K 线、资讯标题/摘要/来源/影响周期
- [x] prompt 明确禁止只统计条数或复述 JSON，必须做因果与情绪解析
- [x] LLM 输出校验改为语义化宽松判断，不再因标题改写、数字格式差异而误判为套话
- [x] 未启用 AI 时回退模板明确标注“本地数据摘要”，不与 AI 报告混淆
- [x] 前端“生成 AI 分析”请求超时与后端模型超时匹配，避免客户端提前断开
- [x] `pnpm typecheck` 通过
- [x] `pnpm lint` 通过
- [x] `pnpm build` 通过
- [x] 未提交真实密钥，仅保留 `.env.example` 占位值

### 验证方式

- `pnpm typecheck && pnpm lint && pnpm build`
- 启动服务后点击“生成 AI 分析”，报告应引用个股具体价格、指标、K 线和资讯标题，而不是只数利好/利空/中性条数。

### 完成记录

- 完成日期：2026-09-04
- 结果：typecheck、lint、build 全部通过；已恢复长超时并放宽输出校验，AI 报告不再因格式差异误回退。
- 遗留事项：真实点击验收需在有 DeepSeek 密钥的本机启动服务后确认模型输出确实被采用。
## AI 分析模型配置与流式响应修复（2026-09-04，已提交）

- 关联文档：`docs/spec.md` FR-05、`docs/checklists/02-feature-ai-analysis.md`
- 目标：修复 `DEEPSEEK_MODEL` 配置错误导致的空回复，并为“生成 AI 分析”提供流式响应。

### 验收项

- [x] 确认 `deepseek-v4-pro` 返回空内容，`deepseek-chat` 正常
- [x] 本地 `.env` 的 `DEEPSEEK_MODEL` 改为 `deepseek-chat`
- [x] 新增 `/api/stocks/:code/analysis/stream` SSE 接口
- [x] 后端 `streamAnalysis` 边生成边返回 delta，结束返回持久化报告
- [x] 前端生成分析时实时累加内容，完成后替换为正式报告
- [x] 复用统一分析报告构建与持久化逻辑
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过
- [x] 未提交真实密钥，仅本地修改 `.env`

### 验证方式

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 启动服务后点击“生成 AI 分析”，应看到报告内容逐步出现，并最终写入历史时间线。
## 历史分析与资讯面板 UI 改造（2026-09-04，已提交）

- 关联文档：`docs/spec.md` FR-05
- 目标：优化“历史分析时间线”与“资讯与影响周期”的展示方式，支持 Markdown 与等高等滚动。

### 验收项

- [x] 资讯与影响周期改为固定高度、每页 4 条的分页功能区
- [x] 历史分析时间线改为摘要卡片，展示时间、引用数和前几句内容
- [x] 点击历史报告卡片弹出浮窗，展示完整报告
- [x] DeepSeek 返回的 Markdown 使用 `react-markdown` + `remark-gfm` 渲染
- [x] 历史分析内容区与左侧资讯区等高，内容不足时可上下滚动
- [x] 新增 Markdown 基础样式，支持标题、列表、引用、代码块、表格等
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过
- [x] 已提交仓库

### 验证方式

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 启动服务后查询股票，观察左侧资讯分页与右侧历史分析摘要卡片，点击卡片确认 Markdown 浮窗可滚动展示。
## 周期内 AI 分析与复盘时间线 UI 调整（2026-09-04，已提交）

- 目标：将右侧标题改为“周期内 AI 分析”，并把复盘时间线改成摘要卡片 + 弹窗详情。

### 验收项

- [x] “资讯与影响周期”右侧面板标题改为“周期内 AI 分析”
- [x] 周期内 AI 分析与资讯区等高，内容不足时可上下滚动
- [x] 历史复盘时间线查询后仅展示摘要卡片与内容前几句
- [x] 点击复盘时间线卡片弹出浮窗展示具体信息
- [x] AI 分析详情使用 Markdown 渲染，对话详情保留原始换行
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过
- [x] 已提交仓库

### 验证方式

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 查询股票后检查右侧标题与等高滚动；在“历史复盘与命中率统计”查询时间范围，点击时间线卡片查看弹窗详情。
## 资讯按需搜索与 AI 分析范围联动（2026-09-04，已提交）

- 目标：真实资讯不混入演示数据；资讯搜索与股票查询解耦；AI 分析按当前资讯范围灵活组合。

### 验收项

- [x] 新增 `searchNews(code, days)` 按时间范围搜索真实资讯
- [x] 有真实资讯时过滤掉“演示资讯源”等降级数据
- [x] 资讯接口支持 7/14/30/90/180/365 天范围筛选
- [x] 查询股票不再自动抓取资讯，资讯改为带选项的搜索按钮
- [x] 未搜索资讯时可直接生成纯股票数据分析
- [x] 生成 AI 分析时把当前页面的资讯数组传给分析接口
- [x] 分析提示词根据是否有资讯动态生成，灵活结合当前资讯范围
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过
- [x] 已提交仓库

### 验证方式

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 查询股票后不点击搜索直接生成 AI 分析，应只基于股票数据分析；选择不同时间范围搜索后再分析，应结合该范围资讯。

## 资讯日期范围与相关性调优（2026-09-05，已提交）

- 目标：修复不同时间范围返回相同资讯的问题，并过滤掉与目标股票无关的外部噪音资讯。

### 验收项

- [x] Tavily 使用 `topic: "news"` 与 `days`，不再同时传 `start_date/end_date` 触发 400
- [x] 按 `published_date` 做本地二次日期过滤，缺日期或非法日期不再伪造发布时间
- [x] 强制刷新时优先采用本次真实结果，避免旧缓存回填
- [x] 为 688256 配置寒武纪搜索别名与精确 Tavily 查询表达式
- [x] 按标题、摘要、URL 过滤不含目标股票关键词的资讯
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过
- [x] 已提交仓库

### 验证方式

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 查询 688256 并分别选择 7/14/30/90/180/365 天，应看到结果条数与发布日期变化；一个月资讯不应再包含 MongoDB、药明康德、中国海油等无关公司。

## 左侧功能选项页与模块化展示（2026-09-06，待验收）

- 目标：将当前前端全部展示内容收拢到左侧可隐藏的功能选项页；勾选模块后再展示对应信息区；股票代码输入框置于选项页顶部，空输入回退默认股票代码 600519。
- 分支：`feature/sidebar-function-options`

### 验收项

- [x] 页面默认展示左侧功能选项页，且可通过“隐藏/功能选项”收起与展开
- [x] 股票代码输入框位于选项页最顶部，空输入查询时使用默认 600519
- [x] 未勾选任何模块时主区域不展示旧有面板，仅展示引导提示
- [x] 勾选行情概览后仅展示行情快照与数据时间/来源
- [x] 勾选 K 线走势后仅展示 K 线与周期/复权控件
- [x] 勾选技术指标后仅展示 MA/MACD/KDJ/RSI/BOLL 指标
- [x] 勾选资讯搜索后仅展示资讯检索模块
- [x] 勾选周期内 AI 分析后仅展示 AI 报告列表
- [x] 勾选对话助手后仅展示多轮对话模块
- [x] 勾选历史会话时间线后仅展示会话回看
- [x] 勾选系统可观测性、自选股、历史复盘、数据源与调度、免责声明后分别独立展示对应模块
- [x] 全选/清空模块按钮可一次性切换全部展示状态
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过
- [x] 功能分支已推送并合并回 `main`

### 验证方式

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 页面加载后先清空股票输入，勾选行情概览，确认默认展示 600519；再逐个勾选模块，确认每个功能独立出现。

## 左侧自选股、自适应与删除功能（2026-09-06，待验收）

- 目标：资讯与 AI 分析无结果时自适应缩小；周期内 AI 分析只展示当前结果；AI 分析/历史复盘支持删除；自选股移入左侧并新增分组展开。
- 分支：`feature/sidebar-watchlist-delete-layout`

### 验收项

- [x] “资讯与影响周期”无资讯时不再占据固定 560px 高度，仅展示“无资讯。”并自适应缩小
- [x] “周期内 AI 分析”只展示当前最新分析结果，不堆叠历史结果
- [x] “周期内 AI 分析”无结果时自适应缩小，并提供删除当前结果按钮
- [x] 删除 AI 分析报告后服务端持久化删除，页面列表同步更新
- [x] “历史复盘与命中率统计”时间线记录可删除分析记录与会话记录
- [x] 删除历史复盘记录后统计与时间线重新加载
- [x] 自选股完全位于左侧功能选项页内，且位于股票代码输入之后
- [x] 自选股不再作为右侧可勾选模块展示
- [x] 新增自选股不填分组时归入“默认”分组
- [x] 自选股按分组展示，并可展开/收起分组
- [x] 数据库迁移 `0003_lovely_madame_masque.sql` 已生成
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过
- [x] 功能分支已推送并合并回 `main`

### 验证方式

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 页面加载后不搜索资讯，确认资讯区高度收缩；生成 AI 分析后只出现一条当前结果并可删除；在历史复盘时间线删除记录后列表刷新；在左侧添加不同分组自选股并展开/收起分组。

## Docker 本地 PostgreSQL 环境（2026-09-06，待验收）

- 目标：使用 Windows Docker Desktop 启动本地 PostgreSQL，替代远程 Neon；项目配置与启动方式同步调整。
- 分支：`feature/docker-postgres-env`

### 验收项

- [x] 新增 `docker-compose.yml`，定义本地 PostgreSQL 16 服务与数据卷
- [x] 提供 `scripts/db-up.ps1` 与 `scripts/db-down.ps1` 便捷脚本
- [x] `.env.example` 切换为本地 `localhost` 连接串，不再默认 `sslmode=require`
- [x] `.env` 的 `DATABASE_URL` 指向本地 Docker PostgreSQL
- [x] `hasRealDatabaseUrl()` 允许识别 `localhost/127.0.0.1` 的真实数据库配置
- [x] `docker compose up -d postgres` 成功启动并健康检查通过
- [x] `corepack pnpm db:migrate` 成功应用全部迁移
- [x] 数据库可连通，真实 PostgreSQL 存储路径可用
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过
- [x] 功能分支已推送并合并回 `main`

### 验证方式

- `docker compose up -d postgres && docker compose ps`
- `corepack pnpm db:migrate`
- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`

## 左侧栏悬停收拢与学习台实时时间（2026-09-06，待验收）

- 目标：将“功能选项”改为语雀/飞书式左侧栏，支持点击开合与光标移动到边缘时感应展开；学习台右上角时间改为实时刷新。
- 分支：`feature/sidebar-hover-collapse-live-clock`

### 验收项

- [x] 左侧功能栏不再使用单独的“功能选项”按钮作为唯一展开入口
- [x] 侧栏收拢后保留可点击的窄轨区域，点击可展开
- [x] 鼠标移动到收拢后的左边缘时侧栏自动展开
- [x] 鼠标移出侧栏且未锁定展开时，侧栏自动收拢
- [x] 侧栏展开后可通过边缘/标题区控件再次收拢
- [x] 学习台右上角“当前时间”每秒钟自动刷新，而不是仅显示页面打开时间
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过
- [x] 功能分支已推送并合并回 `main`

### 验证方式

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 页面加载后确认学习台右上角时间每秒变化；收拢侧栏后鼠标移到最左边缘应自动展开，移出后自动收拢；点击窄轨/侧栏控件可手动展开或收拢。

## 免责声明固定至右侧底部（2026-09-06，待验收）

- 目标：将“免责声明”从功能选项中移除，改为固定在右侧信息区底部始终展示。
- 分支：`feature/move-disclaimer-footer`

### 验收项

- [x] 功能选项列表中不再出现“免责声明”模块
- [x] 无论是否勾选功能模块，右侧区域底部始终展示免责声明与数据更新时间
- [x] 全选/清空功能模块时不会影响免责声明展示
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过
- [x] 功能分支已推送并合并回 `main`

### 验证方式

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 页面加载后确认左侧没有免责声明选项；清空模块时右侧底部仍显示免责声明，勾选模块后免责声明仍在内容区最下方。

## 对话助手 Markdown 展示（2026-09-06，待验收）

- 目标：将对话助手中的助手消息从纯文本 `<pre>` 展示改为 Markdown 渲染，支持标题、列表、引用、代码块、表格等格式。
- 分支：`feature/chat-markdown-render`

### 验收项

- [x] 对话助手引入 `react-markdown` 与 `remark-gfm`
- [x] 助手消息内容使用 Markdown 渲染，用户消息保持原样
- [x] 标题、列表、引用、代码块、表格等 Markdown 语法可正常展示
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过
- [x] 功能分支已推送并合并回 `main`

### 验证方式

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 页面勾选“对话助手”并发送包含 Markdown 的测试消息，确认助手回复按 Markdown 结构展示。

## 自选股代码校验与删除弹窗（2026-09-06，待验收）

- 目标：自选股新增时校验沪深北 A 股代码并用渐隐悬浮窗提示；所有删除操作使用页面正中间的自定义确认弹窗，替代浏览器默认 confirm。
- 分支：`feature/watchlist-validation-delete-dialogs`

### 验收项

- [x] 自选股新增时只接受 6 位沪深北 A 股代码
- [x] 非法代码通过页面悬浮窗提示，并在约 2 秒后渐进消失
- [x] 自选股删除使用页面正中间的自定义确认弹窗
- [x] 历史复盘删除使用页面正中间的自定义确认弹窗
- [x] 周期内 AI 分析删除使用页面正中间的自定义确认弹窗
- [x] 系统内不再使用浏览器默认 `window.confirm`
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过
- [x] 功能分支已推送并合并回 `main`

### 验证方式

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 在自选股输入非 A 股代码（如 123456），确认出现渐隐悬浮提示；分别删除自选股、历史复盘记录、周期内 AI 分析，确认确认框居中显示。

## F0 基金契约与工作台 Shell（2026-09-07）

- 关联文档：`docs/fund-workbench-plan.md`、`docs/fund-workbench-design.md`、`docs/fund-workbench-spec.md`
- 分支：`feature/fund-base`
- 目标：冻结基金领域类型、完成工作台切换骨架与基金空面板，预留数据服务基金路由。

### 验收项

- [x] 新增 `src/lib/shared/types/funds.ts`，冻结 `FundProfile`、`FundNavPoint`、`FundIntraday`、`FundHoldings`、`FundRiskMetrics` 等类型
- [x] 从 `src/lib/shared/types/index.ts` 导出基金类型，未修改既有个股类型字段语义
- [x] `src/app/page.tsx` 收敛为页面 Shell，并保持个股/基金工作台切换状态不丢失
- [x] 新增 `WorkbenchSwitcher`、`StockWorkbench`、`FundWorkbench` 容器
- [x] 新增基金 panel 空容器，基金工作台可正常渲染
- [x] 在 `data-service/app/fund_routes.py` 预留 `/fund/profile`、`/fund/nav`、`/fund/intraday`、`/fund/holdings` 空端点
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过
- [x] Python 侧车可导入并访问 `/fund/profile?code=000001`

### 验证方式

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- `python -m uvicorn app.main:app --app-dir data-service --host 127.0.0.1 --port 8000`
- 浏览器切换个股/基金工作台至少 3 次，确认个股状态不丢失且无报错。

## F1 基金档案与历史净值（2026-09-07）

- 关联文档：`docs/fund-workbench-plan.md`、`docs/fund-workbench-design.md`
- 分支：`feature/fund-nav`
- 目标：实现基金代码校验与类型识别、档案/历史净值数据链路、基金档案与净值曲线面板。

### 验收项

- [x] 实现 `fund-market.ts`：6 位基金代码校验、场内/场外与基金类型识别、默认基金解析
- [x] FastAPI 侧车完成 `/fund/profile`、`/fund/nav`，接入 AkShare 与基金确定性回退
- [x] 实现 `fund-data.ts`：内存缓存、Store、侧车、确定性回退的编排顺序
- [x] 新增 `GET /api/funds/[code]/profile` 与 `GET /api/funds/[code]/nav`
- [x] 完成基金档案面板与历史净值曲线，支持区间、单位/累计净值切换
- [x] 至少 3 只不同类型基金可查询并返回档案/净值
- [x] 净值数据带 `source`、`fetched_at`，无外部数据源时确定性降级
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过

### 验证方式

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 使用场内 ETF、场外开放式基金、债券基金各一只，验证 `/api/funds/:code/profile` 与 `/api/funds/:code/nav` 返回正常
- 页面切换到基金工作台，输入基金代码后查看档案与净值曲线，切换区间与净值口径
- 停用数据服务时验证基金查询可确定性降级并标注来源。

### 完成记录

- 完成日期：2026-09-07
- 结果：F1 全部验收通过；AkShare 实测 `510300`、`000001`、`110022`、`003376` 类型识别正确，净值接口返回 `source=akshare`，无侧车时 Next.js API 正确降级为 `deterministic-fallback`；已修复降级数据长期占用缓存及侧车首次加载基金名单超时的问题。

## F2 实时/估算与持仓（2026-09-07）

- 关联文档：`docs/fund-workbench-plan.md`、`docs/fund-workbench-design.md`
- 分支：`feature/fund-intraday-holdings`
- 目标：实现场内实时行情、场外盘中估算、最新季度持仓与持仓面板。

### 验收项

- [x] FastAPI 侧车完成 `/fund/intraday`、`/fund/holdings`，区分场内 `realtime` 与场外 `estimate`
- [x] 实现 `fund-intraday.ts` 与 `fund-holdings.ts` 数据编排，含缓存/降级
- [x] 新增 `GET /api/funds/[code]/intraday` 与 `GET /api/funds/[code]/holdings`
- [x] 完成基金实时/估算面板与季度持仓面板
- [x] 场内 ETF 展示实时价，场外基金展示估算并显著标注“估算值，非官方净值”
- [x] 持仓面板展示报告期、前十大资产与占比，并提示“持仓报告期，存在滞后”
- [x] 至少覆盖 1 只场内 ETF、1 只场外基金，且无外部数据源时可确定性降级
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过

### 验证方式

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 使用场内 ETF（如 `510300`）与场外基金（如 `000001`），分别验证 `/api/funds/:code/intraday`、`/api/funds/:code/holdings`
- 页面切换到基金工作台，确认 ETF 显示实时行情、场外显示盘中估算且标注清晰
- 持仓面板确认报告期、前十大资产与占比完整，且明确提示披露滞后。

### 完成记录

- 完成日期：2026-09-07
- 结果：F2 全部验收通过；`/fund/intraday` 对 `510300` 返回 `realtime`、对 `000008` 返回 `estimate`，`/fund/holdings` 对 `110022` 返回前十大持仓；Next.js API 已联调返回 `akshare`，无侧车时可确定性降级；`typecheck`、`lint`、`build` 均通过。
- 补充：基金档案已接入 `fund_info_ths`，填充基金经理、基金公司、业绩基准、成立日期与最新规模；修复重复查询同一基金代码时净值/行情/持仓被清空但不重新加载的问题。


## F3 回撤与风险指标（2026-09-07）

- 关联文档：`docs/fund-workbench-plan.md`、`docs/fund-workbench-design.md`
- 分支：`feature/fund-metrics`
- 目标：基于历史累计净值本地计算收益、波动、回撤与修复指标，并叠加回撤区间。

### 验收项

- [x] 实现 `fund-metrics.ts`：区间/年化收益、年化波动、夏普、索提诺、卡玛
- [x] 实现最大回撤、当前回撤、最长修复天数、平均修复天数与当前修复进度
- [x] 新增 `GET /api/funds/[code]/metrics?range=1y|3y|all`
- [x] 完成基金风险面板，并支持指标悬浮说明
- [x] 在净值曲线中叠加最大回撤区间
- [x] 至少对 `510300` 与 `110022` 验算指标结果与历史净值一致
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过

### 验证方式

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 调用 `/api/funds/510300/metrics?range=1y` 与 `/api/funds/110022/metrics?range=1y`，确认指标有值且回撤区间在净值范围内
- 页面切换基金工作台，确认风险面板与净值曲线中的回撤区域正常展示。

### 完成记录

- 完成日期：2026-09-07
- 结果：F3 全部验收通过；`510300` 与 `110022` 的 `metrics` 接口均返回完整回撤/风险指标，页面风险面板和净值曲线回撤叠加正常；`typecheck`、`lint`、`build` 均通过。
- 补充：净值曲线增加绿色“当前修复区间”叠加，风险面板增加当前修复进度条，直观展示从回撤低点向历史峰值的修复幅度。
- 修正：当前修复叠加改为窄幅“幅度区域”而非全高日期区间，并让风险指标区间切换同步净值曲线范围，避免大区间下与最大回撤区间重叠。
- 修正：修复区间改为从当前区间最大回撤末端开始，延续到净值回到该回撤起点为止；未修复显示“正在修复中”，已修复显示“修复耗时 x年x个月x天”，图表绿色区域也绑定为最大回撤修复幅度，而不是全局峰谷区间。
- 修正：指标计算与 API 扩展为 `1m/3m/6m/1y/3y/all` 全区间，净值曲线所有区间都可叠加回撤/修复区域；风险面板固定展示“成立以来 + 近1年”，当前回撤与当前修复进度按最新净值即时展示。
- 修正：净值曲线中的回撤/修复矩形高度改为取对应横向区间内全部净值的最高点与最低点之差，横向起止点只决定矩形宽度。


## F4 基金 AI 分析与对话（2026-09-08）

- 关联文档：`docs/fund-workbench-plan.md`、`docs/fund-workbench-design.md`
- 分支：`feature/fund-ai`
- 目标：将基金档案、净值、实时/估算行情、持仓与风险指标接入 AI 分析，并支持围绕当前基金的多轮对话。

### 验收项

- [x] 新增基金 AI 报告、基金会话与消息共享类型
- [x] 新增基金 AI 报告与会话内存仓库，隔离个股数据
- [x] 实现 `fund-analysis.ts` 数据聚合、确定性回退与 DeepSeek 流式报告
- [x] 实现 `fund-chat.ts` 多轮基金对话与确定性回退
- [x] 新增 `/api/funds/[code]/analysis`、`/analysis/stream`、`/reports/[id]`
- [x] 新增 `/api/fund-chat` 与基金会话查询/删除接口
- [x] 完成基金 AI 报告面板与基金对话面板，接入基金工作台
- [x] AI 报告包含基金概览、持仓风格、风险解读、数据来源与风险提示，且无确定性买卖建议
- [x] 连续 3 轮追问上下文正确
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过

### 验证方式

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 在基金工作台对 `510300` 生成 AI 分析，确认报告包含数据来源与风险提示
- 连续追问 3 轮，确认基金会话上下文不串入个股工作台。

### 完成记录

- 完成日期：2026-09-08
- 结果：F4 核心链路已完成；`/api/funds/510300/analysis` 可返回含档案、行情、持仓、风险指标与免责声明的报告，`/api/fund-chat` 同一 `conversationId` 连续 3 轮追问正常；`typecheck`、`lint`、`build` 均通过。


## F5 持久化与集成验收（2026-09-08）

- 关联文档：`docs/fund-workbench-plan.md`、`docs/fund-workbench-design.md`
- 分支：`feature/fund-integration`
- 目标：基金数据与 AI 结果持久化、清理与整体回归，保证个股工作台无回归。

### 验收项

- [x] 新增 `fund_analysis_reports`、`fund_conversations`、`fund_messages` Drizzle 表
- [x] 生成对应 Drizzle 迁移文件 `drizzle/0004_calm_peter_parker.sql`
- [x] 基金 AI 报告/会话/消息仓库支持 PostgreSQL 持久化，失败回退内存
- [x] 基金净值、持仓与风险指标接入持久化仓库
- [x] 基金资讯 `expire_at` 清理与长期公告保留
- [x] 基金 AI 报告与关键快照写入 R2
- [x] 数据源健康面板纳入基金数据源状态
- [x] 个股工作台 M1–M8 无回归
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过

### 验证方式

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 配置真实数据库时，生成基金 AI 报告与会话后重启服务仍可回看；未配置数据库时仍可内存运行。

### 完成记录

- 完成日期：2026-09-08
- 结果：F5 全部验收通过；已落地基金 AI/基础数据持久化、R2 报告快照、基金数据源健康探测，并新增 `fund_news_items` 迁移 `drizzle/0006_brave_molly_hayes.sql`，调度清理任务同时处理个股与基金资讯；`typecheck`、`lint`、`build` 均通过。


## F6 自选基金（2026-09-08）

- 关联文档：`docs/fund-workbench-spec.md` FR-F11、`docs/fund-workbench-design.md`
- 分支：`feature/fund-watchlist`
- 目标：在基金工作台支持添加、删除、备注与切换自选基金，刷新后可恢复，切换后基金全链路上下文一致。

### 验收项

- [x] 新增 `FundWatchlistItem` 基金自选共享类型
- [x] 新增 `fund_watchlist` Drizzle 表与迁移 `drizzle/0007_lame_doctor_faustus.sql`
- [x] 新增 `fund-watchlist.ts` 数据访问层，PostgreSQL 失败回退本地 JSON
- [x] 新增 `/api/fund-watchlist` 的 GET/POST/PATCH/DELETE/PUT 接口
- [x] 完成基金自选面板，支持添加、删除、备注与点击切换
- [x] 切换自选基金后档案、净值、风险指标、AI 报告与对话全链路同步切换
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过

### 验证方式

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 在基金工作台添加 `510300`、`000001`、`110022`，切换后确认各面板数据同步变化。
- 删除当前自选基金后确认页面清空，刷新后列表仍可恢复。

### 完成记录

- 完成日期：2026-09-08
- 结果：F6 全部验收通过；`/api/fund-watchlist` 支持自选基金增删改查与排序，面板已接入基金工作台；数据库不可用时回退 `.data/fund-watchlist.json`；`typecheck`、`lint`、`build` 均通过。


## F7 基金历史复盘（2026-09-08）

- 关联文档：`docs/fund-workbench-spec.md` FR-F12、`docs/fund-workbench-design.md`
- 分支：`feature/fund-replay`
- 目标：展示某基金的历史 AI 分析与对话时间线，便于复盘；统计口径仅用于学习，不提供收益承诺。

### 验收项

- [x] 新增 `FundReplaySummary` 基金复盘共享类型
- [x] 新增 `fund-replay.ts`，从基金 AI 报告与会话仓库汇总时间窗口
- [x] 新增 `/api/fund-replay/stats` 与 `/api/fund-replay/timeline`
- [x] 完成基金历史复盘面板，展示分析次数、对话次数与时间线详情
- [x] 支持删除基金 AI 报告或基金会话记录
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过

### 验证方式

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 在基金工作台对 `510300` 生成 AI 分析与会话后，确认复盘面板显示对应统计与时间线。
- 调用 `/api/fund-replay/stats?code=510300&days=30` 与 `/api/fund-replay/timeline?code=510300&days=30` 返回正常。

### 完成记录

- 完成日期：2026-09-08
- 结果：F7 全部验收通过；基金复盘面板已接入工作台，时间窗口支持 7/30/90 天，分析报告与基金会话时间线可回看、可删除；统计口径仅用于学习；`typecheck`、`lint`、`build` 均通过。


## F8 基金数据源与调度面板（2026-09-08）

- 关联文档：`docs/fund-workbench-spec.md` FR-F13、`docs/fund-workbench-design.md`
- 分支：`feature/fund-datasource-scheduler`
- 目标：将基金数据源纳入数据源健康面板，并支持手动刷新基金档案、净值、持仓与风险指标。

### 验收项

- [x] 基金数据源 `AkShare/基金` 已纳入现有数据源健康面板
- [x] 新增 `runFundRefreshJob` 与 `/api/admin/fund-refresh`
- [x] 支持按基金代码或默认样例基金刷新档案、盘中行情、净值、持仓与风险指标
- [x] 调度任务视图新增 `fund-refresh`，并配置每日定时刷新
- [x] 数据源面板新增“刷新基金数据”按钮并联动任务日志
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过

### 验证方式

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 调用 `/api/admin/datasources`，确认基金数据源与 `fund-refresh` 任务正常显示。
- 调用 `/api/admin/fund-refresh`，确认返回 `job_name=fund-refresh` 且状态为 `success`。

### 完成记录

- 完成日期：2026-09-08
- 结果：F8 全部验收通过；基金数据源状态已显示，手动基金刷新接口与每日定时任务已落地，数据源面板可触发基金数据刷新；`typecheck`、`lint`、`build` 均通过。


## F9 基金对比（2026-09-08）

- 关联文档：`docs/fund-workbench-spec.md` 未来扩展、`docs/fund-workbench-design.md`
- 分支：`feature/fund-comparison`
- 目标：支持输入 2–5 个基金代码，在同一区间横向比较净值、业绩与风险指标。

### 验收项

- [x] 新增 `FundComparisonItem` 与 `FundComparisonSnapshot` 共享类型
- [x] 新增 `fund-comparison.ts` 数据编排，复用基金档案、净值、行情与风险指标
- [x] 新增 `/api/fund-comparison?codes=510300,110022&range=1y`
- [x] 完成基金对比面板，支持区间切换与横向表格展示
- [x] 上涨/有利指标标红，下跌/不利指标标绿，波动等无法严格定性的指标保持黑色
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过

### 验证方式

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 调用 `/api/fund-comparison?codes=510300,110022&range=1y`，确认返回两只基金的同区间指标。
- 在基金工作台切换区间后，确认对比表数据同步更新。

### 完成记录

- 完成日期：2026-09-08
- 结果：F9 全部验收通过；`/api/fund-comparison` 已返回 `510300` 与 `110022` 的对比数据，对比面板已接入基金工作台；`typecheck`、`lint`、`build` 均通过。


## F10 基金组合分析（2026-09-09）

- 关联文档：`docs/fund-workbench-spec.md` 未来扩展、`docs/fund-workbench-design.md`
- 分支：`feature/fund-portfolio`
- 目标：支持输入 2–5 个基金代码与权重，按共同交易日合成组合净值，展示组合与单基金风险指标。

### 验收项

- [x] 新增 `FundPortfolioItem` 与 `FundPortfolioSummary` 共享类型
- [x] 新增 `fund-portfolio.ts` 数据编排，支持代码/区间/权重归一化与组合净值合成
- [x] 新增 `/api/fund-portfolio?codes=510300,110022&weights=60,40&range=1y`
- [x] 完成基金组合分析面板，支持权重输入、区间切换与汇总/明细表展示
- [x] 上涨/有利指标标红，下跌/不利指标标绿，波动等无法严格定性的指标保持黑色
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过

### 验证方式

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 调用 `/api/fund-portfolio?codes=510300,110022&weights=60,40&range=1y`，确认返回组合汇总与单基金指标。
- 在基金工作台切换区间后，确认组合汇总表与单基金明细同步更新。

### 完成记录

- 完成日期：2026-09-09
- 结果：F10 全部验收通过；`/api/fund-portfolio` 已返回组合与单基金指标，组合分析面板已接入基金工作台；`typecheck`、`lint`、`build` 均通过。


## F11 基金行业资讯查询（2026-09-09）

- 关联文档：`docs/fund-workbench-spec.md` 未来扩展、`docs/fund-workbench-design.md`
- 分支：`feature/fund-news-alerts`
- 目标：舍弃确定性基金资讯，改为先由 AI 分析持仓判断强相关行业，再检索并展示真实行业资讯。

### 验收项

- [x] 新增 `FundIndustryNewsSnapshot` 与 `FundNewsItem.industry` 共享类型
- [x] 重构 `fund-news.ts`，使用 DeepSeek 分析持仓行业，并用 Tavily 搜索真实行业资讯
- [x] 复用 `/api/funds/[code]/news`，返回关联行业、分析来源、可用状态与真实资讯列表
- [x] 无持仓、无密钥或搜索无结果时返回明确不可用状态，不再展示降级资讯
- [x] `FundNewsPanel` 改为行业资讯查询，展示关联行业、分析来源与真实资讯，支持手动刷新
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过

### 验证方式

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 调用 `/api/funds/510300/news`，确认 `industry_analysis_source`、`industries` 与真实行业资讯返回正常。
- 在基金工作台查询 `510300` 后，确认行业资讯面板显示 AI 识别行业与真实资讯；无密钥时明确显示不可用且不展示降级内容。


## F12 基金定投回测（2026-09-09）

- 关联文档：`docs/fund-workbench-spec.md` 未来扩展、`docs/fund-workbench-plan.md`
- 分支：`feature/fund-dca-backtest`
- 目标：支持单基金按每日、每周、每两周、每月频率定投回测，展示收益率变化曲线、累计投入、期末市值、年化收益与回撤指标。

### 验收项

- [x] 新增 `FundDcaFrequency`、`FundDcaContribution`、`FundDcaEquityPoint` 与 `FundDcaSnapshot` 共享类型
- [x] 新增 `fund-dca.ts`，支持每日/每周/每两周/每月定投，生成收益率曲线并计算累计收益、年化收益与回撤
- [x] 新增 `/api/fund-dca?code=510300&range=1y&frequency=monthly&amount=1000`
- [x] 新增交互式收益率曲线，支持悬停查看单日投入、市值与收益率
- [x] 默认隐藏明细表；非每日定投时可点击按钮展开分页明细，每日定投不提供表格
- [x] 三年/成立以来等长期区间会校正旧缓存，并对收益率曲线做均匀抽样，避免大数据量导致页面无法渲染
- [x] 净值降级或数据不足时明确返回不可用，不生成演示回测结果
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过

### 验证方式

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 调用 `/api/fund-dca?code=510300&range=1y&frequency=monthly&amount=1000`，确认定投期数、累计投入、期末市值与收益率曲线计算正确。
- 在基金工作台切换每日、每周、每两周、每月与不同区间，确认收益率曲线同步更新；每日定投不展示明细表，其他频率可手动展开明细。


## F13 基金风格因子分析（2026-09-09）

- 关联文档：`docs/fund-workbench-spec.md` FR-F07、未来扩展
- 分支：`feature/fund-style-factors`
- 目标：基于真实持仓、行业配置与风险指标分析基金风格，并用 AI 归纳持仓风格与风险收益特征。

### 验收项

- [x] 新增 `FundStyleSnapshot` 共享类型
- [x] 新增 `fund-style.ts`，复用持仓与风险指标计算本地风格标签
- [x] 新增 `/api/fund-style?code=510300&range=1y`
- [x] 新增 `FundStylePanel`，展示风格标签、风险收益指标、持仓集中度、行业配置与 AI 归纳
- [x] 持仓为确定性回退时明确不可用，不生成演示风格结论
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过

### 验证方式

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 调用 `/api/fund-style?code=510300&range=1y`，确认返回风格标签、风险指标、持仓集中度与 AI 归纳。
- 在基金工作台切换不同基金与区间，确认风格因子面板同步更新，且不使用确定性持仓生成结论。

## F14 基金工作台按需模块化（2026-09-09）

- 关联文档：docs/fund-workbench-spec.md 布局与交互
- 分支：eature/fund-industry-news-on-demand
- 目标：参照个股工作台，将基金功能改为左侧功能选项勾选后按需展示，避免一次性堆叠。

### 验收项

- [x] 新增 FundOptionsSidebar，左侧查询基金、勾选功能模块、管理自选基金
- [x] 基金工作台按模块展示档案、净值、当日行情、持仓、风险、AI 分析、对话、复盘、对比、组合、定投、行业资讯与风格因子
- [x] 移除不可靠展示：IOPV 实时估值、基金风险等级、持仓数量与行业配置
- [x] corepack pnpm typecheck 通过
- [x] corepack pnpm lint 通过
- [x] corepack pnpm build 通过

### 验证方式

- corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build
- 在基金工作台左侧勾选/清空模块，确认右侧信息区按需展示，未勾选时不展示对应内容。
- 留空基金代码查询时默认使用 510300。

## F15 基金对比 / 组合 / 定投增强（2026-09-09）

- 关联文档：`docs/fund-workbench-spec.md` FR-F08、FR-F09、未来扩展
- 分支：`feature/fund-direction-two-enhance`
- 目标：在既有基金对比、组合分析、定投回测基础上增强曲线可视化与对比维度，不使用降级假数据。

### 验收项

- [x] 基金对比新增共同起点归一化累计收益曲线，支持多基金叠加与悬停查看收益
- [x] 基金组合新增组合累计收益曲线与组合回撤曲线
- [x] 基金组合明细新增目标权重、当前权重与权重偏离展示
- [x] 定投回测新增“定投 vs 一次性买入”收益对比曲线与一次性买入收益率指标
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过

### 验证方式

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 调用 `/api/fund-comparison?codes=510300,110022&range=1y`，确认 `series` 含共同起点归一化收益曲线。
- 调用 `/api/fund-portfolio?codes=510300,110022&mode=weight&weights=60,40&range=1y`，确认 `portfolio_curve` 与权重偏离字段返回。
- 调用 `/api/fund-dca?code=510300&range=1y&frequency=monthly&amount=1000`，确认 `lump_sum_curve` 与 `lump_sum_return_pct` 返回。
- 在基金工作台对比、组合、定投模块分别查看新增曲线交互与指标，确认净值降级时不生成假曲线。

## F16 基金组合与定投策略增强（2026-09-10）

- 关联文档：`docs/fund-workbench-spec.md` FR-F08、FR-F09、未来扩展
- 分支：`feature/fund-strategy-enhance`
- 目标：组合增加目标权重区间、再平衡偏离提醒与单基金风险贡献拆解；定投增加多基金组合回测、扣款日收益差异对比与最大回撤修复区间图。

### 验收项

- [x] 组合支持百分比权重、目标权重区间、持仓份额三种模式
- [x] 组合明细展示目标权重区间、当前权重、权重偏离、再平衡状态与偏离幅度
- [x] 组合按协方差矩阵计算单基金对组合波动的风险贡献占比
- [x] 定投支持多基金组合回测，返回组合市值曲线与组合指标
- [x] 月度定投支持不同扣款日收益差异对比
- [x] 定投收益率曲线叠加最大回撤区间与修复区间，并标注正在修复或修复完成
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过

### 验证方式

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 调用 `/api/fund-portfolio?codes=510300,110022&mode=range&min_weights=45,25&max_weights=65,45&range=1y`，确认返回目标权重区间、再平衡状态与风险贡献占比。
- 调用 `/api/fund-dca?codes=510300,110022&amounts=1000,1000&range=1y&frequency=monthly`，确认组合定投市值曲线与组合指标返回。
- 调用 `/api/fund-dca?code=510300&range=1y&frequency=monthly&amount=1000`，确认 `payday_comparison` 与回撤修复区间字段返回。
- 在基金工作台组合与定投模块查看新增交互与图表，确认降级数据不生成假曲线。

### 完成记录

- 完成日期：2026-09-10
- 结果：F16 全部验收通过；组合与定投增强已落地，`typecheck`、`lint`、`build` 均通过。

## T1 自动化测试底座（2026-09-10）

- 关联文档：`docs/plan.md` 质量与协作约定、根 `checklist.md` 既有验收项
- 分支：`feature/test-infra`
- 目标：引入 Vitest 作为单元测试运行器，为纯计算模块建立可重复的自动化回归测试，补齐 `typecheck`/`lint`/`build` 之外的计算正确性验证。

### 验收项

- [x] 引入 `vitest` 与 `@vitest/coverage-v8` 开发依赖，新增 `vitest.config.ts`
- [x] 新增 `pnpm test`、`pnpm test:watch`、`pnpm test:coverage` 脚本
- [x] 测试默认使用 node 环境且不加载 `.env`，不连接数据库与外部服务
- [x] `tests/indicators.test.ts` 覆盖 MA/MACD/KDJ/RSI/BOLL 与数据不足边界
- [x] `tests/fund-metrics.test.ts` 覆盖区间收益、最大回撤、修复天数、当前回撤与空值
- [x] `tests/fund-dca.test.ts` 覆盖参数规范化、每月定投份额与市值、一次性买入对比、扣款日对比与降级不可用
- [x] `tests/fund-portfolio.test.ts` 覆盖权重/份额/区间参数规范化、组合曲线、权重偏离与风险贡献
- [x] `tests/replay.test.ts` 覆盖复盘天数与窗口规范化
- [x] `tests/fund-market.test.ts` 覆盖基金代码校验、类型与交易模式识别
- [x] `tests/format.test.ts` 覆盖时间/新鲜度/来源与乱码文本处理
- [x] `corepack pnpm test` 全部用例通过
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过

### 验证方式

- `corepack pnpm test`
- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- `corepack pnpm test:coverage` 查看纯计算模块覆盖率

### 通过标准

- 新增测试全部通过，失败时能定位到具体指标口径；不改动既有业务逻辑与共享类型。

### 风险与遗留

- 本阶段只覆盖无外部依赖的纯计算模块；涉及数据库、HTTP 与 AI 的编排留待后续阶段补充。
- AkShare/DeepSeek/Tavily 等外部依赖不纳入单测，避免网络抖动导致结果不稳定。

### 完成记录

- 完成日期：2026-09-10
- 分支：`feature/test-infra`
- 结果：T1 全部验收通过；`corepack pnpm test` 7 个测试文件 / 62 个用例全部通过，`typecheck`、`lint`、`build` 均通过。
- 覆盖率（`corepack pnpm test:coverage`，行覆盖率）：
  - `indicators.ts` 100%，`fund-portfolio.ts` 93.65%，`fund-dca.ts` 90.24%，`fund-metrics.ts` 78.19%。
  - `src/lib/**` 整体行覆盖率 23.02%，未覆盖部分主要是依赖数据库、HTTP 与 AI 的编排模块。
- 新增文件：`vitest.config.mts`、`tests/helpers/fixtures.ts`、`tests/indicators.test.ts`、`tests/fund-metrics.test.ts`、`tests/fund-dca.test.ts`、`tests/fund-portfolio.test.ts`、`tests/replay.test.ts`、`tests/fund-market.test.ts`、`tests/format.test.ts`。
- 修改文件：`package.json`（新增 test 脚本与开发依赖）、`.gitignore`、`eslint.config.mjs`（忽略 `coverage/**`）。

### 遗留与发现（本任务不修复，另行评估）

- 定投年化收益在亏损路径上返回 `null`：`src/lib/fund-dca.ts` 的 `calculateDcaXirr` 使用牛顿迭代且初值固定为 0.1，亏损样本会发散（实测 2024-01 至 2024-08 每月定投 1000 元、区间收益 -26.75% 时，真实年化约 -68.2%，但接口返回 null）。
- 影响面：单基金定投与组合定投的 `annualized_return_pct`、每月扣款日对比的 `annualized_return_pct` 在亏损时会显示为空。
- 建议方案：改用二分法或带边界的牛顿迭代（限定下界 -0.99），后续单独建分支修复并补测试。

- 处理结果：已在 T2 修复，见分支 `feature/fund-dca-xirr-fix`。

## T2 定投年化收益（XIRR）亏损路径修复（2026-09-10）

- 关联文档：`checklist.md` T1 遗留与发现、`docs/fund-workbench-spec.md` FR-F09 定投回测
- 分支：`feature/fund-dca-xirr-fix`
- 目标：修复 `src/lib/fund-dca.ts` 中定投年化收益在亏损路径返回 `null` 的缺陷，保证亏损与盈利两种场景都能给出可复核的年化收益。

### 缺陷与根因

- 现象：区间亏损时，单基金定投、组合定投与每月扣款日对比的 `annualized_return_pct` 返回 `null`（例如 2024-01 至 2024-08 每月定投 1000 元、区间收益 -26.75%，真实年化约 -68.2%）。
- 根因：`calculateDcaXirr` 用固定初值 0.1 的牛顿迭代求解，亏损场景下净现值函数在当前点斜率为负，迭代步长把利率推到 -1 以下，`(1 + rate) ** years` 出现负底数分数次幂得到 `NaN`，最终被判为无解。

### 验收项

- [x] 改用二分法求根：以 `x = 1 + 年化收益率` 为自变量，用符号区间收缩
- [x] 盈利场景自动向上扩展上界（翻倍），亏损场景使用 0.01 下界
- [x] 区间内无符号变化时明确返回 `null`，不返回错误数值
- [x] 亏损样本返回年化 -68.2%（与独立二分法验算一致）
- [x] 盈利样本年化收益为正，且与区间收益同号
- [x] 组合定投、扣款日对比复用同一实现，结果一致
- [x] `tests/fund-dca.test.ts` 补充亏损与盈利路径断言
- [x] `corepack pnpm test` 全部通过
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过

### 验证方式

- `corepack pnpm test`
- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 用独立二分法脚本复核亏损样本的真实年化区间（约 -68.2%）

### 通过标准

- 亏损与盈利场景均返回非空年化收益；不改变其它指标口径与既有接口字段语义。

### 风险与遗留

- 当最后一段净值接近归零时，年化收益会低于 -99% 的搜索下界，此时仍返回 `null`（属边界保护，不产生误导数值）。
- 二分法结果与牛顿法在盈利场景下应一致；若出现 0.01 个百分点的舍入差异，以二分法为准并同步测试断言。

### 完成记录

- 完成日期：2026-09-10
- 分支：`feature/fund-dca-xirr-fix`
- 结果：T2 全部验收通过；`corepack pnpm test` 7 个测试文件 / 63 个用例全部通过，`typecheck`、`lint`、`build` 均通过。
- 核心改动：`src/lib/fund-dca.ts` 的 `calculateDcaXirr` 改为在 `x = 1 + 年化收益率` 上做二分法求根；盈利场景自动翻倍扩展上界，亏损场景下界取 0.01（年化 -99%），区间内无符号变化时返回 `null`。
- 数值核对：亏损样本（2024-01 至 2024-08 每月定投 1000 元）年化由 `null` 修正为 -68.2%，与独立二分法验算一致；盈利样本年化为正，且与区间收益同号。
- 覆盖范围：单基金定投、组合定投与每月扣款日对比共用同一实现，结果一致；未改动其它指标口径与接口字段。
- 修改文件：`src/lib/fund-dca.ts`、`tests/fund-dca.test.ts`、`checklist.md`。

## T3 自选池监控与预警（预警中心）（2026-09-10）

- 关联文档：`docs/alert-center-plan.md`（v0.2）
- 分支：`feature/alert-center`
- 目标：把自选股 / 自选基金、定时调度、数据快照与邮件通道串成「扫描 → 判定 → 事件 → 页面 + 邮件」闭环，面向初学者提供涨幅、最新价、单位净值、净值单日涨跌、区间最大回撤、当前回撤等观测指标。

### 需求确认结论

- 冷却期 12 小时；非交易时段不触发。
- 支持邮件推送到本机预留的收件邮箱；未配置 SMTP 时仅页面展示。
- 交易日每 30 分钟扫描一次（系统运行时），另提供手动「立即评估」。
- 最多 3 个自选标的（股票 + 基金合计）可配置预警任务，可用 `ALERT_MAX_TARGETS` 调整。
- 单条规则支持 1 个条件，或 2–4 个条件按 AND / OR 组合。

### 验收项

- [x] 新增 `alert_rules`、`alert_events` 两张表与迁移 `0008`，仅新增不改既有表
- [x] 未配置数据库时规则与事件落 `.data/alerts.json`，重启不丢失
- [x] 有效时段判定：股票仅 09:30–11:30、13:00–15:00；基金为交易时段或工作日 15:00 后；周末不触发
- [x] 冷却期 12 小时生效，冷却期内重复扫描不产生新事件
- [x] 单条件与 AND / OR 组合条件均可配置并生效，条件数限制在 1–4
- [x] 等于阈值按命中处理（`≥` / `≤` 含边界）
- [x] 观测值来自 `deterministic-fallback` 时跳过并计入跳过计数
- [x] 预警标的数量上限默认 3，超出时拒绝并提示
- [x] 规则标的必须在对应自选池内；删除自选标的时其规则自动停用
- [x] 邮件：配置 SMTP 后可发送测试邮件；触发时汇总发送一封摘要邮件；失败不影响入库并记录原因
- [x] 手动评估与定时评估口径一致，均写入 `job_runs`
- [x] 预警中心面板可在个股 / 基金工作台挂载，展示规则、事件流与邮件通道状态
- [x] `tests/alerts.test.ts` 覆盖时段、组合、边界、冷却、降级、缺指标、邮件文案
- [x] `corepack pnpm test` 全部通过
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过
- [x] `.env.example` 与 `README.md` 补充 `ALERT_CRON`、`ALERT_MAX_TARGETS`、`SMTP_*`、`ALERT_EMAIL_TO`
- [x] 代码注释为中文，未提交真实密钥

### 验证方式

- `corepack pnpm test && corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 端到端：新增 510300 规则「净值单日涨跌 ≤ -1% 或区间最大回撤 ≥ 20%」→ 立即评估 → 事件出现 → 12 小时内再次评估不新增 → 标记已读 → 删除规则
- `corepack pnpm dev` 后打开预警中心面板核对空态、未配置 SMTP 提示与手动评估按钮

### 通过标准

- 单条件与组合条件均按配置生效；冷却、时段、降级三条防线不产生误报；既有 M1–M8、MF1–MF6 行为无回归。

### 风险与遗留

- 本地无交易日历，节假日按「工作日 + 时段」近似，后续可在 data-service 接入 AkShare 交易日历精确化。
- 本地为快照数据而非逐笔行情，事件已固化观测时间与数据来源并统一标注。

### 完成记录

- 完成日期：2026-09-10
- 分支：`feature/alert-center`
- 结果：T3 全部验收通过；`corepack pnpm test` 8 个测试文件 / 87 个用例通过，`typecheck`、`lint`、`build` 均通过。
- 交付物：共享契约 `src/lib/shared/types/alerts.ts`；判定引擎 `src/lib/alerts.ts`；请求解析 `src/lib/alert-input.ts`；持久化 `src/lib/alert-store.ts`（Drizzle + `.data` 文件回退）；邮件 `src/lib/alert-email.ts`；扫描 `src/lib/alert-scan.ts`；调度 `src/lib/scheduler.ts` 新增 `alert-scan`；迁移 `drizzle/0008_married_lethal_legion.sql`；接口 `src/app/api/alerts/**` 与 `src/app/api/admin/alerts/**`；面板 `src/components/panels/AlertPanel.tsx`（个股 / 基金工作台均挂载）。
- 端到端实测（本地未运行 PostgreSQL、未配置 SMTP，数据侧车运行中）：
  - 规则创建：股票 300502「当日涨跌幅 ≤ 99」与基金 510300「净值单日涨跌 ≤ -1% 或区间最大回撤 ≥ 20%」创建成功。
  - 手动评估：`scanned_targets=2`、命中 1 条（300502，观测值 -0.68%，来源 akshare），邮件因未配置 SMTP 记为 `skipped` 且不影响事件入库。
  - 冷却期：12 小时内再次评估 `triggered_count=0`，跳过原因含「处于 12 小时冷却期内」。
  - 降级防护：数据侧车未启动时观测值来源为 `deterministic-fallback`，命中数 0 并计入跳过原因。
  - 参数校验：指标与标的类型不匹配、条件数超过 4、标的不在自选池、非 JSON 请求体、非法邮箱、非法事件状态均返回 400；不存在的规则或事件返回 404。
  - 数量上限：已有 3 条规则时新增第 4 条被拒绝，提示「最多只能为 3 个自选标的配置预警任务」。
  - 自选池联动：删除自选股 600519 后，其预警规则自动变为「已停用」。
  - 事件流转：标记已读 / 未读、删除均正常。
  - 设置与邮件：收件邮箱与推送开关可保存；未配置 SMTP 时测试邮件返回 `skipped` 并说明原因。
  - 界面：`/` 页面服务端渲染输出含两处「预警中心」（个股与基金侧栏），面板随模块勾选挂载。
- 遗留：本地未启动 Docker，迁移 `0008` 已生成但尚未在本地数据库执行；启动 PostgreSQL 后执行 `corepack pnpm db:migrate` 即可建表。SMTP 参数写入本地 `.env` 后才能真实发信。
## T4 基金盘中估算预警与交易日历（2026-09-10）

- 关联文档：`docs/alert-center-plan.md`（v0.3）
- 分支：`feature/alert-intraday-calendar`
- 背景：T3 的基金预警只在「盘中 + 工作日 15:00 后」评估，且盘中用的是最新公布的官方净值，等于用昨天的数据报警，盘后触发对盯盘没有意义。本次改为以盘中估算为主，并接入真实交易日历。

### 可行性结论

- 场内基金（ETF/LOF）：侧车 `/fund/intraday` 通过腾讯行情返回实时价与 IOPV，`mode=realtime`，可取到盘中实时价格与涨跌幅。
- 场外基金：侧车通过 AkShare `fund_value_estimation_em` 返回全市场盘中估算列表（缓存 60 秒），`mode=estimate`，可取到估算净值与估算涨跌幅。
- 交易日历：AkShare `tool_trade_date_hist_sina` 提供全量交易日列表，侧车新增 `/trading-calendar` 暴露给 Web 端；不可用时退回「工作日 + 时段」近似。
- 结论：盘中监控可行，预警窗口改为交易时段，盘后窗口取消。

### 验收项

- [x] 新增 `GET /trading-calendar`（侧车）：返回交易日列表、来源与抓取时间；AkShare 不可用时返回工作日近似并标注来源
- [x] 新增 `src/lib/trading-calendar.ts`：侧车优先、内存缓存、失败回退工作日规则，并提供「是否为交易日」同步查询
- [x] 预警引擎按交易日历判定：法定节假日（日历内非交易日）不触发，日历覆盖范围之外回退工作日规则
- [x] 基金预警窗口改为盘中（09:30–11:30、13:00–15:00），取消 15:00 后窗口
- [x] 基金盘中观测值改用估算：新增指标「盘中估算净值」「盘中估算涨跌幅」，来源为 `/fund/intraday`
- [x] 观测值按规则实际引用的指标按需采集，减少扫描成本
- [x] 估算数据来源为 `deterministic-fallback` 时仍跳过，不产生误报
- [x] 面板展示「今日是否交易日 / 日历来源」与盘中监控说明
- [x] `tests/alerts.test.ts` 覆盖交易日历判定、节假日不触发、估算指标解析与窗口边界
- [x] `.env.example` 与本地 `.env` 补齐 QQ 邮箱 SMTP 占位变量
- [x] 执行 `corepack pnpm db:migrate` 应用迁移 0008
- [x] 删除临时文件 `.git/COMMIT_MSG_ALERTS.txt`
- [x] `corepack pnpm test`、`typecheck`、`lint`、`build` 全部通过
- [x] README 与预警方案文档同步更新

### 验证方式

- `corepack pnpm test && corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 侧车：`curl http://127.0.0.1:8000/trading-calendar?start=2026-09-01&end=2026-10-31`
- 端到端：盘中为基金配置「盘中估算涨跌幅 ≤ -1%」→ 立即评估 → 事件来源为 akshare 估算；把系统时间口径切到节假日 → 不触发

### 完成记录

- 完成日期：2026-09-10
- 分支：`feature/alert-intraday-calendar`
- 结果：T4 全部验收通过；`corepack pnpm test` 8 个测试文件 / 97 个用例通过，`typecheck`、`lint`、`build` 均通过。

#### 可行性复核结论

- 场内基金（ETF/LOF，如 510300、161725）：侧车 `/fund/intraday` 走腾讯行情，实测 510300 盘中 `mode=realtime`、涨跌幅 -0.26%，稳定可用。
- 场外基金：东财估值排行（AkShare `fund_value_estimation_em`）覆盖约 680 只且上游偶发 SSL 中断（已加 3 次重试），单只 `fundgz.1234567.com.cn` 接口已下线；取不到估算时该规则按「缺少指标观测值」跳过，绝不用降级数据报假警。
- 交易日历：AkShare `tool_trade_date_hist_sina` 可用，实测 2026-10-01 国庆节被正确排除，2026-09-10 判定为交易日。

#### 改动要点

- 基金预警窗口收敛为盘中（09:30–11:30、13:00–15:00），取消 15:00 后窗口，盘后不再产生事件。
- 新增基金指标「盘中估算涨跌幅」「盘中估算净值」，来源 `/fund/intraday`；公布净值与回撤保留为辅助口径。
- 观测值按规则实际引用的指标按需采集；降级数据判定收敛到条件实际引用的指标。
- 判定引擎接入交易日历；侧车新增 `GET /trading-calendar`，Web 端新增 `src/lib/trading-calendar.ts` 与 `GET /api/alerts/calendar`，面板展示今日交易日状态与日历来源。

#### 端到端实测（本地 PostgreSQL 已运行、数据侧车在线）

- 交易日历：`source=akshare`、`2026-09-10` 为交易日、覆盖区间 2025-08-06 ~ 2026-12-31。
- 盘中正例（14:40）：510300 规则命中，事件来源 `akshare`、观测值 `estimate_change_pct=-0.28`；股票 600519 同步命中 `change_pct=-0.36`。
- 冷却期：12 小时内二次评估 `triggered_count=0`，跳过原因「处于 12 小时冷却期内」。
- 盘后（15:10 复测）：基金规则返回「非盘中时段（09:30-11:30、13:00-15:00）」，不再产生事件。
- 组合条件：510300「盘中估算涨跌幅 ≤ -0.1% 且 当前回撤 ≥ 0%」创建成功（2 条件 AND）。

#### 运维事项

- `corepack pnpm db:migrate` 已执行：`alert_rules`、`alert_events` 已在本地 PostgreSQL 建表（drizzle 迁移记录 9 条）。
- 本地 `.env` 与 `.env.example` 已补 QQ 邮箱 SMTP 占位变量（`SMTP_HOST=smtp.qq.com`、`SMTP_PORT=465`、`SMTP_USER`、`SMTP_PASS`、`SMTP_FROM`、`ALERT_EMAIL_TO`），需替换为真实 QQ 号与授权码后才能发信。
- 临时文件 `.git/COMMIT_MSG_ALERTS.txt` 已删除；测试产生的规则、事件与自选标的均已清理，数据库与 `.data` 恢复为空。

#### 环境提示

- `next dev` 与 `next build` 产物共用 `.next` 时，动态路由 `[id]` 会出现 404；清理 `.next` 后重启 dev 即恢复（工具链现象，非代码缺陷）。
## T5 预警面板工作台绑定、自选池实时同步与场外估值源扩展（2026-09-10）

- 分支：`feature/alert-workbench-bind`
- 关联文档：`docs/alert-center-plan.md`、`README.md`

### 需求

1. 左侧自选股/自选基金增删后，预警面板的可选标的要立即同步，无需刷新页面
2. 补充更多免费场外基金盘中估算源（付费源不考虑）
3. 邮箱配置已完善，需要实测通道是否打通
4. 预警面板不再单独切换股票/基金，改为跟随所在工作台

### 免费估值源调研结论（2026-09-10 实测）

| 源 | 接口 | 状态 | 覆盖 |
| --- | --- | --- | --- |
| 新浪财经盘中估值 | `https://hq.sinajs.cn/list=fu_{code}`（需 `Referer: https://finance.sina.com.cn`） | 可用 | 场外开放式基金（含 QDII 联接），单只按需、无鉴权、响应快 |
| 东财估值排行静态页 | AkShare `fund_value_estimation_em(symbol="指数型")` | 可用，偶发 SSL 中断 | 实测 681 只指数型，盘后仍保留当日快照 |
| 东财估值排行 API | `api.fund.eastmoney.com/FundGuZhi/GetFundGZList` | 盘中可用；盘后返回「暂无数据」 | 全市场，按类型分页 |
| 天天基金单只估值 | `fundgz.1234567.com.cn/js/{code}.js` | 已下线（返回 404 页面） | - |
| 东财移动端 | `fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo?Fcodes=` | 净值可用；`GSZ/GSZZL` 仅盘中填充 | 全市场 |
| 蛋卷 / 雪球 | `danjuanfunds.com/djapi/...`、`stock.xueqiu.com/v5/...` | 需登录 token | - |
| 腾讯基金估值 | `qt.gtimg.cn/q=jj_{code}` | 无此代码（`v_pv_none_match`） | - |
| 自建持仓穿透估算 | 季报前十大持仓 + 实时行情加权 | 可行但成本高、依赖季报披露 | 全市场（精度受限） |

- 交叉验证：2026-09-10 当日快照，000008 新浪估算 2.2789 / -0.6042%，东财估算 2.2779 / -0.65%，两源同日口径一致。
- 结论：以**新浪 `fu_` 单只估值**作为场外首选源（按需、稳定），东财估值排行降级为兜底。

### 验收项

- [x] 预警面板移除股票/基金切换按钮，改为绑定所在工作台（股票工作台→股票预警，基金工作台→基金预警）
- [x] 新增 `src/lib/watchlist-bus.ts` 事件总线；自选股与自选基金增删后广播变更
- [x] 预警面板订阅变更事件，立即刷新可选标的，无需刷新页面
- [x] 侧车 `/fund/intraday` 场外链路改为：新浪估值 → 东财估值排行 → 确定性降级
- [x] 新增 `SOURCE_SINA = "sina"`，前端来源标签展示「新浪财经估值」
- [x] 新浪估算做一致性校验（估算净值/昨日净值 与 估算涨跌幅 偏差过大则丢弃）
- [x] 新浪估算仅在估算日期等于当日（北京时间）时采用，避免陈旧数据误报
- [x] 接口实测：`/fund/intraday?code=000008` 返回 `source=sina` 且数值正确
- [x] 邮件通道实测：`/api/admin/alerts/test-email` 返回已发送
- [x] 新增测试：事件总线（广播、订阅、取消订阅、种类回退）
- [x] `corepack pnpm test`、`typecheck`、`lint`、`build` 全部通过
- [x] README 与 `docs/alert-center-plan.md` 同步更新

### 验证方式

- `corepack pnpm test && corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 侧车：`curl "http://127.0.0.1:8000/fund/intraday?code=000008"`，检查 `source`、`estimated_nav`、`change_pct`
- 端到端：启动 `pnpm dev` 与侧车 → 在股票工作台左侧新增/删除自选股 → 预警面板下拉立即出现/移除该标的
- 端到端：切换到基金工作台 → 预警面板标题与规则列表只呈现基金内容，无切换按钮
- 邮件：`POST /api/admin/alerts/test-email`（面板「发送测试邮件」按钮）

### 通过标准

- 自选池增删后 1 秒内预警面板选项同步完成，且不触发整页刷新
- 场外基金盘中估算优先取新浪源；新浪不可用时回退东财；两者都无数据时按「缺少指标观测值」跳过，不产生误报
- 测试、类型检查、lint、构建全部通过

### 风险与遗留

- 场外基金估值仍非官方净值，属估算口径，存在偏差；面板继续保留口径说明
- 广发/货币等部分基金新浪无估值（实测 000187 返回空），此类标的按缺少观测值跳过
- 自建持仓穿透估算未实现，后续如需提高覆盖率可另行评估

### 完成记录

- 完成日期：待填写

### 完成记录

- 完成日期：2026-09-10
- 分支：`feature/alert-workbench-bind`
- 结果：T5 全部验收通过。

#### 实测结果

- 场外估值源：`/fund/intraday?code=000008` → `mode=estimate source=sina estimated_nav=2.2789 change_pct=-0.6 official_nav=2.2928 official_nav_date=2026-09-09 ts=2026-09-10T16:04:00+08:00`
- 场外主动基金：`/fund/intraday?code=110022` → `source=sina estimated_nav=2.8418 change_pct=-1.67`
- 场内基金：`/fund/intraday?code=510300`（及 LOF 161725）→ 仍走腾讯实时价 `mode=realtime`
- 无估值基金：`/fund/intraday?code=000187` → 新浪与东财均无数据，回退 `deterministic-fallback`（预警会按缺少观测值跳过）
- 邮件通道：`GET /api/alerts/settings` 返回 `email_configured=true`（收件人已配置）；`POST /api/admin/alerts/test-email` 返回 `{"status":"sent"}`，测试邮件已真实发出
- 测试：`corepack pnpm test` 9 个文件 / 102 个用例通过（新增 5 个事件总线用例）
- `corepack pnpm typecheck`、`corepack pnpm lint`、`corepack pnpm build` 均通过；构建后 dev 服务（3000）复核仍正常

#### 说明与遗留

- 自选池同步属于纯前端交互，仓库测试约定只覆盖纯计算模块，因此以事件总线单测 + 类型检查 + 构建 + 手工验证为准；手工验证步骤：股票工作台左侧新增自选股 → 预警面板下拉立即出现该标的，删除后立即消失；切换到基金工作台 → 预警面板只呈现基金预警且无切换按钮。
- 新浪 `fu_` 单只估值在盘后仍保留当日快照（实测 16:04 定格），盘中会随行情刷新；若上游在盘中不可用，自动回退东财估值排行。
## F17 基金工作台模块勾选后无内容修复（2026-09-10）

- 分支：`fix/fund-module-visibility`

### 现象与根因

- 现象：基金工作台勾选部分功能模块后，右侧不出现对应区域，也没有任何提示或重试入口。
- 根因：`renderFundModule` 对依赖当前基金的模块写成 `enabledModules.x && code ? <Panel/> : null`。当基金档案没有加载成功（`code` 仍为 `null`，例如页面打开时侧车冷启动首访超时/失败）时，这些模块**静默返回 null**。受影响模块共 8 个：基金档案、净值走势、当日行情、持仓分析、回撤与风险指标、AI 分析、对话助手、历史复盘。
- 次生问题：默认基金 510300 只在挂载时加载一次，失败后不会自动重试，用户只有手动点「查询基金」才能恢复。

### 修复内容

- 新增 `ModulePlaceholder` 占位卡片：模块已勾选但数据未就绪时，展示模块名、原因（加载中 / 上一次错误信息）与「重新查询」按钮，保证勾选后右侧一定会有可见反馈。
- 默认基金加载改为退避重试（0s / 3s / 8s，最多 3 次），覆盖侧车冷启动场景。
- 用户主动查询其他基金后，重试循环立即停止，避免把用户选择覆盖回默认基金。
- `loadFund` 改为返回布尔值供重试判断；结果到达时若已被更新的请求取代则丢弃。

### 验收项

- [x] 依赖当前基金的 8 个模块勾选后必有可见反馈（内容或占位卡片）
- [x] 占位卡片带「重新查询」按钮，可一键恢复
- [x] 默认基金冷启动失败时自动重试最多 3 次
- [x] 用户查询其他基金后重试循环立即停止，不覆盖用户选择
- [x] 不依赖当前基金的 6 个模块（基金对比、组合分析、定投回测、行业资讯、风格因子、预警中心）行为不变
- [x] `corepack pnpm typecheck`、`lint`、`test`、`build` 全部通过

### 验证方式

- `corepack pnpm test && corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 端到端（浏览器）：切到基金工作台 → 勾选「净值走势 / 持仓分析」等模块 → 基金加载成功时正常展示内容。
- 异常路径：浏览器 DevTools 切到离线（或先停掉侧车）后刷新页面 → 依赖基金的模块应显示占位卡片与「重新查询」按钮，恢复网络后点按钮即可加载。

### 风险与遗留

- 模块级数据（持仓、风险指标、当日行情）自身请求失败时，仍由各面板的空态呈现，本次未加模块级错误提示，可在后续迭代补充。
- 若用户反馈的实际现象不同（例如模块出现了但内容为空），需按具体模块继续定位。