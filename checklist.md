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
## AI 收盘日报（股市日报 / 基金日报）验收（2026-09-10）

- 关联文档：`docs/daily-report-plan.md`（v0.2）
- 分支：`feature/daily-report`
- 目标：交易日数据更新完成后自动生成股市/基金两类收盘日报，含全市场涨跌与板块涨幅，云端优先存储，界面按日期倒序展示并支持指定日期补生成。

### 需求确认（用户已答复）

- [x] 触发时机：由实现方按数据源实际就绪时间决定，采用探测式触发
- [x] 日报口径：必须包含全市场涨跌家数与行业板块涨跌幅
- [x] 允许改动侧车新增指数接口，但必须做代码白名单校验，防非法输入
- [x] 界面需提供「按指定日期生成历史日报」入口

### 验收项

- [x] 侧车 `/index/quote` 仅接受白名单指数代码，非法输入返回 400
- [x] 侧车 `/market/breadth` 返回全市场涨跌/涨跌停家数与活跃度
- [x] 侧车 `/market/sectors` 返回板块涨幅榜与跌幅榜
- [x] 侧车 `/index/kline`（白名单）支持历史日报回补指数
- [x] 日报数据含三大指数、全市场涨跌家数、板块涨跌榜、自选池表现、当日资讯
- [x] 探测式触发：数据就绪即生成，当天每类日报只生成一次（重复请求返回 skipped）
- [x] 非交易日不触发生成：定时探测与手动接口均按交易日历拦截
- [x] R2 云端优先保存；R2 不可用或未配置时落本地 `.data/daily-reports/`
- [x] DeepSeek 生成 markdown；未配置或调用失败时降级模板日报并标注 `source=template`（模板分支由单测覆盖）
- [x] 接口：列表（日期倒序）、详情、手动生成（支持指定日期与 force）
- [x] 个股工作台新增「AI 股市日报」模块，基金工作台新增「AI 基金日报」模块
- [x] 面板列表按日期倒序（越新越靠前），点击可查看完整日报
- [x] 面板提供「立即生成今日日报」与「按指定日期生成」入口，非法日期/未来日期被拒绝
- [x] 降级数据不写入日报：`deterministic-fallback` 标的会被剔除并在缺失项中说明
- [x] `corepack pnpm test`（10 文件 / 129 用例）、`typecheck`、`lint`、`build` 全部通过
- [x] 中文注释，未提交真实密钥

### 验证方式

- 侧车：`/index/quote?codes=sh000001,sz399001,sz399006`、`/market/breadth`、`/market/sectors?limit=5`、`/index/kline?code=sh000001&limit=10`
- 非法输入：`/index/quote?codes=hack123` 返回 400 并列出允许值；`/index/kline?code=sh600519` 返回 400
- 端到端：`POST /api/admin/daily-reports {kind:"stock"}` → `status=generated, storage=r2, report_source=deepseek` → 列表首条为今日 → 详情含 8 张指标卡与完整 markdown
- 幂等：再次 `POST {kind:"stock"}` 返回 `skipped：日报已存在`
- 参数校验：未来日期 / 非法格式 / 路径穿越字符串均返回 400；过去的工作日外的非交易日返回 400
- 命令：`corepack pnpm test && corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`

### 实测结果（2026-09-10）

- 股市日报：`2026-09-10` 生成成功，`storage=r2`、`report_source=deepseek`；正文含上证 3934.40（-0.43%）、全市场 931 家上涨 / 4192 家下跌、49 个板块涨跌榜与自选池复盘
- 基金日报：`2026-09-10` 生成成功，自选基金平均 -0.43%，仅保留有真实估值的标的（降级数据已剔除）
- 历史日报：`POST {kind:"stock", date:"2026-09-09"}` 补生成成功，指数取自 `/index/kline`，缺失项标注「全市场涨跌家数 / 行业板块（上游仅提供当日数据）」
- 侧车实测：`/market/breadth` → 上涨 931 / 下跌 4192 / 涨停 39 / 跌停 14 / 活跃度 17.84%；`/market/sectors` → 49 个板块，领涨 船舶制造 +2.61%
- 任务日志：`/api/admin/observability` 的 `recentJobs` 已出现 `daily-report/success`

### 风险与遗留

- 全市场涨跌家数与行业板块上游只提供「当日」口径，历史日期补生成的日报会在正文与面板显式标注该缺失
- 定时任务依赖 Next 进程存活，与既有 cleanup / 预警扫描约束一致；未启动时段可用面板「立即生成」或按指定日期补生成
- 面板交互（勾选模块、点击列表、日期选择器）为客户端行为，已通过 SSR 渲染与接口级验证；建议在浏览器里再点一遍确认视觉效果
## 自选代码存在性校验与「无数据」弹窗验收（2026-09-10）

- 关联文档：`docs/design.md`（统一响应约定）、`README.md`（自选池说明）
- 分支：`feature/watchlist-verify-code`
- 目标：新增自选股/自选基金时，若代码在权威上游查不到可靠数据，弹窗提示「当前无数据，请检查输入代码是否正确」，并阻止写入自选池。

### 可行性分析

- 现状缺陷：`buildWatchlistItem` / `buildFundWatchlistItem` 只校验 6 位数字，非法代码（如 `560713`）会被写入自选池，后续所有面板走 `deterministic-fallback` 造出看起来真实的假价格。
- 权威上游可判空：腾讯 `qt.gtimg.cn` 对不存在的代码返回 `v_pv_none_match="1"`，字段数不足 47，侧车现有解析函数天然拒收；基金可用 AkShare `fund_name_em()` 全市场名录判存在性。
- 关键约束：必须区分「代码不存在」与「上游不可用」。上游不可用时误拦会伤及正常用户，因此采用三态结论 `ok / not_found / upstream_unavailable`，仅 `not_found` 拦截。
- 退市、停牌标的仍有可靠名称与历史数据（腾讯不会返回 none_match），不拦截，避免误伤。

### 验收项

- [x] 侧车 `GET /quote/verify?code=` 返回三态结论，`not_found` 仅在上游可达但无数据时给出
- [x] 侧车 `GET /fund/verify?code=` 返回三态结论，场内基金用腾讯实时行情、场外基金用东财名录/同花顺档案判定
- [x] 侧车不可达（连接失败/非 2xx）时 Web 端按「上游不可用」放行，不误拦
- [x] `POST /api/watchlist` 对未知代码返回 400 `CODE_NOT_FOUND`，提示含「当前无数据，请检查输入代码是否正确」
- [x] `POST /api/fund-watchlist` 对未知代码（如 `560713`）返回 400 `CODE_NOT_FOUND`，同上
- [x] 合法代码（如 `600519`、`560710`、`110022`）仍可正常添加
- [x] 新增单按钮提示弹窗组件 `NoticeDialog`，与红色删除确认弹窗区分
- [x] 左侧自选边栏（`WatchlistSidebar`、`FundWatchlistPanel`）与自选面板均捕获 `CODE_NOT_FOUND` 并弹窗提示，其他错误仍走行内错误条
- [x] 添加成功时用上游真实名称回填自选条目，避免显示「股票 xxxxxx / 基金 xxxxxx」
- [x] 纯函数 `resolveVerifyVerdict` 等有单元测试覆盖
- [x] `corepack pnpm test`、`typecheck`、`lint`、`build` 全部通过
- [x] 中文注释，未提交临时文件

### 验证方式

- 侧车：`curl "http://127.0.0.1:8000/quote/verify?code=sh600519"` → `ok`；`?code=sh999999` → `not_found`
- 侧车：`curl "http://127.0.0.1:8000/fund/verify?code=560710"` → `ok`；`?code=560713` → `not_found`
- 端到端：`POST /api/fund-watchlist {code:"560713"}` → 400 `CODE_NOT_FOUND`；`{code:"560710"}` → 201 且名称为真实基金名
- 停掉侧车后 `POST /api/watchlist {code:"600519"}` → 仍可添加（放行策略生效）
- 命令：`corepack pnpm test && corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`

### 实测结果（2026-09-10）

- 侧车 `/quote/verify`：`600519` → `ok`（名称 UTF-8 校验为「贵州茅台」）、`600001` → `ok`（退市股仍有可靠行情，按设计放行）、`999999` / `000000` → `not_found`
- 侧车 `/fund/verify`：`560710` → `ok exchange`（船舶ETF富国）、`510300` → `ok`、`110022` → `ok otc`、`560713` / `999999` → `not_found`
- 端到端拦截：`POST /api/fund-watchlist {code:"560713"}` → 400 `CODE_NOT_FOUND`；`POST /api/watchlist {code:"000000"}` → 400 `CODE_NOT_FOUND`
- 名称回填：`POST /api/fund-watchlist {code:"159915"}` → 201 且名称为「创业板ETF易方达」；`POST /api/watchlist {code:"600001"}` → 201 且名称为「邯郸钢铁」（验证后已删除，自选池恢复原状）
- 防误拦：停掉侧车后 `POST /api/fund-watchlist {code:"560713"}` → 201（按上游不可用放行），恢复侧车后重新拦截
- 重复校验前置：已在自选池中的 `560710` 直接返回 409，不会额外发起上游校验
- 命令：`corepack pnpm test`（11 文件 / 137 用例）、`typecheck`、`lint`、`build` 全部通过
- 弹窗入口覆盖：个股入口同时存在 `WatchlistSidebar`（实际使用）与遗留的 `WatchlistPanel`，两者与基金 `FundWatchlistPanel` 均已接入 `NoticeDialog`；排查确认没有其他写入自选池的入口。

### 风险与遗留

- 东财基金名录偶发不可用时按「上游不可用」放行；新成立且尚未进入名录的场外基金存在极小概率被误拦，已在判定中增加同花顺档案作为正向兜底。
- 界面弹窗为客户端行为，已通过接口与构建验证，建议在浏览器里再手动点一次确认视觉效果。
## 自选名称自愈（历史占位名回填）验收（2026-09-10）

- 分支：`fix/watchlist-name-selfheal`
- 背景：上一轮只在「新增」时回填上游名称，历史数据里已存在的「基金 560710 / 股票 600519」占位名不会更新，左侧栏一直显示占位名。

### 验收项

- [x] 仓储新增 `updateName(code, name)`：接口、PostgreSQL 实现、本地 JSON 回退实现三处齐备
- [x] 新增纯模块 `src/lib/watchlist-name-repair.ts`，仅对占位名发起回填，单次最多 5 条
- [x] 占位名识别 `isPlaceholderName` 严格匹配「基金|股票 + 6 位数字」，真实名称不误判
- [x] `GET /api/watchlist`、`GET /api/fund-watchlist` 读取时自愈并返回回填后的名称
- [x] 上游查不到、返回非 ok、或抛异常时保留原名称，不影响列表返回与其它条目
- [x] 回填结果落库持久化（PostgreSQL 实测）
- [x] 单元测试覆盖：无占位名不请求上游、命中回填、上游异常保留、异常隔离、股票口径
- [x] `corepack pnpm test`（12 文件 / 144 用例）、`typecheck`、`lint` 全部通过

### 实测结果（2026-09-10）

- 基金：`GET /api/fund-watchlist` 后 `560710` 由「基金 560710」回填为「船舶ETF富国」，PostgreSQL `fund_watchlist` 行同步更新，二次读取保持
- 个股：向 `watchlist` 插入占位行「股票 600519」后 `GET /api/watchlist` 回填为「贵州茅台」并落库；验证后已删除该测试行，自选池恢复原状
- 未被占位的 `510300`（沪深300ETF）不触发上游校验，保持不变

### 风险与遗留

- 回填在列表读取时同步执行，占位条目会带来一次上游请求（腾讯约 0.3 秒）；回填成功后名称不再命中占位规则，不会重复请求。

## 个股投资组合与策略回测学习台验收（已完成，2026-09-11）

- 关联文档：`docs/stock-portfolio-backtest-plan.md`（v0.1）
- 分支：`feature/stock-portfolio-backtest`
- 目标：个股工作台新增「我的持仓组合」「策略回测」两个模块，与基金侧组合/回测能力对齐。

### 需求确认（用户已答复）

- [x] 串行开发：先做本特性，合并后再做实时推送
- [x] 持仓仅手动录入，字段为代码、投入金额、目前持仓收益，不做 CSV 导入
- [x] 回测一并包含组合权重再平衡
- [x] 实时推送默认值沿用建议（5 秒、仅自选池、默认关闭开关、通知 3→10）

### 验收项

- [x] 新增共享类型 `src/lib/shared/types/stock-portfolio.ts`、`stock-backtest.ts`，未修改既有字段语义
- [x] 新增 `stock_holdings` 表（只新增，不改既有表），并配套 `.data/stock-portfolio.json` 本地回退
- [x] 仓储支持增/删/改/查：PostgreSQL 实测通过，本地 JSON 回退由单测覆盖
- [x] 录入持仓前做代码存在性校验，未知代码返回 `CODE_NOT_FOUND`；上游不可用时放行
- [x] 新增成功用上游真实名称回填（600519 → 贵州茅台）
- [x] 组合汇总口径正确：总投入、总市值、累计收益/收益率、当日盈亏、持仓数量
- [x] 权重排序与行业分布展示正确
- [x] 行情来源、更新时间与降级标注可见（取不到行情时该条仅展示手工口径）
- [x] 回测引擎为纯函数并具备单测：双均线、MACD、RSI、布林带四类信号
- [x] 回测支持手续费、卖出印花税、滑点与初始资金；组合再平衡按卖出名义金额计印花税
- [x] 输出净值曲线、总收益、年化、最大回撤与修复、夏普/索提诺/卡玛、交易次数、胜率、平均持有天数、买入持有基准与逐笔明细
- [x] 侧车 `/kline` 的 `limit` 上限由 240 放宽到 1500，返回结构不变
- [x] 样本不足或数据源为确定性降级时拒绝回测并给出明确提示
- [x] 页面固定标注前复权口径与「仅供学习，不构成投资建议」
- [x] 个股工作台模块勾选新增 `portfolio`、`backtest`，勾选后必有可见反馈
- [x] `corepack pnpm test`（14 文件 / 174 用例）、`typecheck`、`lint`、`build` 全部通过
- [x] 代码注释与提交信息为中文，未提交真实密钥与临时文件

### 验证方式

- 命令：`corepack pnpm test && corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 侧车：`curl "http://127.0.0.1:8000/kline?code=600519&period=day&adjust=qfq&limit=1000"`
- 接口：`GET/POST /api/stock-portfolio`、`PATCH/DELETE /api/stock-portfolio/{id}`、`POST /api/stock-backtest`
- 端到端：录入 2–3 只持仓 → 汇总与权重正确 → 改份额后市值同步 → 删除后汇总同步
- 端到端：对 `600519` 跑双均线回测，核对净值曲线、交易明细与基准对比

### 实测结果（2026-09-11）

- 组合接口：POST 600519（投入 10 万、收益 5 千）→ 市值 105000、收益率 5%、当日盈亏 -793.45（按当日 -0.75% 反推）；PATCH 改为 12 万/亏 8 千 → 收益率 -6.67%；DELETE 后组合归零
- 错误路径：重复代码 → 409；`689999` → 400 `CODE_NOT_FOUND`（文案含「当前无数据，请检查输入代码是否正确」）；金额 0 → 400
- 名称回填：上游返回「贵州茅台」并落库；组合汇总行业分布显示「白酒」
- 回测（600519 近 5 个月，MA5/MA20）：112 根、策略 +5.71%、基准 -10.22%、最大回撤 6.45%、2 笔交易、胜率 50%，未平仓部分按最后收盘价强制结算
- 回测（600519 + 000001 每月再平衡，近 5 个月）：112 根、调仓 5 次，胜率与平均持有天数按设计不适用
- 拒绝路径：请求 2 年以上区间时，当前侧车仍为旧上限（240），接口按设计返回 503「未取到真实历史 K 线」，不会用演示数据出结果
- 侧车独立验证：使用新代码启动的实例 `/kline?limit=1500` 返回 1500 根真实日线（首根 2020-07-09），`limit=1600` 返回 422
- 数据库：`stock_holdings` 迁移已应用且未生成回退文件，证明读写走 PostgreSQL

### 风险与遗留

- 本机行情侧车已按新代码重启，`/kline` 上限 1500 生效；后续如侧车进程被替换为旧版本需再次重启
- 组合收益为手工录入值，与券商实际持仓可能存在偏差，后续如需可另行评估对账单导入
- 胜率、平均持有天数对组合再平衡模式不适用，界面已显式标注

## 实时行情推送与站内预警验收（已完成，2026-09-11）

- 关联文档：`docs/realtime-quote-push-plan.md`（v0.1）
- 分支：`feature/realtime-quote-push`
- 目标：自选池行情秒级推送、预警盘中实时判定与站内通知，解除 3 标的限制。

### 验收项

- [x] 侧车新增 `/quotes` 批量接口：上限 50 个代码，非法输入返回 400，单代码缺失不整批失败
- [x] `/quote` 单代码接口保持不变（向后兼容）
- [x] 新增 `GET /api/stream/quotes` SSE：事件类型含 snapshot / alert / status / heartbeat
- [x] 服务端轮询器为单例，多订阅者合并去重后只发起一次批量拉取
- [x] 交易时段按 `QUOTE_STREAM_INTERVAL_MS`（默认 5000，下限 3000）推送，非交易时段降频并标注休市
- [x] 上游连续失败时指数退避降频，连接不中断并标注降级来源
- [x] 前端实时开关默认关闭，开启后才建连；页面隐藏时快照应用降频到 30 秒
- [x] 自选池边栏与基金面板展示实时价并标注「实时」；实时行情条展示快照与更新时间
- [x] 连接状态指示灯正确反映未开启/连接中/已连接/降级重连，并提供手动「重连」
- [x] 预警复用既有 `evaluateAlertRule` 与冷却逻辑，命中后事件流与站内通知立即可见
- [x] 浏览器通知需用户授权，被拒时降级为站内 toast，不阻塞功能
- [x] 提示音可开关，默认关闭（WebAudio 生成，无需音频资源）
- [x] 30 分钟 `ALERT_CRON` 保留为兜底，邮件通道行为不变
- [x] `ALERT_MAX_TARGETS` 默认由 3 放宽到 10，仍可配置
- [x] 基金实时口径走 `/fund/intraday`（场内实时价 / 场外盘中估算），与股票批量接口分桶合并且互不串号
- [x] `corepack pnpm test`（16 文件 / 196 用例）、`typecheck`、`lint`、`build` 全部通过
- [x] 代码注释与提交信息为中文，未提交真实密钥与临时文件

### 验证方式

- 命令：`corepack pnpm test && corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 侧车：`curl "http://127.0.0.1:8000/quotes?codes=600519,000001,510300"` 返回 3 条；`codes=abc` 返回 400
- 端到端：开启实时开关，观察自选池刷新与状态灯；停掉侧车后确认降级与自动重连
- 端到端：设置易触发条件（如「当日涨跌幅 ≤ -0.01%」），确认站内即时通知与 12 小时冷却
- 长跑观察：连续连接 10 分钟，确认上游请求次数与推送次数比值接近 1

### 实测结果（2026-09-11）

- 侧车 `/quotes`：`codes=600519,000001,510300` 返回 2 条 + `missing:["510300"]`、`source=akshare`；`codes=abc` → 400「非法代码：abc」；51 个代码 → 400「一次最多查询 50 个代码」；`/quote?code=600519` 返回结构不变
- SSE：`codes=600519,000001&target=stock` 连续 16 秒收到 3 组 snapshot（间隔约 5-6 秒）与对应 status，价格随行情变化（1275.44 → 1275.55 → 1275.45）
- 单例合并：同时建立股票（600519,000001）与基金（510300）两条连接，status 显示 `connected_clients=2 / subscribing_codes=3 / last_fetch_ok=true`；两条流按订阅过滤，互不含对方代码
- 基金口径：`target=fund&codes=510300` 返回 `price=4.588 / change_pct=-0.63 / source=akshare`
- 降级：订阅侧车查不到的 `689999` 时连接保持，只发 heartbeat + status，`degraded=true`、`consecutive_failures=2`、`interval_ms` 由 5000 退避到 20000
- 实时预警：创建「600519 当日涨跌幅 ≤ 0%」规则后开启流，约 4 秒内收到 `alert` 事件（当前 -0.65%），事件落库 `status=unread`；随后 13 秒内不再重复触发，12 小时冷却生效
- 回归清理：验证用的自选股、规则与事件已全部删除，`/api/watchlist` 与 `/api/alerts/events` 均恢复为空；`.env` 的 `ALERT_MAX_TARGETS` 由 3 调整为 10（本地文件，不入库）
- 侧车已用新代码重启并确认 `/kline?limit=1500` 上限生效，个股回测的长区间样本问题随之解除

### 风险与遗留

- 上游限流/封禁是最大风险，依赖批量合并、最小间隔、失败退避、非交易时段停推四项共同兜底。
- 轮询器为进程内单例，多实例部署会重复拉取；本机单用户场景可接受，不适用多实例。
- 基金实时值受 `getFundIntraday` 60 秒缓存限制，推送频率高于其更新频率，界面已标注「盘中估算、存在延迟」。
- 实时预警只覆盖快照能提供的指标（股票最新价/涨跌幅、基金估算净值/涨跌幅）；单位净值、区间回撤等仍由 30 分钟定时扫描兜底。


## 历史日期日报数据回补（成交额 / 涨跌家数 / 行业板块）

- 关联文档：`docs/daily-report-history-backfill-plan.md`、`docs/daily-report-plan.md`
- 分支：`fix/daily-report-history-data`
- 背景：按 2026-09-11 补生成股市日报时，正文出现「成交额均为 0」「全市场涨跌家数缺失」「行业板块涨跌缺失」三处「本日该数据不可用」。

### 验收项

- [x] 侧车 `/index/kline` 出参新增 `amount`（腾讯日线第 9 位，单位元），实测 `sh000001` 2026-09-11 成交额 958,186,337,000 元（约 9581.86 亿元）
- [x] 侧车 `/market/sectors?date=YYYY-MM-DD` 支持历史日期（同花顺 90 行业板块、并发 6、按日期缓存），未传 date 时行为与改造前一致（仍为新浪 49 板块、`source=akshare`）
- [x] 侧车 `/market/breadth?date=YYYY-MM-DD`：乐咕 `stat_date` 与目标日期一致时返回真实家数（`stat_scope=market`）
- [x] 侧车 `/market/breadth?date=YYYY-MM-DD`：乐咕对不上时给出板块口径近似（`stat_scope=sector`）并用涨停/跌停池补涨跌停家数
- [x] `IndexKlineDay` 新增 `amount`；`MarketBreadthSnapshot` 新增 `stat_scope`，`limit_up/limit_down/suspended` 允许 null
- [x] `collectDailyReportData` 历史日期也采集涨跌家数与行业板块，缺失原因区分「该日期上游无可用数据」与口径说明
- [x] 模板日报：指数区块含成交额列；板块与涨跌家数标注统计口径；不再笼统写「不可用」
- [x] 提示词：要求引用成交额、板块口径必须写明口径、不得泄漏 `stat_scope` 等字段名
- [x] 端到端：`POST /api/admin/daily-reports {kind:"stock", date:"2026-09-11", force:true}` 重新生成后，三处均不再出现「本日该数据不可用」
- [x] 回归：当日口径接口（`/market/breadth`、`/market/sectors` 不传 date）行为不变
- [x] `corepack pnpm test`（16 文件 / 200 用例）、`typecheck`、`lint`、`build` 全部通过
- [x] 代码注释与提交信息为中文，未提交临时探测脚本与真实密钥

### 验证方式

- 命令：`corepack pnpm test && corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 侧车：`curl "http://127.0.0.1:8000/index/kline?code=sh000001&limit=60"`、`curl "http://127.0.0.1:8000/market/sectors?date=2026-09-11"`、`curl "http://127.0.0.1:8000/market/breadth?date=2026-09-11"`、`curl "http://127.0.0.1:8000/market/breadth?date=2026-09-08"`
- 端到端：强制重新生成 2026-09-11 股市日报，核对正文三项数据

### 实测结果（2026-09-13）

- 侧车 `/index/kline?code=sh000001&limit=60`：2026-09-11 记录新增 `amount=958186337000`（约 9581.86 亿元），与腾讯日线一致
- 侧车 `/market/sectors?date=2026-09-11`：`total=90`、`source=ths`、耗时约 13 秒；领涨 元件 +3.11%、通信设备 +0.42%，领跌 多元金融 -4.47%、工业金属 -4.04%，与实测探测一致
- 侧车 `/market/breadth?date=2026-09-11`：命中乐咕快照（`stat_date=2026-09-11 15:00:00`），`up=604 / down=4567 / flat=36 / limit_up=40 / limit_down=21 / suspended=12 / stat_scope=market`
- 侧车 `/market/breadth?date=2026-09-08`：乐咕对不上 → 板块口径，`up=67 / down=23 / flat=0`、`limit_up=73 / limit_down=0`、`stat_scope=sector`、`activity_pct=null`，耗时约 13 秒
- 当日口径回归：`/market/breadth` 不带 date 仍返回乐咕当日数据；`/market/sectors?limit=5` 不带 date 仍为新浪 49 板块 `source=akshare`
- 端到端重新生成 2026-09-11 股市日报：`missing=[]`；`indices` 三个指数成交额分别为 9581.86 / 10137.12 / 4577.45 亿元；板块 90 个（`source=ths`）；指标卡片新增「涨跌家数 604 / 4567」与「领涨板块 元件 +3.11%」
- 正文核对：`不可用` 出现 0 次；`成交额` 出现 8 次；正文含「沪深两市合计成交额约 1.97 万亿元」「上涨家数 604 家 / 下跌家数 4567 家」「行业板块统计样本共 90 个」；字段名 `stat_scope` 泄漏 0 次
- 单测新增 4 例（成交额格式化、模板成交额列、板块口径标注与指标/摘要改写、个股口径不变），全套 200 例通过

### 风险与遗留

- 历史板块回补需 90 次上游请求（实测约 13-15 秒），已做并发 6 与按日期 6 小时缓存；上游限流时允许部分板块缺失，不会整批失败。
- 更早历史日期的「个股涨跌家数」无公开历史接口，只能给出行业板块口径近似并显式标注，不能当作真实家数。
- 侧车缓存为进程内缓存，重启后首次请求（含历史日期）需重新拉取。
- 未额外生成 2026-09-08 日报做端到端验证，以免污染日报列表；该口径由侧车实测 + 单测覆盖。

## 基金日报「数据不可用」噪声修复

- 关联文档：`docs/daily-report-history-backfill-plan.md` 第 8 节
- 分支：`fix/daily-report-fund-wording`
- 背景：基金日报 `missing` 为空，正文却出现 4-5 处「本日该数据不可用」（份额变化、折溢价率、跟踪误差、北向资金、两融余额，以及「板块成分公司数为 0 不可用」）。

### 验收项

- [x] 提示词限定：只有「缺失数据项」列出的内容才允许写「本日该数据不可用」，契约外指标不得提及
- [x] `missing` 为空时，user 提示显式声明「正文中不得出现『不可用』『数据缺失』」
- [x] 新增「数据口径说明」：历史板块不提供成分公司数与领涨股；板块口径涨跌家数必须写明口径；活跃度不得换算成涨跌家数占比
- [x] 侧车历史板块 `companies` 由 `0` 改为 `null`，`MarketSectorItem.companies` 允许 null
- [x] 端到端：`fund/2026-09-11`、`stock/2026-09-11` 强制重新生成后「不可用」「数据缺失」「字段名泄漏」均为 0
- [x] 新增单测 2 例；`corepack pnpm test`（16 文件 / 202 用例）、`typecheck`、`lint`、`build` 全部通过
- [x] 代码注释与提交信息为中文

### 实测结果（2026-09-13）

- `fund/2026-09-11`：`missing=[]`，「不可用」0 次、「数据缺失」0 次、`stat_scope|nav_date|companies|activity_pct` 字段名泄漏 0 次，正文 1697 字
- `stock/2026-09-11`：同上口径全部为 0，正文 2244 字
- 板块 JSON：`{"name":"元件","change_pct":3.11,"companies":null,...,"leader":null}`，模型改写为「行业板块为历史回补口径的同花顺板块指数，不提供成分公司数与领涨股」，不再报缺失
- 活跃度口径：正文改为「市场活跃度指标为 11.57%，该指标与涨跌家数来自不同统计口径，不宜直接换算成涨跌占比」

### 风险与遗留

- 提示词约束依赖模型遵守，仍可能在个别日期出现措辞漂移；如需强约束可在生成后增加关键词校验（本次未做）。
- 9-10 及更早日期的历史日报仍是旧提示词产物，如需同样效果需 `force` 重新生成。

## A 组日报能力收尾（对比 / 批量回补 / 删除 / 推送）

- 关联文档：`docs/daily-report-roundup-plan.md`、`docs/daily-report-plan.md`
- 分支：`feature/daily-report-roundup`
- 背景：日报只有单日快照、无法批量回补或删除、生成后无通知；历史日报口径与新版不一致。

### 验收项

- [x] 契约新增 `DailyReportComparison`（指数环比 + 板块轮动）并接入 `DailyReportData.comparison`
- [x] 侧车历史板块返回 `prev_change_pct` / `prev_date` 与 `comparison` 块；`/market/sectors?history=1` 可强制同花顺口径
- [x] `collectIndices` / `collectSectors` 返回对比数据；当日路径补日线请求，历史路径复用同一份数据
- [x] 模板：指数区块含「较前一交易日」「成交额环比」，板块区块含「板块轮动」「前一交易日涨跌分布」
- [x] 提示词：要求引用对比数据并写明口径；无对比数据时不得写「不可用」；涨跌家数不做环比
- [x] `DELETE /api/admin/daily-reports/{kind}/{date}` 删除 R2 与本地对象并同步索引
- [x] `POST /api/admin/daily-reports/backfill` 支持 `{ kind, days, force? }`，按交易日历取最近 N 个交易日（上限 30，单日失败不中断整批）
- [x] `src/lib/daily-report-email.ts`：摘要构造（纯函数）+ 发送；未配置 SMTP/收件人时跳过不影响落库；回补历史日报不重复推送
- [x] `DailyReportJobResult` 增加 `email_status` / `email_reason`，面板展示推送结果
- [x] 面板新增「回补最近 N 个交易日」「删除该日日报」，并修正历史口径提示文案
- [x] 稳健性：指数日线带一次重试，且指数先取完再并发板块/涨跌家数，避免历史回补时指数缺失
- [x] A4：9-09、9-10、9-11 股市与基金日报用新口径重新生成，正文无「不可用」
- [x] `corepack pnpm test`、`typecheck`、`lint`、`build` 全部通过
- [x] 代码注释与提交信息为中文，未提交临时脚本与真实密钥

### 验证方式

- 命令：`corepack pnpm test && corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 侧车：`curl "http://127.0.0.1:8000/market/sectors?date=2026-09-11"`、`curl "http://127.0.0.1:8000/market/sectors?date=2026-09-11&history=1"`
- 接口：`POST /api/admin/daily-reports/backfill`、`DELETE /api/admin/daily-reports/stock/2026-09-09`
- 端到端：重新生成 9-11 股市/基金日报，核对环比数字与板块轮动；核对邮件状态字段

### 实测结果（2026-09-13）

- 侧车：`/market/sectors?date=2026-09-11&history=1` 返回 90 个板块、`source=ths`，单项含 `prev_change_pct`（元件 3.11% / 前一日 1.31%）；`comparison` 为 `{"prev_date":"2026-09-10","prev_rise_count":10,"prev_fall_count":80,"newcomers":["通信设备","影视院线","军工电子","军工装备"],"dropped":["银行","厨卫电器","多元金融","电力"]}`
- `DELETE /api/admin/daily-reports/stock/2026-09-09`：`{"deleted":true,"storage":"r2"}`，列表从 3 篇降到 2 篇，本地无残留文件
- `POST /api/admin/daily-reports/backfill {kind:"stock",days:3}`：返回 `days=3`、`dates=[09-11,09-10,09-09]`，`generated=1`（09-09 已删除故补生成）、`skipped=2`（已存在），耗时 35 秒；逐日结果 `email_status=skipped`（回补不推送）
- `POST /api/admin/daily-reports/backfill {kind:"fund",days:3,force:true}`：`generated=3`、`skipped=0`，耗时 39 秒
- 日报正文（股市 09-09/09-10/09-11、基金 09-09/09-10/09-11 共 6 篇）：`missing=[]`，「不可用」0 次、「数据缺失」0 次；每篇 `comparison.indices=3` 且含 `sectors` 轮动数据
- 环比数字抽查（stock/2026-09-09）：三个指数成交额环比 -4.57% / -6.02% / -8.53%，与日线一致；板块轮动写明前五名全部换手
- 邮件：收件人 `ALERT_EMAIL_TO` 仍为占位地址（`replace-me@example.com`），单日生成返回 `email_status=failed`、`email_reason="Message failed: 550 The recipient may contain a non-existent account"`；日报仍正常落 R2，符合「推送失败不影响落库」；换成真实收件邮箱即可发送
- 命令：`corepack pnpm test`（17 文件 / 215 用例）、`typecheck`、`lint`、`build` 全部通过

### 风险与遗留

- 当日生成日报时会额外请求一次同花顺历史口径（约 13 秒，按日期缓存 6 小时）；交易日内若当日板块 K 线尚未生成，`comparison` 为 null，正文自动省略对比段落（不写「不可用」）。
- 涨跌家数没有跨日历史接口，因此不做环比，已在提示词与口径说明中明确。
- 邮件推送无重试队列；失败原因写入 `job_runs` 与面板提示。
- 板块轮动固定取涨幅前五（与前端 `limit=5` 一致），若后续调整榜单长度需同步 `SECTOR_ROTATION_TOP`。

## E 组工程质量（编排层测试补强 / 定时任务守护）

- 关联文档：`docs/engineering-quality-plan.md`、`checklist.md`（T1 测试基建、A 组日报收尾）
- 分支：`feature/engineering-quality`
- 目标：E1 给 data-service 客户端、日报采集、scheduler 等编排层补测试；E2 让定时任务在服务端启动时确定性注册，并具备独立 worker 与断点补跑能力。

### 验收项

- [x] E1：新增 `tests/data-service-client.test.ts`，覆盖侧车客户端成功/非法结构/HTTP 失败/网络异常分支
- [x] E1：新增 `tests/daily-report-collect.test.ts`，覆盖当日与历史采集、对比组装、缺数据回退、降级自选池剔除
- [x] E1：新增 `tests/scheduler-jobs.test.ts`，覆盖各任务编排、`job_runs` 落库与失败记录
- [x] E1：新增 `tests/observability.test.ts`、`tests/observability-db.test.ts` 与 `tests/alert-email.test.ts`
- [x] E1：`src/lib/**` 行覆盖率由 32.69% 提升到 45% 以上（顶层 `src/lib` 33.05% → 47.65%）；`data-service.ts` ≥ 80%、`scheduler.ts` ≥ 60%、`observability.ts` ≥ 70%
- [x] E2：`src/instrumentation.ts` 在服务端启动时注册定时任务，构建阶段跳过
- [x] E2：`src/lib/scheduler-guard.ts` 提供调度表、过期判定、状态汇总与补跑编排（纯逻辑可单测）
- [x] E2：`GET /api/admin/scheduler/status` 返回各任务最近运行时间与是否过期
- [x] E2：`POST /api/admin/scheduler/tick` 仅补跑过期任务，单项失败不影响其它项，写接口有令牌鉴权
- [x] E2：`scripts/scheduler-worker.mjs` 独立进程支持 `--once`/`--interval`/`--max-failures` 与优雅退出
- [x] E2：`.env.example`、README、`start.bat`/`start.sh` 提供守护配置与开关
- [x] `corepack pnpm test`、`typecheck`、`lint`、`build` 全部通过
- [x] 代码注释与提交信息为中文，未提交临时脚本与真实密钥

### 验证方式

- 覆盖率：`corepack pnpm test:coverage`（对比基线 `src/lib/**` 33.05%）
- 守护：`corepack pnpm build` 后 `node scripts/scheduler-worker.mjs --once`；`curl -H "x-scheduler-token: ..." -X POST http://127.0.0.1:3000/api/admin/scheduler/tick`
- 回归：`corepack pnpm test && corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`

### 实测结果（2026-09-13）

- 覆盖率（`corepack pnpm test:coverage`，34 个文件 / 360 用例全绿）：`src/lib/**` 行覆盖率 **48.25%**（基线 **32.69%**，均为 coverage include 口径的 `All files` 行）；顶层 `src/lib`（表格 `lib` 行）33.05% → **47.65%**；`data-service.ts` **83.33%**（基线 8.33%）、`scheduler.ts` **82.87%**（基线 9.79%）、`scheduler-guard.ts` **100%**、`observability.ts` **96.61%**（基线 8.47%）
- 其它关键模块：`news.ts` 2.42% → **85.02%**、`store/index.ts` 14.01% → **91.58%**、`market-data.ts` 12.76% → **100%（语句）**、`daily-report.ts` 50.3% → **80%**、`alert-email.ts` 35.13% → **81.08%**、`deterministic.ts` 1.11% → **100%**、`trading-calendar.ts` 45.31% → **98.43%**、`cache.ts`/`api-response.ts`/`mock/index.ts` 100%；`observability.ts` 8.47% → **96.61%**（补 `tests/observability-db.test.ts` 覆盖落库与水合分支）
- 测试纪律：新增用例不访问网络（`fetch` 全部 stub）、不依赖真实时钟（显式注入 `now`）、不依赖真实数据库（store / drizzle 替身）；`corepack pnpm test` 34 文件 / 360 用例全部通过
- 启动注册：`corepack pnpm build` 后另起 `next start -p 3100`，**未访问任何 admin 接口**直接请求 `/api/admin/scheduler/status` 得到 `schedulerRegistered=true`，证明 `src/instrumentation.ts` 在服务端启动时完成注册；构建阶段与 Edge 运行时不注册
- 状态接口：`GET /api/admin/scheduler/status` 返回 6 个任务的 `cron`/`lastRunAt`/`lastRunAgeMinutes`/`stale`/`skipReason`；实测周日（非交易日）`staleCount=3`（资讯清理、行情刷新、基金刷新过期），预警与日报任务 `skipReason=非交易日`
- 补跑接口：`node scripts/scheduler-worker.mjs --once` 发现 3 个过期任务 → `POST /api/admin/scheduler/tick` 返回「执行 3 项，失败 0 项，跳过 0 项」，补跑后 `staleCount` 归 0 且各任务 `lastRunAt` 更新
- 鉴权：未配置 `SCHEDULER_TOKEN` 时，带 `x-forwarded-for: 203.0.113.9` 的写请求返回 `403 FORBIDDEN`「未配置 SCHEDULER_TOKEN 时只允许本机触发」；`127.0.0.1`、`::1`、`::ffff:127.0.0.1` 等本机来源放行
- 守护进程：`--once` 在应用未启动时打印「健康检查失败……应用可能未启动」并以 0 退出；非法参数打印帮助并以 2 退出；`scripts/start-scheduler.ps1` 写入 `.logs/scheduler-worker.pid` 并拉起 worker（日志「调度状态正常，无过期任务。」），`-Stop` 回收进程并删除 pid 文件；`SKIP_SCHEDULER_WORKER=1` 输出跳过提示
- 命令：`corepack pnpm test`、`typecheck`、`lint`、`build` 全部通过

### 风险与遗留

- 守护进程只做「发现停摆 + 补齐过期任务」，不负责拉起已退出的 Web 进程。
- 补跑阈值按经验设定（日报/清理 26 小时、预警 2 小时），如需更细粒度可在 `SCHEDULE_TABLE` 调整。


## 修复：策略回测净值曲线悬停错位（2026-09-13）

- 关联文档：`docs/stock-portfolio-backtest-plan.md`（§9 修复记录）、`docs/design.md`
- 分支：`fix/backtest-chart-hover`（对位修复）、`fix/backtest-chart-fit-card`（铺满卡片）
- 现象：个股「策略回测」的净值曲线在宽屏下，鼠标悬停的十字线与提示日期和光标位置不对应，快速移动后错位明显。

### 验收项

- [x] 根因定位：`<svg>` 使用 `h-72 w-full` 固定高度，元素宽高比与 `viewBox`（900×320）不一致，默认 `preserveAspectRatio="xMidYMid meet"` 会等比缩放后左右居中留白；原实现按整幅元素宽度线性映射，未扣除留白
- [x] 新增纯函数 `src/lib/chart-hover.ts`：`resolveMeetTransform` 计算缩放比与居中留白，`resolveHoverIndex` 换算悬停索引并钳制到首尾
- [x] `BacktestEquityChart` 改用 `resolveHoverIndex` 并显式声明 `preserveAspectRatio="xMidYMid meet"`；净值路径与刻度计算移入 `useMemo`，避免每次移动重算
- [x] 曲线铺满卡片：`<svg>` 改用基金侧同款 `min-w-[720px]` + 外层 `overflow-x-auto` 自然宽高比，元素与 viewBox 等比、不再有居中留白；窄屏改为横向滚动
- [x] 新增 `tests/chart-hover.test.ts`（14 个用例）：左右留白、上下留白、等比一致（含铺满卡片）、窄屏横向滚动、元素偏移、越界钳制、尺寸非法与数据点不足
- [x] 既有模块无回归：`corepack pnpm test` 35 文件 / 374 用例全绿
- [x] `typecheck`、`lint`、`build` 全部通过

### 实测结果（2026-09-13）

- 修复前换算（元素 1096×288、viewBox 900×320）：受高度限制按 288/320=0.9 缩放，内容宽 810px、两侧各留白 (1096−810)/2=143px；光标停在绘图区左边缘时仍被算成第 12 个数据点（应为第 1 个）。
- 修复后：同一位置返回索引 0；绘图区右边缘返回最后一个索引；中点与四分位点与数据点索引成比例。
- 铺满卡片后元素宽高比与 viewBox 一致，`resolveMeetTransform` 的 `offsetX` 为 0；宽屏按「元素宽度 / 900」整体缩放，窄屏（<720px）由外层横向滚动、`rect.left` 为负时同样按实际位置换算（新增 2 个用例覆盖）。
- 面板宽度取自布局换算（内容列 `max-w-6xl` 1152px − `px-4` 32px − 卡片 `p-3` 24px ≈ 1096px），如需现场核对可在 DevTools 中量取 svg 元素宽度；该宽度下曲线高约 390px（900×320 自然比例）。
- 覆盖率：新增 `src/lib/chart-hover.ts` 行覆盖率 **95.23%**；`src/lib/**` 合计行覆盖率 48.42%（新增文件仅第 62 行未覆盖，合计较 E 组的 48.25% 略升）。
- 命令：`corepack pnpm test`（35 文件 / 374 用例）、`typecheck`、`lint`、`build` 全部通过。

### 风险与遗留

- 净值曲线已改为自然宽高比铺满卡片，宽屏不再留白；代价是图表高度随宽度变化（约 1096px 宽时高约 390px，原固定 288px）。
- 无浏览器端到端测试设施（仓库未引入 jsdom/Playwright），本次以纯函数单测覆盖换算逻辑，交互表现建议在页面上复核。


## 基金持有面板（养基宝式，2026-09-13）

- 关联文档：`docs/fund-positions-plan.md`
- 分支：`feature/fund-positions`
- 目标：基金工作台新增「持有基金」模块，手动录入基金代码、当前持有金额（市值）与当前累计收益，复用盘中行情（`/api/funds/{code}/intraday`）与历史净值（`/api/funds/{code}/nav`），逐只展示当日实时涨跌幅/收益、累计收益与持仓占比。

### 验收项

- [x] FP1 口径纯函数 `src/lib/fund-position-calc.ts`：当日实时收益、上一交易日累计收益、累计收益、累计收益率、持仓占比与降级回退
- [x] FP1 单测覆盖恒等式「上一交易日累计收益 + 当日实时收益 = 累计收益」，以及取不到估值/涨跌幅时的降级
- [x] FP2 存储 `src/lib/fund-position.ts`：新增 `fund_positions` 表 + `.data/fund-positions.json` 回退；校验持有金额/累计收益、代码去重与名称回填
- [x] FP2 接口 `GET/POST /api/fund-positions`、`PATCH/DELETE /api/fund-positions/{id}`
- [x] FP3 面板 `FundPositionsPanel`：录入、逐只指标、合计行、删除确认、口径与来源说明
- [x] FP3 模块注册：`FUND_MODULE_OPTIONS` 新增「持有基金」并在 `FundWorkbench` 挂载
- [x] FP4 `corepack pnpm test`、`typecheck`、`lint`、`build` 全部通过

### 实测结果

- 单测：`corepack pnpm test` 全量 37 个文件 / 404 个用例通过；本次 `tests/fund-position.test.ts`（19 例）与 `tests/fund-position-calc.test.ts`（11 例）覆盖新口径。
- 覆盖率（`corepack pnpm test:coverage`）：`src/lib/fund-position-calc.ts` 行 100% / 分支 97.22%；`src/lib/fund-position.ts` 行 73.30% / 分支 73.13% / 函数 67.31%（未覆盖部分为 PostgreSQL 仓储与故障回退包装）；`src/lib` 整体行覆盖 49.38%。
- 静态检查：`corepack pnpm typecheck`、`corepack pnpm lint` 均无报错。
- 构建：`corepack pnpm build` 通过，路由表中已出现 `/api/fund-positions` 与 `/api/fund-positions/[id]`。
- 端到端（dev 服务 3000 + 行情侧车 8000 实测，测试数据已清理）：
  - `GET /api/fund-positions` 空组合返回 200，`holdings_count = 0`，`total_day_profit = null`。
  - `POST` 场外 `110022`（持有金额 10000 / 累计收益 2000）：`cost_amount = 8000`、`total_profit_pct = 25%`、`nav_mode = "nav"`；非交易时段取不到当日涨跌幅，`day_profit` 与 `prev_total_profit` 为空，但持有金额与累计收益照常展示。
  - `POST` 场内 `510300`（持有金额 8000 / 累计收益 -300）：`nav_mode = "realtime"`、`estimated_nav = 4.58`、`change_pct = -0.82%`、`day_profit = -66.14`（= 8000 − 8000 / 0.9918）、`prev_total_profit = -233.86`，且 -233.86 + (-66.14) = -300 满足恒等式。
  - 组合口径：`total_market_value = 18000`、`total_cost = 16300`、`total_profit = 1700`、`total_profit_pct = 10.43%`、`total_day_profit = -66.14`；持仓占比 55.56% + 44.44% = 100%。
  - `PATCH /api/fund-positions/{id}` 改为持有金额 9000 / 累计收益 -500 → `cost_amount = 9500`、`total_profit_pct = -5.26%`。
  - 重复代码返回 409；`999999` 返回 400 `CODE_NOT_FOUND`；`DELETE` 两只后 `holdings_count` 回到 0。
- 口径说明（2026-09-13 按用户确认调整）：录入仅三项（代码 / 当前持有金额 / 当前累计收益），与个股持仓面板一致；推算本金 = 持有金额 − 累计收益；当日收益 = 持有金额 − 持有金额 /（1 + 当日涨跌幅）；上一交易日累计收益 = 累计收益 − 当日收益。
- 遗留：PostgreSQL 分支需配置 `DATABASE_URL` 并执行 `pnpm db:migrate`（迁移文件 `drizzle/0010_zippy_iron_man.sql`）后另行验证；仓库暂无浏览器端到端测试，建议在页面上复核录入、编辑与刷新交互。

## 配置文件同步（2026-09-13）

- 目标：排查仓库内配置类文件与当前开发版本的偏差，逐一补齐，避免文档/脚本落后于实现。
- 关联分支：`chore/config-sync`（配置同步不新增功能，从 `main` 切出后合并）。

### 排查与修正

- [x] `.env.example`：补齐 `SCHEDULER_TIMEZONE`（调度时区，代码已在 `scheduler.ts` / `scheduler-guard.ts` 读取）与 `SKIP_SCHEDULER_WORKER`（一键脚本开关）。
- [x] `README.md`：能力清单补「持有基金（养基宝式）」；环境变量表补 `SCHEDULER_TIMEZONE`、`SKIP_SCHEDULER_WORKER`、`DEEPSEEK_ANALYSIS_TIMEOUT_MS`；数据与降级补 `.data/stock-portfolio.json`、`.data/fund-positions.json`；健康检查补 `/api/fund-positions`；停止服务说明补守护进程回收；守护进程说明补 `start.ps1`。
- [x] `start.ps1`：与 `start.bat` / `start.sh` 对齐，启动时拉起 `scripts/start-scheduler.ps1`，退出时 `-Stop` 回收，并打印守护进程提示。
- [x] `scripts/stop.ps1`：进程特征补 `*scheduler-worker.mjs*`，并调用 `start-scheduler.ps1 -Stop` 回收守护进程与 pid 文件。
- [x] `stop.sh`：新增 `kill_matching "scheduler-worker.mjs"` 回收守护进程，完成提示同步更新；`stop.bat` 提示语同步。
- [x] `data-service/README.md`：从「仅 /health、/quote、/kline」更新为当前完整接口清单（行情/市场 10 个 + 基金 5 个），补充依赖与环境说明。
- [x] `data-service/pyproject.toml`、`data-service/environment.yml`：补声明代码直接 `import` 的 `pandas>=2.2`，描述改为「个股与基金行情数据侧车」。
- [x] `docs/design.md`：数据模型章节标注 F0 基线，补列 F0 之后新增的 15 张表并指向 `src/lib/db/schema.ts`。

### 验证方式与结果

- 环境变量覆盖核对（脚本比对 `.env.example` 与 `rg process.env.*`）：代码读取的变量已全部在 `.env.example` 中，无缺失。
- PowerShell 语法校验：`start.ps1`、`scripts/stop.ps1` 经 `Parser::ParseFile` 解析均 0 错误。
- 未改动的配置经复核确认与实现一致：`package.json`（脚本齐全）、`tsconfig.json`、`eslint.config.mjs`、`vitest.config.mts`、`next.config.ts`、`drizzle.config.ts`、`docker-compose.yml`、`components.json`、`postcss.config.mjs`、`.gitignore`（已忽略 `.data/`、`.logs/`、`coverage/`、`*.tsbuildinfo`）。
- 回归：`corepack pnpm test`、`typecheck`、`lint` 全部通过。

### 未处理（有意保留）

- `docs/spec.md`、`docs/plan.md`、`docs/design.md` 的里程碑与接口章节属于历史阶段基线，本次只同步数据模型中的事实性清单，不做整体重写。
- `start.ps1` 与 `scripts/start-data.ps1` 在侧车启动上仍有重复实现（前者内联、后者含 pid 文件与看护进程），行为一致但未合并，避免改动启动路径引入回归。

## 侧栏瘦身与横向模块菜单（2026-09-14）

- 关联文档：`docs/sidebar-ux-plan.md`
- 分支：`feature/sidebar-ux`
- 目标：解决「自选（基金/股票）很多时左侧功能栏被撑长」与「侧栏自上而下堆叠查询 + 自选 + 模块勾选 + 全选清空，高频的模块切换被挤到折叠线以下」两处臃肿；模块切换改为内容区顶部横向菜单，并顺带修正侧栏被顶部切换条遮挡的吸顶偏移问题。

### 验收项

- [x] UX1 新增横向模块菜单 `ModuleMenuBar`：单击切换启用、拖拽排序、已选计数、全选/清空，泛型支持个股与基金两套模块定义
- [x] UX2 两个侧栏移除模块勾选列表与底部全选/清空，仅保留「代码查询 + 自选管理」，标题改为「自选与查询」，折叠竖排标签改为「自选」
- [x] UX3 侧栏保留导出兼容：`MODULE_OPTIONS`/`ModuleKey`/`DEFAULT|ALL_MODULE_VISIBILITY`、`FUND_MODULE_OPTIONS`/`FundModuleKey`/`DEFAULT|ALL_FUND_MODULE_VISIBILITY` 签名不变
- [x] UX4 自选面板瘦身（个股 + 基金）：添加表单默认收起（自选为空时自动展开）、关键字过滤（代码/名称/备注/分组）、列表 `max-h-[52vh]` 内部滚动；基金条目操作按钮改为横向一行并按红涨绿跌着色
- [x] UX4b 自选筛选抽成纯函数 `src/lib/watchlist-filter.ts`（`matchesWatchlistKeyword`）并补单测
- [x] UX5 工作台布局：标题大卡片改为紧凑单行，`ModuleMenuBar` 吸顶于 `--app-header-h` 之下；空状态与说明文案由「左侧功能选项」改为「顶部功能模块菜单」
- [x] UX6 吸顶偏移修正：`globals.css` 新增 `--app-header-h: 68px`，`page.tsx` 顶部条固定 `h-[68px] z-30`，侧栏改 `sticky top-[var(--app-header-h)] h-[calc(100vh_-_var(--app-header-h))]`
- [x] UX7 同类臃肿：`RealtimeQuoteBar` 自选池超过 6 只时默认折叠，可「展开全部」
- [x] UX8 `corepack pnpm typecheck`、`lint`、`test`、`build` 全部通过

### 实测结果

- 静态检查：`corepack pnpm typecheck`、`corepack pnpm lint` 均无报错（期间修掉一次 `react-hooks/set-state-in-effect`：自动展开添加表单由 effect 改为派生值 `addFormOpen = showAddForm || items.length === 0`）。
- 单测：`corepack pnpm test` 全量 38 个文件 / 410 个用例通过；新增 `tests/watchlist-filter.test.ts`（6 例）覆盖自选搜索关键字匹配（空关键字放行、忽略大小写、代码/名称/备注/分组命中、空值字段不报错）。
- 构建：停 dev 后 `corepack pnpm build` 通过，路由表与改动前一致，无新增/缺失路由。
- 运行时冒烟（dev 3000 + 侧车 8000）：`GET /` 返回 200，SSR 输出含「自选与查询」「个股盘面分析与 AI 学习台」「基金分析与 AI 学习台」「顶部“功能模块”菜单」「留空使用 600519」「留空使用 510300」。
- 样式产物核对：dev 输出的 CSS 中确认 `--app-header-h: 68px`、`.top-\[var\(--app-header-h\)\]{top:var(--app-header-h)}`、`.h-\[calc\(100vh_-_var\(--app-header-h\)\)\]{height:calc(100vh - var(--app-header-h))}`、`max-h-[52vh]` 均已生成，吸顶与内部滚动样式生效。
- 覆盖率：新增 `src/lib/watchlist-filter.ts`（纯函数，6 例单测全覆盖），未改动其他 `src/lib/**` 代码，整体基线基本不变（仍约 49.4%）。

### 手动验收步骤（仓库暂无浏览器端到端测试）

1. 打开 `http://localhost:3000`，确认顶部「功能模块」横向菜单吸顶：向下滚动页面时菜单仍在切换条下方可见，侧栏标题不再被切换条遮住。
2. 点击任意 chip 可切换模块显隐（已选为主色填充并带 ✓），右侧「全选/清空」生效且已全选/全清时按钮置灰；拖拽 chip 可调整模块展示顺序。
3. 侧栏「自选与查询」：输入代码回车或点「查询」可切换上下文；点「＋ 添加」展开表单，添加多只后列表出现搜索框，输入代码/名称/备注可过滤，列表超过约半屏时仅在列表内部滚动。
4. 个股侧额外确认：分组折叠、↑/↓ 排序、备注与删除仍可用；自选全部删除后添加表单自动展开。
5. 开启「实时行情」后，自选池超过 6 只时出现「展开全部（共 N 只）」按钮，点击可展开/收起。

### 风险与遗留

- 模块启用状态与展示顺序仍为组件内 `useState`，刷新后回到默认（本次未做持久化）。
- 吸顶偏移依赖固定值 68px（`--app-header-h`）：若后续调整顶部切换条高度，需同步该变量。
- 窄屏（< ~768px）下横向菜单会出现横向滚动条，未做移动端专门布局。
- 未做浏览器端到端自动化测试，交互项依赖上述手动步骤复核。

## 基金持有：累计收益口径显式化（2026-09-14）

- 关联文档：`docs/fund-position-caliber-plan.md`（v1.1 配对口径模型）、`docs/fund-positions-plan.md`（同步标注 v1.2 口径更新）
- 分支：`feature/fund-position-caliber`
- 目标：解决录入「累计收益」时语义模糊的问题——原实现固定假设录入值**含当日收益**，而用户抄录的可能是上一交易日收盘值。新增显式口径 `profit_caliber`（含当日 / 不含当日），由用户选择。
- 配对原则（2026-09-14 二次确认）：**持有金额与累计收益是同一口径的一对**。含当日时，录入的持有金额即当前市值（已含今日盈亏）；不含当日时，录入的持有金额即上一交易日收盘市值。不允许「收益不含当日、金额却含当日」的混合语义。
- 取代关系：本节补充「不含当日」口径的配对换算，取代 2026-09-13 节中「录入值恒为当前市值、本金 = 录入金额 − 当前累计收益」的隐含假设。

### 验收项

- [x] FC1 口径定义与纯函数：`computeFundPositionMath` 支持 `include_today` / `exclude_today`，输出 `profitCaliber`、`marketValue`、`prevMarketValue`；提供 `DEFAULT_FUND_PROFIT_CALIBER` / `isFundProfitCaliber` / `normalizeFundProfitCaliber`
- [x] FC2 配对换算：`cost_amount = 录入持有金额 − 录入累计收益`（与口径、与行情均无关）；含当日 `当前市值 = 录入值`、`上一交易日市值 = 录入值 / (1 + 涨跌幅)`；不含当日 `上一交易日市值 = 录入值`、`当前市值 = 录入值 × (1 + 涨跌幅)`；`day_profit = 当前市值 − 上一交易日市值`
- [x] FC3 降级约定：当日行情不可用时只置空依赖它的字段，不用 0 冒充——含当日置空 `prev_market_value` / `prev_total_profit`；不含当日置空 `market_value` / `total_profit` / `total_profit_pct`；`cost_amount` 恒可算
- [x] FC4 合计口径：`total_market_value` / `total_profit` 任一只不可用即整体为 null（不做部分求和）；`total_cost` 恒可合计；持仓占比任一只市值不可用时整列为 null；空组合仍按 0
- [x] FC5 存储：`fund_positions` 新增 `profit_caliber` 列（迁移 `drizzle/0011_awesome_white_tiger.sql`，`NOT NULL DEFAULT 'include_today'`）；本地 JSON 回退同字段，历史记录缺字段时按含当日归一
- [x] FC6 接口：`POST/PATCH /api/fund-positions` 支持 `profit_caliber`，缺省含当日，非法值返回 400 `VALIDATION_ERROR`
- [x] FC7 界面：录入表单与行内编辑提供「累计收益口径」下拉（默认含当日）；列表**不再显示口径徽标**（按用户要求，仅修改时切换）；收益类数字为正时前缀「+」；不含当日且行情不可用时给出「缺当日涨跌幅，无法折算当前累计收益」
- [x] FC8 `corepack pnpm test`、`typecheck`、`lint`、`build` 全部通过

### 实测结果

- 单测：`corepack pnpm test` 全量 38 个文件 / 423 个用例通过（本轮改写：配对口径换算、两种口径逆运算、行情降级、占比整列 null、`sumValuations` 补 `cost_amount`）。
- 静态检查：`corepack pnpm typecheck`、`corepack pnpm lint` 均无报错。
- 构建：停 dev 后 `corepack pnpm build` 通过（exit 0，29/29 静态页），随后已恢复 dev（端口 3000）。
- 端到端（dev 3000 + 行情侧车 8000 实测，测试数据已清理）：
  - 非法口径：`POST` 带 `profit_caliber: "yesterday"` → 400 `VALIDATION_ERROR`「累计收益口径只能是「含当日收益」或「不含当日收益」。」。
  - 配对逆运算（同一只 `510300`，实测涨跌幅 −0.59%）：
    - 含当日录入 8000 / −300 → 当前市值 8000、上一交易日市值 8047.48、本金 8300、累计收益 −300、昨日累计 −252.52、当日收益 −47.48、累计收益率 −3.61%。
    - 用推出的「上一交易日市值 8047.48 + 昨日累计 −252.52」作为不含当日口径录入 → 上述六项数值与上一组**完全一致**，恒等式 −252.52 + (−47.48) = −300 成立。
  - 用户真实记录 `021533`（不含当日，录入 400.07 / 0.07，实测涨跌幅 −0.88%）→ 当前市值 396.55、上一交易日市值 400.07、本金 400、累计收益 −3.45、昨日累计 0.07（= 录入值）、当日收益 −3.52、累计收益率 −0.86%，恒等式 0.07 + (−3.52) = −3.45 成立，持仓占比 100%。
- 兼容性：未传 `profit_caliber` 的旧调用方与历史 JSON 记录一律按「含当日收益」处理。

### 手动验收步骤（仓库暂无浏览器端到端测试）

1. 打开基金工作台 →「持有基金」，录入表单应出现「累计收益口径」下拉（默认含当日收益）。
2. 列表基金名称下方**不应**再出现任何口径徽标；点「修改」时应出现口径下拉，可切换后保存并按新口径重新折算。
3. 收益类数字（当日收益、累计收益、昨日累计、累计收益率、当日收益合计、累计收益卡片、合计行）为正时应显示为 `+x` / `+x.xx%`，且为红色（金额不再带 `¥` 符号，见后文「金额展示去 ¥ 符号」）。
4. 选「不含当日收益」并在取不到当日行情时（非交易时段/上游不可用），该行「当前市值」「当前累计收益」「累计收益率」「占比」显示占位并给出原因提示。

### 风险与遗留

- 默认口径取「含当日收益」以兼容历史数据与既有录入习惯；用户若抄录的是昨日结算值，需在录入时手动切换（用户当前记录 `021533` 为「不含当日」）。
- 不含当日口径下行情不可用会同时置空「当前市值 / 当前累计收益 / 累计收益率 / 占比」，属刻意的不猜测行为。
- PostgreSQL 分支需执行 `corepack pnpm db:migrate` 应用迁移 `0011` 后另行验证（本次端到端走的是本地 JSON 回退）。
- 分红、申购赎回造成的份额变动仍不在口径处理范围内。
## 基金定投计划：持有金额按期自增与断档补齐（2026-09-14）

- 关联文档：`docs/fund-dca-plan-tracking-plan.md`（本方案）、`docs/fund-position-caliber-plan.md`（沿用配对口径模型）、`docs/fund-positions-plan.md`
- 分支：`feature/fund-dca-plan`
- 背景：用户要求定投的基金「持有金额按期自增」，且服务器中断期间不能漏期——重新运行项目后应能正确显示收益状况。
- 用户确认（2026-09-14）：① 定投后仍要保留手动修改校对的余地；② 只统计「开启计划之后」的期次，不回溯历史、不建模底仓；③ 频率为每日 / 每周（可选星期几）/ 每两周 / 每月；④ 先把已有改动提交再开新分支。
- 关键决策：持有金额做成**派生值**（`f(计划参数, 历史净值) → 期数 / 累计投入 / 份额`），而不是台账累加。停机期间无需补跑任何任务，重启后按同一份净值重算，结果与「一直在线」完全一致——本功能没有需要看门狗守护的定时任务。

### 验收项

- [x] DP1 纯函数账本 `src/lib/fund-dca-plan.ts`：`buildPlanTargetDates`（首期=启用日，按频率推进到今天）、`buildPlanPeriods`（目标日取「不晚于目标日的最近可用净值日」）、`computePlanLedger`（期数 / 累计投入 / 份额）、`resolvePlanNavRange`、`computeDcaPositionMath`
- [x] DP2 频率与星期几：`daily` / `weekly`（1–5，界面为周一至周五）/ `biweekly` / `monthly`；每周先锚定到「不早于启用日的第一个所选星期几」；每月遇月末天数不足收敛（1-31 + 1 月 → 2-28/29）；期数上限 2000
- [x] DP3 存储：`fund_positions` 新增 7 列（`dca_frequency` / `dca_weekday` / `dca_amount` / `dca_start_date` / `calib_nav_date` / `calib_shares` / `calib_cost`），迁移 `drizzle/0012_absurd_paper_doll.sql`；本地 JSON 回退同结构，历史记录缺字段一律按「未启用计划 / 未校准」归一
- [x] DP4 入参校验 `resolvePlanInput`：频率 / 星期几 / 每期金额（> 0）/ 启用日（缺省今天、不得晚于今天）；启用计划时 `amount`、`profit` 落 0 且不再校验
- [x] DP5 关闭计划保护：计划持仓改回手动持仓时必须同时提交持有金额与累计收益，否则 400，避免关掉计划后金额失去来源
- [x] DP6 手动校准 `resolveCalibration`：把「实际持有金额 + 实际累计收益」折算成 `{nav_date, shares, cost}`（基准净值优先盘中估值，否则最新官方净值）；校准日（含）之前的期次不再重复计入；取不到净值返回 400；传 `calibration: null` 清除校准
- [x] DP7 口径：计划持仓 `profit_caliber` 恒为 `include_today`（份额 × 净值天然含当日）；`累计收益 = 当前市值 − 累计投入`；实时估值取不到时「当日收益」留空，不用 0 冒充
- [x] DP8 接口：`POST /api/fund-positions` 支持 `plan`；`PATCH /api/fund-positions/:id` 支持 `plan`（对象 = 启用/修改，null = 关闭）与 `calibration`（对象 = 校准，null = 清除）
- [x] DP9 界面：录入表单可勾选「启用定投计划」（频率 / 扣款日 / 每期金额 / 启用日「留空 = 今天」）；列表显示「定投」小标、计划摘要、「累计投入」「定投 N 期 · 份额」；行内展开可改计划、关闭计划、手动校准、清除校准；收益类正数前缀「+」
- [x] DP10 附带修正（见下节「昨收净值」）：`resolvePrevTradingNav` 让「上一个交易日收盘净值」取严格早于今天的最近净值日
- [x] DP11 `corepack pnpm test`、`typecheck`、`lint`、`build` 全部通过

### 附带修正：「昨收净值」不再把当日已公布的净值当昨天（DP10）

- 问题（实测发现）：`resolveOfficialNav` 取的是「最新一条官方净值」，收盘后这条就是**今天**的净值。计划持仓用它当「昨收」时，当日收益 = 份额 ×（估算净值 − 今日收盘净值）≈ 噪声。实测 110022 在 2026-09-14 19:30（当日净值 2.837 已公布、盘中估算 2.8377 仍在返回）当日收益被算成 **0.49 元**，真实值应为 **7.78 元**（份额 707.0127 × (2.837 − 2.826)）。
- 修正：新增 `resolvePrevTradingNav(points, today)`（导出于 `src/lib/fund-position.ts`），「昨收」取严格早于今天的最近一个可用净值日；当日官方净值公布后用它作为**现价**（盘中估算此时已过期），并把 `nav_mode` 标为 `nav`、`estimated_nav` 留空。手动持仓的「昨收净值」列同样改用该规则（该列只影响展示，不影响手动口径的收益推导）。
- 修正后实测（110022，当日净值已公布）：`nav_mode = nav`、`prev_nav = 2.83`（09-11 的 2.826）、`estimated_nav` 为空、市值 2005.80 = 707.0127 × 2.837、当日收益 7.78、昨日累计 −1.98，恒等式 −1.98 + 7.78 = 5.80 = 累计收益（修正前分别为 2.84 / 2006.29 / 0.49）。
- 未公布当日净值的基金行为不变（实测 519674：`prev_nav = 11.49`（09-11 的 11.4858）、取不到估值时当日收益留空、市值 1819.85 = 份额 × 最新净值）。

### 实测结果（2026-09-14）

- 单测：`corepack pnpm test` 全量 **39 个文件 / 455 个用例通过**。新增 `tests/fund-dca-plan.test.ts`（21 例：目标日推进、月末收敛、每周锚定、扣款日顺延、校准不重复计入、收益率取整），并在 `tests/fund-position.test.ts` 增加 2 例覆盖「当日净值已公布」的计划持仓与手动持仓。
- 静态检查：`corepack pnpm typecheck`、`corepack pnpm lint` 均无报错（lint 前已清理临时脚本，避免 `no-require-imports` 噪声）。
- 构建：停 dev 后 `corepack pnpm build` 通过（exit 0），随后已恢复 dev（端口 3000）与行情侧车（8000）。
- 端到端（dev 3000 + 侧车 8000；测试期间先备份、结束后按字节还原用户真实数据 `021533`，测试记录全部删除，最终持仓只剩 `021533`）：
  - 计划派生：`POST` 每月 500 元、启用日 2026-06-14 → 期数 4（06-14 / 07-14 / 08-14 / 09-14）、累计投入 2000.00、份额 707.0127、最近扣款日 2026-09-14；市值 2005.80 = 份额 × 当日净值 2.837，累计收益 5.80 = 市值 − 累计投入，累计收益率 0.29%。
  - 幂等 / 断档补齐：同一条记录连续两次 `GET` 的期数、累计投入、份额完全一致；账本只由「计划参数 + 历史净值」决定，没有需要补跑的状态，因此停机期间不会漏期。
  - 每周锚定：启用日 2026-06-14（周日）、选周三 → 首期落到 2026-06-17，到 2026-09-09 共 13 期、累计投入 1300.00（下一期 09-16 尚未到期）。
  - 每日 + 净值未公布：启用日 = 今天 → 期数 1，最近扣款日取上一净值日 2026-09-11，未把周末/节假日算成新期次。
  - 关闭计划：仅传 `plan: null` → 400「关闭定投计划时请同时填写当前持有金额与累计收益，用于固化为手动持仓。」；补上 12345 / 678 → 200，`dca` 变 null、市值 12345、推算本金 11667。
  - 手动校准：录入实际 9999 / 111 → 校准生效，期数归 0、累计投入 9888（= 9999 − 111）、份额 3523.6283、市值 9999、累计收益 111（与录入值一致）；再传 `calibration: null` 回到纯计划派生（期数 4、累计投入 2000）。
  - 校验文案：每周缺星期几、频率非法、每期金额为 0、启用日晚于今天、未启用计划又未填金额，分别返回 400 且提示面向用户（中文、可操作）。

### 手动验收步骤（仓库暂无浏览器端到端测试）

1. 基金工作台 →「持有基金」，勾选「启用定投计划」，选「每月」、每期 500 元、启用日填 3 个月前 → 该行应显示「定投 4 期」与「累计投入 / 份额」，不再出现 0 或待录入。
2. 「修改」里把启用日改成今天 → 期数应变为 1（首期即启用日）。
3. 「修改」里填写「实际持有金额 / 实际累计收益」保存 → 期数重置为校准日之后的期次，累计投入 = 校准本金 + 之后期数 × 每期金额；已校准时显示当前基线并可「清除校准」。
4. 「修改」里取消勾选「定投计划」→ 未填持有金额与累计收益时应报错；填好后保存应变为手动持仓（「定投」小标消失）。
5. 停机补齐：停掉 dev 数日（或把启用日提前到停机之前）再打开，期数与份额应与「一直在线」一致。
6. 收盘后（当日净值已公布）观察「昨收净值 / 当日收益」：昨收应是上一个交易日的净值，当日收益应接近市值日变动，而不是接近 0 的噪声。

### 风险与遗留

- 净值取「不晚于目标日的最近一个可用净值日」：定投日当天即可见，但当晚公布真实净值前用的是上一净值日，金额会随之上修（刻意行为，避免新期次「消失」）。
- 分红、申购赎回、份额折算造成的份额变动不在计划账本处理范围内，需要用手动校准覆盖。
- 计划持仓的「当日涨跌幅」仍展示基金自身涨跌幅（取自行情侧车），与持仓期数无关。
- PostgreSQL 分支需执行 `corepack pnpm db:migrate` 应用迁移 `0012` 后另行验证（本次端到端走的是本地 JSON 回退）。
- 本功能没有需要守护的定时任务；E 组的定时任务守护仍只针对日报/数据源相关调度。
## 定投可取消 + 同代码自动合并（2026-09-14）

- 关联文档：`docs/fund-dca-plan-tracking-plan.md`（§1 需求确认、§8 接口、§9 界面已同步）
- 分支：`feature/fund-dca-plan`
- 用户追加要求：① 定投必须能取消；② 已添加的基金在「修改」里只保留「取消定投」，不要有启用定投的操作；③ 每个基金只能存在一个定投计划；④ 定投与普通持有两类录入按基金代码自动合并，持有列表里一个代码只能有一条记录，同代码再次用普通持有录入时应直接叠加到已有条目。

### 验收项

- [x] DM1 取消定投：`PATCH` 传 `plan: null` 即取消（必须同时给 `amount` + `profit` 固化为手动持仓），并一并清除校准基线；界面「修改」提供「取消定投」按钮（可点第二次撤回），确认后上表两格（已预填当前派生值）被固化，保存前可修正
- [x] DM2 「修改」不再支持启用 / 调整计划：`validateFundPositionUpdate` 收到计划对象直接返回 400「如需启用或调整定投计划，请在「添加持有基金」中改用定投方式录入；「修改」只支持取消定投。」
- [x] DM3 一个基金一个计划：`POST` 同代码再次提交定投 = 更新这一个计划的参数（已有校准保留），不会产生第二条记录
- [x] DM4 同代码自动合并：`POST` 按代码 upsert（新建 201 / 合并 200）
  - 普通 + 普通 → 持有金额与累计收益叠加；口径不一致返回 409（两种语义的金额不能相加）
  - 普通 + 定投 → 在既有条目上启用计划，并把既有录入值折算成校准基线（已录入的持有不会凭空消失）
  - 定投 + 普通 → 409，提示先取消定投
- [x] DM5 界面提示：录入已在列表中的代码时，表单下方预告本次提交的行为（叠加 / 折算基线 / 更新计划 / 因口径不一致被拒绝）；提交成功后给行内成功提示（不弹窗）
- [x] DM6 `corepack pnpm test`、`typecheck`、`lint`、`build` 全部通过

### 实测结果（2026-09-14）

- 单测：`corepack pnpm test` 全量 40 文件 / 461 例通过（本项新增 5 例：同代码合并策略 4 例、修改拒绝计划参数 1 例；另改写原「关闭计划」用例覆盖校准清除，并新增 `tests/fund-positions-panel.test.ts` 用服务端渲染兜住面板渲染期崩溃与默认表单形态）。
- 端到端（dev 3000 + 侧车 8000；测试记录已删除，`021533` 真实数据按字节还原）：
  - 叠加：110022 先录 1000 / 100（含当日）→ 市值 1000、本金 900；同代码再录 500 / 20 → **200**，金额 1500、累计收益 120、本金 1380，该代码在列表里仍只有 1 条。
  - 口径不一致：同代码改录「不含当日」→ 409「该基金已在持有列表中（累计收益口径：含当日收益），再次录入的口径必须一致才能叠加。」
  - 折算基线：同代码改为定投（每月 500、启用日 3 个月前）→ **200**，计划生效且沿用既有持仓作为基线：校准后 0 期、累计投入 1380、份额 528.5971、市值 1499.63、累计收益 119.63（≈ 转换前的 1500 / 120，说明已录入的持有没有丢失）。
  - 一个计划：同代码再提交「每周三 / 100 元 / 今天启用」→ **200**，列表仍是一条，`dca` 变为 weekly / weekday 3 / amount 100（参数被更新，校准保留，期数 0 因为下个周三还没到）。
  - 计划持仓叠加手动金额 → 409「该基金已启用定投计划，持有金额由计划派生；请先在「修改」中取消定投，再按普通持有录入。」
  - 修改传计划对象 → 400（DM2 文案）。
  - 取消定投：`PATCH { plan: null, amount: 12345, profit: 678 }` → **200**，`dca` 变 null、市值 12345、本金 11667，且 `position.plan` 与 `position.calibration` 都为 null（校准一并清除）；取消后再叠一笔 1 元 → 金额 12346（恢复普通叠加）。

### 手动验收步骤

1. 录入 110022（1000 / 100，含当日），再用同一代码录一次（500 / 20）→ 列表仍是一行，金额 1500、累计收益 120，并出现「已叠加到已有条目」提示。
2. 把口径改成「不含当日」再录一次 → 应被拒绝，提示口径必须一致。
3. 用 110022 勾选「启用定投计划」提交 → 该行变「定投」并与原持仓金额衔接（累计投入 ≈ 1380、累计收益 ≈ 120）。
4. 点该行「修改」→ 只有计划摘要与「取消定投」，没有启用 / 调整计划的输入；点「取消定投」→ 提示已选择取消，保存后变手动持仓（可先按预填值修正再保存）。
5. 用已在列表里的代码在「添加」里录入 → 表单下方应出现本次提交行为的提示。

### 风险与遗留

- 叠加只做「持有金额与累计收益相加」；两次录入口径不同会被拒绝，不做隐式换算。
- 定投持仓不能叠加手动金额，必须先取消定投；取消会固化当前派生值，`plan` 与校准同时清空。
- 同代码去重依赖本地列表与 `verifyFundCode`；上游不可用时按既有策略放行，仍由本地列表按代码去重。
- 本节把 `POST /api/fund-positions` 从「重复即 409」改为「按代码合并」，只影响基金持仓；个股持仓面板保持原有 409 行为。
## 净值结算（估算 → 官方净值）（2026-09-14）

- 关联文档：`docs/fund-nav-settlement-plan.md`（本方案）、`docs/fund-dca-plan-tracking-plan.md`（§1 需求、§4 数据模型、§6 净值口径、§7 手动校准已同步）
- 分支：`feature/fund-dca-plan`
- 用户要求：持有基金允许一定时间内使用估算值展示，但在下一交易日开始前一定要以官方净值准确更新完毕。

### 验收项

- [x] NS1 官方优先：净值序列里存在「今天」的官方单位净值时，当日涨跌幅、当日收益、估值口径全部改用官方净值推算（手动持仓与定投持仓一致），不再展示估算值
- [x] NS2 估算不跨日：抓取时间不属于北京今天的估算 / 实时值一律视为不可用，回落官方净值（防止陈旧 payload 冒充实时值）
- [x] NS3 窗口内允许估算：官方净值未公布时仍展示估算净值 + 估算当日收益，并标注口径
- [x] NS4 基线不锁定估算：手动校准 / 普通持仓转定投的折算基线优先今天官方净值；只能用估算时记录 `calib_anchor = estimate`
- [x] NS5 读时投影结算：估算锚定的校准在锚定日官方净值可取到时自动重锚（份额按 `估算净值 / 官方净值` 折算，本金与净值日不变），无需定时任务也能在次日开盘前得到官方口径
- [x] NS6 定时结算落库：新增「净值结算」定时任务（`FUND_SETTLE_CRON`，默认 `30 21 * * 1-5`），强制刷新持有基金官方净值并把估算锚定的校准重锚后写回
- [x] NS7 缓存不遮挡：`getFundNav` 缓存 TTL 条件化（最新点是今天 → 6h；否则 10min），官方净值公布后不再被缓存挡住
- [x] NS8 可见性：估值列展示「净值日 / 待结算」提示，汇总区展示净值结算状态
- [x] NS9 `corepack pnpm test`、`typecheck`、`lint`、`build` 全部通过
- [x] NS10 端到端核对：模拟「官方净值未公布（估算锚定）→ 官方净值公布」后，接口返回的当日收益与估值自动变为官方口径

### 验证方式

- 纯函数单测：`tests/fund-nav-settlement.test.ts` 17 例（官方净值优先、跨日守卫、涨跌幅推算、校准重锚、缓存有效期）、`tests/fund-settlement-job.test.ts` 4 例（结算任务落库 / 待结算 / 跳过 / 单只失败隔离）
- 估值分支：`tests/fund-position.test.ts` 改写「当日净值已公布」用例为官方口径结算，并新增「官方净值未公布时按估算展示」用例
- 调度注册：`tests/scheduler-guard.test.ts`、`tests/scheduler-jobs.test.ts` 更新为 7 个任务并覆盖新任务注册
- 静态检查与构建：`corepack pnpm typecheck`、`corepack pnpm lint`、`corepack pnpm build`
- 端到端：dev 3000 + 侧车 8000，用真实基金代码只读核对 + 一条临时探针记录验证重锚（核对后已删除）

### 实测结果（2026-09-14）

- 单测：`corepack pnpm test` 全量 **42 文件 / 483 例通过**；`typecheck`、`lint`、`build` 均通过。
- R1 已结算（真实数据）：021533 当天官方净值 2.9823、09-11 昨收 3.0094 → 接口 `nav_mode = nav`、`nav_date = 2026-09-14`、`estimated_nav = null`、`change_pct = -0.9`（官方推算）；同刻侧车估算为 2.9828 / `-0.88`，说明展示已从估算切到官方净值。
- R3 估算窗口（真实数据）：三只 QDII（019305 / 017641 / 016453）当天官方净值尚未公布 → `nav_mode = estimate`、`nav_date = 2026-09-11`（最近公布净值日）、`estimated_nav` 有值、当日收益按估算给出。
- R5 读时投影：临时探针持仓（`anchor = estimate`、nav_date 2026-09-11、锚定净值 2.9、份额 137.9552、本金 400）→ 接口 `dca.shares = 176.8161`（重锚份额 141.5677 + 首期 100 / 2.837 = 35.2485；未重锚时应为 173.2037）、`market_value = 501.63 = 176.8161 × 2.837`、`change_pct = 0.39 = 2.837 / 2.826 − 1`、`settlement_pending = false`、`nav_date = 2026-09-14`。探针已从数据文件移除，用户 8 条持仓完好。
- R5 落库分支：`POST /api/admin/scheduler/tick` → 新增任务 `fund-settlement` 状态 `ran`（无错误）；`/api/admin/observability` 记录 `{"source":"cron","checked":8,"resettled":[],"pending":[],"pending_count":0,"resettled_count":0}`；`/api/admin/scheduler/status` 显示任务已注册（`30 21 * * 1-5`、daily 新鲜度、仅交易日，随后显示「当天已完成」）。
- N7 缓存：23:51 能读到当天已公布的官方净值；若仍按 6 小时缓存「最新点不是今天」的旧数据，晚间就会看不到刚公布的净值。

### 手动验收步骤

1. 收盘后（当天官方净值已公布）打开持有基金面板：「实时估值」列应显示为空并标注「官方净值」，当日涨跌幅与当日收益按官方净值推算（与基金 App 的官方涨跌幅一致）。
2. 盘中（官方净值未公布）：该列应显示估算净值和「盘中估算」，当日收益按估算给出。
3. QDII 等净值滞后品种：官方净值未公布前显示「净值日 <上一个净值日>」；若校准基线仍是估算口径，会额外显示「官方净值未公布，待结算」。
4. `curl -X POST http://127.0.0.1:3000/api/admin/scheduler/tick` 后查 `/api/admin/scheduler/status`，应看到「净值结算」任务已运行且「当天已完成」。

### 风险与遗留

- 结算判定只依赖「今天的官方净值是否已公布」，不引入交易日历；节假日不产生新净值时页面会一直标注「待结算」，而不是伪造官方数据。
- 本功能之前创建的校准基线没有锚定净值，按 `anchor = official` 处理且不重锚，避免追溯改写用户已经看到的数值；QDII 这类当时按估算折算的老数据需要手动校准一次才会进入自动重锚。
- 「待结算」只描述校准基线状态；持仓的当日涨跌幅与当日收益在官方净值公布后会自动切到官方口径，不受该标记影响。
- 估算窗口未按交易时段收窄：只要估算值的抓取时间属于今天就允许展示（QDII 盘中估值跨时区），跨日与官方公布后一律以官方口径为准；如果希望「收盘后就不再显示估算」，需要引入交易日历再收敛。
- 结算任务仍随 Next 进程存活（E2 的独立 worker / 看门狗不在本次范围内）。
## R6 持有基金手动持仓跨日滚存（2026-09-15，待验收）

需求原文：持有基金中，允许一定时间内使用估算值展示，但在下一交易日开始前一定要以官方净值准确更新完毕。

缺陷与根因（实测）：2026-09-14 以「不含当日收益」录入 021533（持有 400.07、累计收益 +0.07），09-15 打开页面时「上一交易日累计收益」仍是 +0.07。根因是手动持仓的 `amount` / `profit` 是静态快照，只记录录入当天的口径，没有任何跨日推进机制，`computeFundPositionMath` 只用当日涨跌幅推算「今天」，不会把录入值推进到之后的交易日。

### 验收项

- [x] R6-1 锚点建模：`manual_anchor{ nav_date, nav, source }` 记录录入值对应的收盘口径层级，DB 新增 `manual_anchor_date` / `manual_anchor_nav` / `manual_anchor_source`（迁移 `drizzle/0014_*.sql`），本地 JSON 回退同结构
- [x] R6-2 录入锚点：`resolveManualAnchorSnapshot` 按口径钉住录入值——「不含当日」锚在严格早于录入日的最近收盘日；「含当日」优先录入日官方净值，其次录入日盘中估算（`estimate`，待官方公布后重锚），最后回落录入日之前最近收盘日
- [x] R6-3 读时推进：`rollManualSnapshot` 先把估算锚定按「官方 / 估算」重锚（市值缩放、累计收益同步平移、本金不变），再按「目标收盘净值 / 锚定净值」一步折算到目标收盘日（不做逐日连乘）
- [x] R6-4 目标日：读时 = 严格早于今天的最近收盘日（当日涨跌幅由展示层单独叠加）；定时结算 = 已公布的最新收盘日
- [x] R6-5 展示口径：锚在今天之前的收盘口径上时按 `exclude_today` 展示（当前市值 = 记录值 ×（1 + 当日涨跌幅）），锚在今天的当前值上时按 `include_today` 展示；取不到当日涨跌幅时回落录入口径。新增 `display_caliber` 字段，`profit_caliber` 仍回显录入口径
- [x] R6-6 历史数据兼容：`inferManualAnchor` 按录入时间（`updated_at` → `created_at`）推断锚点，与 R6-2 同规则；推断不出来时原样展示、不推进
- [x] R6-7 合并与修改：同一代码再次录入时先把既有记录推进到「更靠后的锚点」层级再叠加；「修改」里金额 / 累计收益 / 口径变化时按今天的口径重新锚定，只改备注则固化当前生效锚点（避免 `updated_at` 变化后被重新推断）
- [x] R6-8 落库：定时结算任务「净值结算」对手动持仓同样生效（推进结果写回金额 + 累计收益 + 锚点），估算锚点在官方净值公布前计入 `pending`
- [x] R6-9 界面：修改表单按展示口径预填（不含当日填上一交易日口径）并提示当前展示口径；净值结算状态区分手动锚点与校准基线
- [x] R6-10 `corepack pnpm test`、`typecheck`、`lint`、`build` 全部通过

### 验证方式

- 纯函数单测：`tests/fund-nav-settlement.test.ts` 新增 `rollManualSnapshot`（推进 / 不推进 / 重锚 / 官方未公布 / 历史数据）、`resolveManualAnchorSnapshot`、`resolveManualDisplayCaliber`、`pickLaterManualAnchor`、`inferManualAnchor`、`resolveSettleTarget` 共 14 例
- 估值分支：`tests/fund-position.test.ts` 新增「手动持仓跨日推进」4 例（不含当日跨日、含当日跨日、当天录入不推进、当天盘中录入待结算），并把「当日官方净值已公布」用例改成新展示口径
- 结算任务：`tests/fund-settlement-job.test.ts` 新增手动持仓 3 例（推进落库 / 估算锚点待结算 / 已结算不重复推进）
- 静态检查与构建：`corepack pnpm typecheck`、`corepack pnpm lint`、`corepack pnpm build`
- 端到端：dev 3000 + 侧车 8000，真实代码核对 + 临时探针记录（核对后已删除）

### 实测结果（2026-09-15）

- 单测：`corepack pnpm test` 全量 **42 文件 / 505 例通过**；`typecheck`、`lint`、`build` 均通过。
- 用户原始数据（021533，不含当日，09-14 录入 400.07 / +0.07）：接口返回 `prev_market_value = 396.47`、`prev_total_profit = -3.53`（= 0.07 + 400.07 × (2.9823 / 3.0094 − 1)）、`market_value = 408.44`（当日估算 +3.02%）、`day_profit = 11.97`、`total_profit = 8.44`、`cost_amount = 400`，恒等式 `-3.53 + 11.97 = 8.44` 成立。此前「上一交易日累计收益」停在 +0.07。
- 结算落库：`settleFundPositions` 对真实持仓执行后，021533 落库为 `amount = 396.47`、`profit = -3.53`、`manual_anchor = { nav_date: 2026-09-14, nav: 2.9823, source: official }`。
- 新增录入（临时探针 110022，不含当日）：`manual_anchor = { nav_date: 2026-09-14, nav: 2.837, source: official }`（严格早于今天的最近收盘日），`prev_market_value = 1000`、`prev_total_profit = 10`；探针记录已删除。
- 修改（同一探针）：改金额 → 锚点按今天重新计算并落库；只改备注 → 锚点保持固化，不再按新的 `updated_at` 重新推断。
- 含当日历史数据（008591 / 008327 / 017811，09-14 晚间录入）：锚点推断为 09-14 官方净值，展示口径转为不含当日 → 当前市值随当日涨跌幅更新（如 017811 从 393.87 变为 407.03 = 393.87 × 1.0334），上一交易日累计收益 = 录入值。无行情数据的 000033 回落到录入口径，当前市值仍是录入值。

### 风险与遗留

- 展示口径由锚点推断：含当日录入的历史数据在跨日后改为按「不含当日」展示（当前市值随当日涨跌幅变化），与旧行为相比当前市值列会变化，这是「官方净值必须推进」的必然结果。
- 「含当日」盘中录入按当时的估算净值锚定，官方净值公布后按「官方 / 估算」比例重锚：如果用户抄录的是基金 App 的估算（与侧车估算不同），会残留一次估算差异，属于无法从数据反推的部分。
- 录入当天不回溯：当天录入的「不含当日」值锚在昨天收盘，当日涨跌幅由展示层叠加；跨日后的收益从下一个交易日起推进。
- 历史数据（本机制上线前）依赖录入时间推断锚点；「修改」只改备注时会顺手固化锚点，但从未修改过的老记录在第一次结算落库前仍走推断。
- 结算任务仍随 Next 进程存活（E2 的独立 worker / 看门狗不在本次范围内）。

## R7 数据一致性清理（本地降级数据回填与垃圾清除）（2026-09-15，待验收）

需求原文：编写一个清理脚本，当项目所需数据库能够正常工作时，若检查到本地有与数据库不一致的数据：确定性事实性数据（用户录入的股票基金数据、生成的日报等）恢复至数据库；模板化的无意义降级文本（非用户输入、由系统在数据库或数据源断连时产生的垃圾）予以清除。并将该能力显化在工作台右上角，由用户手动触发。

- 关联文档：`docs/data-consistency-cleanup-plan.md`
- 分支：`feature/data-consistency-cleanup`

### 验收项

- [x] R7-1 数据库健康检查：连接探测 + 关键表存在性 + 迁移进度（`drizzle/meta/_journal.json` 与 `__drizzle_migrations` 条数比对），未就绪时只返回扫描计划、拒绝任何写入
- [x] R7-2 扫描计划（dry-run）：`GET /api/admin/data-consistency` 逐个白名单文件给出动作（restore / clean / archive / keep / pending / report-only）与条目级判定原因
- [x] R7-3 事实数据回填（基准是数据更新时间，不是纯内容差异）：数据库缺失 → 插入；内容指纹一致 → 冗余；内容不同且数据库最后改动早于本地文件 `mtime` → 以本地覆盖；数据库不更早或时间不可读 → 视为本地老旧冗余
- [x] R7-4 垃圾清除：空结构文件、非法条目、模板降级日报（`source=template`）、悬空日报索引被清除；纯冗余镜像归档隔离
- [x] R7-5 安全：未知文件只报告；`alert-settings.json` 不动；所有清除统一移入 `.data/quarantine/<时间戳>/`；`.data` 路径越界校验
- [x] R7-6 API：GET 扫描 / POST 执行（`dry_run` 只扫描，数据库未就绪返回 503）
- [x] R7-7 CLI：`corepack pnpm data:cleanup`（默认扫描，`--apply` 执行，`--json` 原始输出）
- [x] R7-8 UI：顶部栏右上角「数据一致性」按钮 + 弹窗（状态横幅、逐文件明细、执行结果、条目可展开）
- [x] R7-9 `corepack pnpm test`（44 文件 / 531 例）、`typecheck`、`lint`、`build` 全部通过
- [x] R7-10 端到端实测：真实造出「数据库缺少 + 本地有数据」场景，完成回填与隔离并复原环境

### 判定基准修正（2026-09-15 追加）

- [x] R7-11 判定基准改为「内容指纹 + 数据库最后改动时间 vs 本地文件 `mtime`」：内容一致 → 冗余；数据库更旧 → 覆盖；数据库不更旧或时间不可读 → 本地老旧冗余。新增 `src/lib/data-consistency-signature.ts` 作为两侧共用的内容指纹（数值归一化到 4 位小数，兼容数据库 `numeric` 字符串）
- [x] R7-12 为覆盖判定补齐写入能力：自选股 / 自选基金 / 预警规则新增覆盖写入（原先只有个股持仓、持有基金可覆盖）；覆盖未落地时保留本地文件并记入错误列表
- [x] R7-13 验收：`tests/data-consistency.test.ts` 27 例通过（含内容指纹归一化、四种判定分支、覆盖落地与冗余归档），`typecheck` / `lint` 通过

### 实现文件

- `src/lib/data-consistency.ts`：判定规则与扫描/执行编排（依赖注入，便于单测）
- `src/lib/data-consistency-db.ts`：Drizzle 直连适配层（刻意绕开带粘性降级的回退仓储）
- `src/app/api/admin/data-consistency/route.ts`：GET 扫描 / POST 执行
- `src/components/panels/DataConsistencyEntry.tsx` + `src/app/page.tsx`：工作台右上角入口
- `scripts/data-cleanup.mjs` + `package.json`（`data:cleanup` 脚本）
- `tests/data-consistency.test.ts`：19 例

### 验证方式

- 单测：条目级判定（回填 / 覆盖 / 冗余 / 无效）、空文件与损坏文件、占位名提示、预警设置保留、未知文件报告、日报三分类（AI 正式稿 / 云端已有 / 模板降级）、未就绪拒绝执行、隔离落地、单域写入失败时保留文件
- 静态：`corepack pnpm typecheck`、`corepack pnpm lint`、`corepack pnpm build`
- 端到端（dev 3000 + 真实 PostgreSQL）：
  - `GET /api/admin/data-consistency` → `database.status = ready`；`fund-positions.json` 判为「归档冗余副本」（8 条全部与数据库一致）；`alert-settings.json` 保留；`dev-server.log` 仅报告
  - 写入 `.data/watchlist.json`（占位名 `股票 600519`）→ 扫描判为「回填数据库」并提示占位名待名称自愈
  - `POST /api/admin/data-consistency` → `restored=1`，隔离 `.data/watchlist.json` 与 `.data/fund-positions.json`，`watchlist` 表出现 600519 行
  - `corepack pnpm data:cleanup` CLI 输出与接口一致
  - 测试痕迹已复原：删除探针行、把 `fund-positions.json` 从隔离目录还原、删除隔离目录

### 风险与遗留

- 条目级判定的依据是「数据库最后改动时间 vs 本地文件修改时间」：若用户在断连期间改了本地文件、数据库之后又被写入过内容，本地版本会被判为冗余（文件仍归档在 `.data/quarantine/`，可人工取回）。报告会逐条给出两个时间戳，覆盖前需人工核对。
- `update` 判定会覆盖数据库同一主键的记录，因此执行前必须先在扫描结果里逐条确认。
- 归档与清除都落 `.data/quarantine/<时间戳>/`，可人工回滚；模板日报走日报自身的删除通道（正文 + 双侧索引一并清除，不额外隔离）。
- 降级仓储的粘性开关未改动：执行清理后若进程仍处于降级态，需重启服务才会切回数据库读写（弹窗内已提示）。
- 日报的模板/正式判定只看 `source` 字段；历史上缺少该字段的旧日报会按「非 deepseek」处理，扫描结果会逐条列出以免误清。
- 清理不覆盖 `.data` 下的日志与未识别文件（只报告），避免误删运行中产物。
## 金额展示去 ¥ 符号（2026-09-15）

需求原文：系统内不用刻意标注 ¥ 符号，已经默认是国内用户使用了。

### 验收项

- [x] 金额格式化统一去掉 `¥` 前缀：`formatMoney`（基金持有、基金定投、基金组合、个股持仓、个股回测、回测净值曲线）与 `formatSignedMoney`（收益类金额）改为纯数字 + 千分位
- [x] 收益正负号约定不变：正收益仍显式加 `+`，负数保留 `-`，涨红跌绿配色不变
- [x] 定投计划摘要由「每周（周三）¥500 · 启用 2026-06-01」改为「每周（周三）500 · 启用 2026-06-01」
- [x] 该约定取代早前「收益类数字显示为 `+¥x`」的展示约定（上文对应验收行已同步更新）
- [x] 输入表单的单位提示「（元）」保持不变：它标注的是输入口径（元 / 万元区分），与货币符号不同
- [x] 验收：`corepack pnpm typecheck`、`lint`、`test`、`build` 全部通过；全仓 `rg "¥" src` 无残留（`src/lib/format.ts`、`src/lib/news.ts` 中乱码检测正则里的 `ç¥¨` 属于误编码特征，不是货币符号）

### 风险与遗留

- 去掉符号后，纯数字金额不再自带「这是金额」的视觉提示；同一行内若同时出现收益率与金额，靠 `%` 后缀与列标题区分，属刻意选择。

## 科技风 UI 与自定义背景（2026-09-16）

需求原文：① 将系统 UI 风格改为更具科技风（当前为简约洁白）；② 每个部分的交互效果增强，光标移动与点击都增加动态交互效果；③ UI 风格切换后各部分颜色协调，内容与界面保持对比度；④ 新增页面自定义背景功能，用户可自行替换系统内背景画布。

- 关联方案：`docs/tech-ui-plan.md`
- 分支：`feature/tech-ui-custom-background`

### 任务目标与范围

- 目标：把“简约洁白”主题整体切换为「深空蓝黑 + 霓虹青」科技风；给全局交互补上光标跟随、点击涟漪与悬停辉光；提供可替换的背景画布（预设 + 自定义图片 + 可调遮罩/模糊/面板透明度/光效强度）。
- 范围：主题令牌与全局样式、全部面板与工作台的颜色语义化改造、图表 SVG 色值变量化、弹窗 Portal 化、背景与光效新组件、`.data` 设置持久化与接口、单测与文档。
- 非目标：不改动任何业务逻辑、数据口径、接口契约与既有功能行为；不引入第三方 UI 库或图表库。

### 验收项

**主题与配色协调（需求①③）**

- [x] `src/app/globals.css` 提供暗色科技风令牌（背景/前景/面板/主色/强调/描边/聚焦环/图表色），并在 `@theme inline` 中暴露为 Tailwind 语义类
- [x] 面板统一使用 `tech-panel`（半透明深蓝 + 冷蓝描边 + 悬停辉光），不再有 `bg-white` 白底残留
- [x] 全仓无 `bg-white` / `text-slate-*` / `bg-slate-*` / `border-slate-*` 硬编码残留（弹窗遮罩、图表 SVG 变量除外）
- [x] 状态色统一为「深色底 + 300/400 级文字 + 10%~15% 透明底色」：红（风险/涨）、绿（正常/跌）、琥珀（提醒）、青蓝（信息）四类均满足
- [x] 图表 SVG 写死色值改为 CSS 变量，暗色底下网格线可见但不刺眼、坐标文字可读、悬浮提示框为深色底浅色字
- [x] 顶栏、侧栏、弹窗在暗色底上层次分明，正文对比度 ≥ 7:1、次级文字 ≥ 4.5:1

**交互动效（需求②）**

- [x] 光标移动有跟随光晕与光环，缓动平滑、无卡顿，且在 `(pointer: fine)` 之外的设备不启用
- [x] 悬停可交互元素时光环放大变色，悬停面板时描边发光并轻微上浮
- [x] 点击时产生扩散涟漪与粒子迸发，动画结束自动清理节点，不产生内存泄漏
- [x] 键盘可达性不受影响：`focus-visible` 聚焦环保留；`prefers-reduced-motion` 下动效自动关闭
- [x] 交互光效可在设置中开关并调节强度，设置持久化后刷新仍生效

**自定义背景（需求④）**

- [x] 提供 5 种预设背景（科技网格/粒子星链/星域/极光/纯净），默认科技网格
- [x] 支持上传自定义图片（png/jpg/webp/gif，≤8MB），上传后立即生效并持久化
- [x] 支持调整遮罩强度、背景模糊、面板不透明度、粒子密度，并即时预览
- [x] 支持删除自定义图片、恢复默认设置
- [x] 设置页面具备对比度提示（遮罩过低时提醒），保证内容可读
- [x] 后端不可用/接口失败时，界面沿用本地设置运行，并给出失败提示
- [x] 上传非法类型或超限文件被拒绝且提示原因，磁盘不落非法文件

**稳定性与工程规范（回归项）**

- [x] 弹窗（确认/提示/数据一致性/背景设置）统一 Portal 到 `body`，毛玻璃祖先不会造成错位或裁切
- [x] `.data` 新增文件在数据一致性扫描中登记为「设置文件，保持不动」，不产生误清理
- [x] `corepack pnpm typecheck`、`lint`、`test`、`build` 全部通过
- [x] 新增 `tests/ui-background.test.ts` 覆盖设置归一化、越界裁剪、文件名安全校验、上传校验
- [x] 代码注释为中文；文档同步 `docs/tech-ui-plan.md` 与 `README.md`

### 验证方式

- 单测：`corepack pnpm test`
- 静态：`corepack pnpm typecheck`、`corepack pnpm lint`、`corepack pnpm build`
- 接口：`GET/PUT /api/ui/background`、`POST /api/ui/background/upload`、`GET /api/ui/background/image/[file]`（含非法参数）
- 视觉：Chrome 无头截图核对顶栏 / 面板 / 图表 / 弹窗 / 背景预设 / 自定义图片 / 遮罩调节后的可读性

### 通过标准

- 四个需求全部落地，且无业务回归（既有功能行为不变）。
- 对比度：正文 ≥ 7:1，次级文字 ≥ 4.5:1，状态色文字 ≥ 4.5:1（自定义背景最不利取值下仍达标）。
- 动效：交互反馈在 16ms 帧预算内，无不必要的常驻定时器；关闭动效后无残留节点。

### 风险与遗留

- 自定义图片若本身高亮高噪，需要用户自行调高遮罩；系统给出提示但不强制。
- 单机单用户场景下，背景设置存于 `.data` 单文件，不做多用户隔离。
- 若后续引入亮/暗主题切换，需把本次令牌拆成 `html[data-theme]` 两套；当前仅实现暗色科技风。


### 完成记录（2026-09-16）

- 交付内容：
  - 主题层：`src/app/globals.css` 重写为暗色科技风令牌（面板底 `rgb(13 24 45 / var(--panel-alpha))`、主色 `#22d3ee`、图表与光效变量），新增 `tech-panel` / `tech-title` / `tech-panel-dashed` 与背景画布、交互光效样式。
  - 语义化改造：全仓 46 个组件文件去硬编码颜色（`bg-white` 80 处、`text-slate-*` 89 处、`bg-slate-*` 47 处、状态色约 250 处 → 语义令牌），9 个图表组件把 17 种写死色值改为 CSS 变量并提亮暗底系列色。
  - 新组件：`src/components/fx/BackgroundCanvas.tsx`（自定义图片 + 预设 + 粒子 rAF + 遮罩）、`src/components/fx/InteractionFX.tsx`（光标光晕/光环、点击涟漪与粒子）、`src/components/panels/BackgroundSettingsEntry.tsx`（背景与光效设置弹窗）。
  - 新接口与存储：`/api/ui/background`（GET/PUT/DELETE）、`/api/ui/background/upload`、`/api/ui/background/image/[file]`；设置落 `.data/ui-background.json`，图片落 `.data/backgrounds/`。
  - 稳定性：确认/提示/Toast/复盘弹窗统一 Portal 到 `body`，避免毛玻璃与 `overflow-hidden` 破坏 fixed 定位；数据一致性扫描把 `.data/ui-background.json`、`.data/backgrounds` 登记为设置文件（保持不动）。
- 验收结果：
  - 单测：`corepack pnpm test` → 45 个文件 / 553 例全部通过（新增 `tests/ui-background.test.ts`，覆盖归一化、越界裁剪、局部合并、显式 null 清除、文件名白名单、MIME 解析、图片地址、对比度风险）。
  - 静态：`corepack pnpm typecheck`、`corepack pnpm lint`、`corepack pnpm build` 全部通过。
  - 接口：GET 返回默认值；PUT 传 `preset:"hacker"`、`overlay:9`、`blur:-5`、`panelAlpha:0.2`、`fxIntensity:9` 被归一化为 `grid / 0.9 / 0 / 0.5 / 2`；上传 txt 与 9MB 图片分别被拒（VALIDATION_ERROR）；上传 PNG 成功并写入 `.data/backgrounds/`；图片接口返回 `image/png` 且带长缓存；`..%2F` 路径穿越与不存在文件均 404。
  - 视觉（Chrome 无头 + Puppeteer，截图存 `.logs/`）：默认科技网格、粒子星链、星域、自定义图片四种背景均正常；全页白色背景扫描结果为空（无 `bg-white` 残留）；面板实测 `rgba(13, 24, 45, 0.86)`；数据一致性弹窗与背景设置弹窗均 Portal 到 `body` 并适配暗色；粒子 canvas 采样命中真实绘制像素。
  - 交互：鼠标移动后光环 transform 跟随至光标坐标，点击生成 1 个涟漪 + 11 个粒子，900ms 后自动清理（DOM 中残留 0）；`prefers-reduced-motion` 与触屏设备下自动不启用；关闭开关后 `html[data-fx="off"] .fx-layer` 隐藏整层。
- 遗留与说明：
  - 当前仅实现暗色科技风，未提供亮色主题切换；若后续需要，把令牌拆成 `html[data-theme]` 两套即可。
  - 验收过程中写入的测试图片与设置已在结束时复位（`.data/backgrounds` 清空，设置回到默认值）。
  - 浏览器控制台仅有既有的 `/favicon.ico` 404（与本次改动无关）。

## 背景预设与粒子密度修复（2026-09-16 第二轮）

需求原文：① 内置背景的几个选项都没有效果，切换到任何一个效果都与默认几乎一致（包括「纯净」）；② 粒子密度参数调节效果不明显或无。

### 根因（已用像素采样量化确认）

- 预设装饰强度过低：网格线仅 0.16 透明度、星域预设的 CSS 只画了 5 颗星、极光只有 0.18~0.22 的色带。
- 遮罩层 `__scrim`（默认 0.55）叠在预设与粒子画布之上，把装饰再压掉一半以上。
- 面板不透明度 0.86，装饰透出后只剩约 14%，进一步削弱可辨识度。
- 粒子数量被写死在 18~80 颗：密度 0 仍画 18 颗，密度 75→100 因封顶几乎无变化。
- 修复前实测默认参数：grid / particles / starfield / none 在面板内的平均 RGB 完全相同（差异 0），极光仅差 2；密度 0 仍有 269 个粒子像素。

### 修复内容

- 预设改为三层结构：`底色 + 大范围洗染`（`.app-backdrop[data-preset]`，铺满视口）、`结构纹理`（`__preset`）、`光晕`（`__glow[data-preset]`）；五个预设分别取明亮蓝 / 墨青绿 / 紫罗兰黑 / 青紫高饱和 / 纯深蓝黑五种主色调。
- 星域由 5 颗固定星改为 260px 平铺的多层星点（整屏数百颗）。
- 面板只画星点不画连线，因此数量上限 340；星链需要连线，控制在 240 以内。
- 粒子密度改用 `particleCountForPreset`：0→0、25→49、50→105、75→169、100→240，密度 0 时画布完全清空；连线按透明度分 6 档批量描边，连线距离随密度 132px→90px 收缩。
- 默认参数调整为遮罩 0.45 / 面板 0.78（面板透出 22% 背景），并给设置存档加 `version: 2` 版本号：读取到没有版本号的历史存档时，把恰好等于旧默认值 0.55 / 0.86 的字段一次性抬到新默认值，其余字段原样保留；写回后再读不再迁移，用户手动拖回旧值也能正常保存。
- 设置面板的「粒子密度」实时显示当前会绘制的粒子数量，并提示当前预设是否使用粒子。

### 验收项与实测结果

- [x] 五个预设两两之间「纯背景区域」平均 |ΔRGB| ≥ 12 —— 实测最差组合 14（grid vs starfield），其余 15~55
- [x] 五个预设两两之间「整屏平均」|ΔRGB| ≥ 5 —— 实测最差组合 6（grid vs particles），其余 8~24
- [x] 面板内区域平均 |ΔRGB| ≥ 2（面板固定 78% 不透明，透射率仅 22%，此处仅作可感知下限）—— 实测最差 2，其余 3~12
- [x] 「纯净」预设不渲染任何装饰、光晕与粒子，与其余预设一眼可辨（画布像素 0、无 `__glow` 节点、无纹理规则）
- [x] 粒子密度 0 时画布完全清空 —— 实测粒子像素数 0
- [x] 密度 0/25/50/75/100 的粒子像素数单调递增且相邻档位差 ≥ 30% —— 实测 0 / 4298 / 13756 / 22753 / 33631（环比 +220%、+65%、+48%）
- [x] 粒子预设画布有实际绘制内容，网格/极光/纯净为 0 —— 实测 particles 17577 像素、starfield 1489 像素、其余 0
- [x] 设置面板实时显示粒子数量（切到「粒子星链」显示 240 颗，切回「科技网格」显示 0 颗）
- [x] 高密度下连线渲染不掉帧：按透明度 6 档分桶批量描边，避免逐条连线切换画笔；连线距离随密度收缩
- [x] 新默认参数下正文对比度 ≥ 7:1 —— 实测面板内真实渲染像素：正文 14.94:1、次级文字 7.21:1
- [x] 最坏情况（自定义纯白图片 + 面板 78%）正文仍 ≥ 7:1 —— 实测正文 12.34:1、次级文字 5.95:1；面板压到下限 50% 时正文仍有 8.79:1
- [x] 旧存档（无版本号）一次性迁移，且只动旧默认值字段 —— 实测写入 `aurora / 0.55 / 0.86 / blur 12 / density 80 / fx 1.5` 的旧存档：读回 overlay 0.45、panelAlpha 0.78，preset 与 blur/density/fx 全部原样保留
- [x] 迁移不会误伤手动值 —— 写回 `version: 2` 后再把滑块拖到 0.55 / 0.86，读回仍是 0.55 / 0.86
- [x] 单测覆盖 `particleCountForPreset`（0 值、单调性、档位间距、星域倍率与上限、非法输入）与旧默认值迁移
- [x] `typecheck` / `lint` / `test`：45 个文件 / 559 个用例全部通过

### 完成记录（2026-09-16 第二轮）

- 改动文件：`src/app/globals.css`（预设三层样式与默认变量）、`src/lib/ui-background.ts`（粒子换算式与旧默认值迁移）、`src/components/fx/BackgroundCanvas.tsx`（粒子数量、大小、亮度、分桶连线）、`src/components/panels/BackgroundSettingsEntry.tsx`（密度实时反馈）、`tests/ui-background.test.ts`、`docs/tech-ui-plan.md`。
- 验收截图：`.logs/fix-preset-*.png`（五个预设）、`.logs/fix-2-settings.png`（设置面板粒子数量）、`.logs/fix-3-white-image.png`（白图最坏对比度）。
  - 残余说明：面板内区域的平均色差天然受 22% 透射率限制（面板不透明度是用户可调项，调低后背景更明显）；若需要面板内差异更大，可自行把「面板不透明度」往下调。

## 星链光标交互、动效跟随与真实极光（2026-09-16 第三轮）

需求原文：① 星链和星域的效果还是不够明显，星链状态下希望光标能与背景星链交互——自动联结靠近的星链，超出一定距离则脱离；② 光标特效跟随不好，移动速度过快时特效会停留在原地；③ 极光背景希望做成真实的极光动景，而不是单纯颜色渐变。

### 根因（第二轮遗留问题，已量化）

- 光标跟随：`InteractionFX` 用「每帧固定比例」做缓动（光环 0.22、光晕 0.08）。光晕每帧只走剩余距离的 8%，快速甩动后需要约 **1.2 秒** 才能追到光标，肉眼就是「特效停在原地」；同时该写法与刷新率相关，高刷屏与 60Hz 表现不一致。
- 星链/星域：粒子是画在遮罩层**下方**的小实心点（半径 0.8~2.4、透明度 0.45~0.8），再被 45% 遮罩压一层，视觉权重过低；且没有与光标发生任何交互。
- 极光：只有 `conic-gradient` + `linear-gradient` 两条静态色带，叠一个整体透明度脉冲，属于「颜色渐变」而非动态极光。

### 验收项

- [x] 快速甩动光标后，光晕在 150ms 内追到光标 150px 以内、400ms 内追到 20px 以内；光环 150ms 内 30px 以内 —— 实测 1400px 对角甩动：光晕 36ms 时落后 149px（皮带上限内）、67ms 95px、136ms 52px、**315ms 10px**、517ms 1px；光环 67ms 36px、136ms 11px、210ms 4px、315ms 归零
- [x] 缓动与刷新率无关（按真实帧间隔做指数缓动），并保留「皮带」上限：落后距离不超过设定值，不再出现特效掉队 —— 见 `src/lib/fx-motion.ts` 的 `exponentialFollowFactor` / `leashPull`（单测断言「60Hz 一步 == 120Hz 两步」、甩动后拖尾恒不超上限）
- [x] 光标慢速移动时仍有轻微拖尾层次（不是硬跟随），指针进入/离开窗口时正确显隐 —— 光环 tau 55ms / 上限 90px，光晕 tau 110ms / 上限 150px，两层速度不同即为拖尾层次
- [x] 「粒子星链」下光标作为节点与半径内的粒子自动连线，连线透明度随距离衰减；超出半径自动断开 —— 实测光标处绘制密度是其余区域的 **5.27x**（半径 180px）；实测页面关闭后画布清空、`pointerleave` 后连线消失
- [x] 光标对半径内粒子有轻微引力，粒子被吸过来后会自动回归原有漂移，不会永久聚集或发散 —— 引力只作用在「停靠环 74px ~ 联结半径 180px」之间；光标移开后原位置密度由 5.27x 回落到 2.60x 并持续稀释
- [x] 星链/星域视觉权重明显提升：粒子改为「发光贴片 + 实心核心」，粒子层绘制在遮罩之上并按遮罩值缩放亮度
- [x] 星域星点数量与大小分层，不再是与星链仅差连线 —— 星域绘制像素 6145、平均亮度 178，光标扫过处密度 4.68x
- [x] 「极光」预设为 canvas 绘制的动态极光帘幕（5 条帘幕、逐列正弦摆动、叠加混色、随气流明暗跳动），不再是静态渐变色带 —— 实测逐帧哈希三帧互不相同，绘制像素 92 万、平均亮度 172，渲染 60fps
- [x] 极光射线纹理不再是「一列一张贴片」的周期性纹理 —— 改为从 1024×384 长纹理上按列切条（源宽 = 目标宽 = 16px），射线保持 1:1 粗细且不以列宽为周期重复
- [x] 极光在「减少动态效果」下自动降级为静态画面（只绘制一帧、不注册 rAF），且不产生持续 CPU 占用
- [x] 动效层仍不影响交互：`pointer-events: none`，键盘可达性与 `focus-visible` 不受影响
- [x] `typecheck` / `lint` / `test` / `build` 全绿 —— 46 个测试文件 / 570 个用例通过（含新增 `tests/fx-motion.test.ts` 10 例）

### 完成记录（2026-09-16 第三轮）

- 改动文件：
  - `src/lib/fx-motion.ts`（新增，纯函数：帧间隔归一化、指数缓动、皮带约束、物理步长、衰减折算、纹理取模）
  - `src/components/fx/InteractionFX.tsx`（跟随改为指数缓动 + 皮带约束，改用纯函数）
  - `src/components/fx/BackgroundCanvas.tsx`（极光纹理与帘幕、星链光标交互、停靠环、粒子物理按帧率折算、连线与光标节点提亮）
  - `src/lib/ui-background.ts`（预设文案：星链/星域/极光说明改为实际行为）
  - `src/app/globals.css`（极光地平线余辉，去掉遗留的静态色带注释）
  - `tests/fx-motion.test.ts`（新增 10 个用例）
- 关键参数：光环 `tau 55ms / 上限 90px`、光晕 `tau 110ms / 上限 150px`；光标联结半径 180px、停靠环 74px、引力系数 0.07；极光纹理 1024×384、列宽 16px、5 条帘幕。
- 验收截图：`.logs/r5-aurora-1.png`、`.logs/r5-aurora-2.png`（极光帘幕与射线，终检）、`.logs/r5-particles-cursor.png`（光标作为节点联结星链，终检）、`.logs/r5-starfield.png`（星域 + 光标光晕）；过程截图见 `.logs/r4-*.png`。
- 终检脚本：`%TEMP%\ui-verify\verify-final-round5.mjs` —— 先读取并备份用户当前设置，逐项验证后原样还原（本次为 starfield / overlay 0 / panelAlpha 0.5 / density 100 / fx 2），避免打断正在使用页面的会话；运行时控制台除项目原本就缺的 favicon.ico 404 外无任何报错。
- 验收脚本：`%TEMP%\ui-verify\verify-round4.mjs`（极光动画/像素/帧率、光标联结密度、星域、网格与纯净回归、设置复位）、`%TEMP%\ui-verify\diag-cursor.mjs`（甩动跟随距离）。
- 残余说明：
  - 极光的射线是程序生成的程序化纹理，不是真实极光照片；如需照片级效果，可上传自定义图片后叠加「极光」预设的动效（画布绘制在图片之上）。
  - 光标移开后，被吸到停靠环附近的粒子需要几秒才会被基础漂移稀释回常态（原位置密度由 5.27x 逐步回落），这是粒子物理的自然余韵，不是残留卡死；连线本身在离开半径的瞬间就断开。
  - 无头浏览器里的密度采样本身有随机波动（同一预设不同轮次为 1.85x~5.27x），因此验收以「同一轮内光标处 vs 其余区域」的比值与截图观感为准。

## UI 分支收口（2026-09-17）

背景：科技风 UI、交互光效与自定义背景的三轮迭代（见上三节）此前只存在于工作树，未固化提交。本次收口复核改动范围、重跑四道校验、补齐文档与验收记录，让分支进入「可合并」状态。

- 关联方案：`docs/tech-ui-plan.md`
- 分支：`feature/tech-ui-custom-background`

### 任务目标与范围

- 目标：把该分支的既有改动固化为独立提交，确认未夹带本地数据与密钥，`typecheck / lint / test / build` 全绿，并把收口验收记录补入本文件。
- 范围：验证、提交与文档记录；收口期间除 `src/lib/data-consistency.ts`（登记新的 `.data` 设置文件，随功能一并提交）外，不再改动业务代码。
- 非目标：本次不合并 main、不新增功能、不做亮色主题、不引入浏览器端到端测试框架。

### 验收项

- [x] 改动范围复核：所有改动落在主题令牌、组件配色、图表色值、弹窗 Portal、背景与光效、接口与存储、文档与测试范围内
- [x] 无敏感与本地文件混入：`.env`、`.data/`、`.logs/`、`.next/`、`coverage/`、`*.tsbuildinfo` 均被 `.gitignore` 覆盖，未进入待提交清单
- [x] 无调试残留：新增与改造文件中无 `console.log` / `debugger` / TODO / FIXME
- [x] 上传接口安全：MIME 白名单 + 单张不超过 8MB + 文件名由服务端生成（不使用用户原始文件名）
- [x] 数据一致性扫描把 `.data/ui-background.json`、`.data/backgrounds` 登记为「设置文件，保持不动」（新增 `ui-settings` 类型与 `scanUiSettingsFile`）
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm test` 全绿：46 个文件 / 570 例
- [x] `corepack pnpm build` 通过，三个 `/api/ui/background*` 路由正常编入产物
- [x] `docs/tech-ui-plan.md` 与 `README.md` 的能力说明与实现一致
- [x] 中文提交信息，独立分支提交，未直接改动 main

### 验证方式

- 范围复核：`git status --short`、`git diff --stat`
- 静态与构建：`corepack pnpm typecheck`、`corepack pnpm lint`、`corepack pnpm build`
- 单测：`corepack pnpm test`
- 本地文件核对：待提交清单与 `.gitignore` 比对

### 实测结果（2026-09-17）

- 改动规模：已跟踪文件 56 个改动（+1235 / -454 行）；新增 10 处：`docs/tech-ui-plan.md`、`src/app/api/ui/background/route.ts`、`src/app/api/ui/background/upload/route.ts`、`src/app/api/ui/background/image/[file]/route.ts`、`src/components/fx/BackgroundCanvas.tsx`、`src/components/fx/InteractionFX.tsx`、`src/components/panels/BackgroundSettingsEntry.tsx`、`src/lib/ui-background.ts`、`src/lib/ui-background-store.ts`、`src/lib/ui-background-client.ts`、`src/lib/fx-motion.ts`、`tests/ui-background.test.ts`、`tests/fx-motion.test.ts`。
- typecheck：`tsc --noEmit` 退出码 0。
- lint：`eslint .` 退出码 0。
- 单测：`vitest run` 输出 `Test Files 46 passed (46)`、`Tests 570 passed (570)`，用时约 23 秒。
- 构建：`next build` 退出码 0，产物包含 `/api/ui/background`、`/api/ui/background/upload`、`/api/ui/background/image/[file]`。
- 依赖与体积：本次未新增 npm 依赖（`package.json` 无改动），背景与光效由现有 React + canvas 实现。
- 与既有记录一致：本文件第一至三轮的 553 / 559 / 570 例演进与本次 570 例一致，未见回归。

### 完成记录

- 分支：`feature/tech-ui-custom-background`（收口前与 main 齐平，功能改动此前全部停留在工作树）
- 提交：`8034780` `feat(ui): 暗色科技风主题、交互光效与自定义背景画布`（收口记录随功能同批提交，哈希由本次文档提交补入）
- 合并状态：未合并 main，是否合并待用户确认

### 风险与遗留

- 仅实现暗色科技风，无亮/暗主题切换；后续如需浅色主题，需要把令牌拆成 `html[data-theme]` 两套。
- 视觉与交互验收依赖无头浏览器脚本（存放于 `%TEMP%\ui-verify\`），脚本未入库；仓库仍没有浏览器端到端自动化测试。
- 「极光」是 canvas 程序化纹理，不是照片级素材；照片级效果需要上传自定义图片后叠加动效。
- 自定义背景的对比度由用户调节遮罩与面板不透明度兜底，系统只提示不强制。

## CI 流水线（GitHub Actions）（2026-09-17）

需求来源：下一步开发方向的第二步——给仓库补上自动化校验，让每次提交都自动跑 `lint / typecheck / test / build`，不再依赖人工在本地逐条执行。

- 关联方案：`docs/ci-plan.md`
- 分支：`feature/ci-pipeline`

### 任务目标与范围

- 目标：新增 GitHub Actions 工作流，覆盖 Web 侧四道校验与行情侧车语法检查；同步方案文档、README 与验收记录。
- 范围：`.github/workflows/ci.yml`、`docs/ci-plan.md`、`README.md`、`checklist.md`。
- 非目标：不引入浏览器端到端测试、不做覆盖率门槛、不在 CI 里启动 Postgres 与行情侧车、不涉及部署与发布。

### 验收项

- [x] 新增 `.github/workflows/ci.yml`：所有分支 push 与 PR 触发，同一 ref 并发取消
- [x] Web 作业：Node 22 + pnpm（版本取自 `packageManager`）+ pnpm store 缓存 + `--frozen-lockfile` 安装
- [x] Web 作业依次执行 `typecheck`、`lint`、`test`、`build`，任一失败即停
- [x] 侧车作业：Python 3.12 执行 `python -m compileall` 语法检查
- [x] 最小权限（`contents: read`）与作业超时均已设置
- [x] 工作流不依赖任何密钥、数据库与外部行情源
- [x] 本地按 CI 口径复跑四项校验全部通过（临时移开 `.env` 模拟 runner 上无环境文件）
- [x] 工作流 YAML 通过解析与关键字段断言
- [x] `docs/ci-plan.md` 与 `README.md` 同步说明
- [x] 中文注释与中文提交信息，独立分支开发

### 验证方式

- 本地：`corepack pnpm typecheck`、`corepack pnpm lint`、`corepack pnpm test`、`corepack pnpm build`（临时移开 `.env`，模拟 runner 上没有任何本地环境文件）
- 工作流：PyYAML 解析并断言触发条件、作业与步骤、版本、缓存、权限与超时
- 远端：推送后在 GitHub Actions 上观察运行结果

### 实测结果（2026-09-17）

- 工作流静态校验：PyYAML 解析通过，17 项断言全部 PASS（触发条件、作业与步骤顺序、`--frozen-lockfile`、官方 action 版本、pnpm 缓存、`contents: read`、作业超时、未引用任何密钥、步骤名均为中文）。
- CI 口径本地复跑：把 `.env` 临时移开后依次执行 `typecheck`、`lint`、`test`、`build`，四项退出码均为 0，复跑结束后 `.env` 已原样恢复（`Test-Path` 为真）。
- 单测计数：同一代码树在本轮为 46 个文件 / 570 例通过（沿用收口轮次的白盒统计口径）。
- 依赖安装：`pnpm install --frozen-lockfile` 可用的前提成立——本轮未改动 `package.json` 与 `pnpm-lock.yaml`，锁文件与配置一致。
- 写法取舍：`push` 不写 `branches` 过滤（等价于所有分支），Node 与 Python 版本用单引号写成字符串 `'22'`、`'3.12'`，避免依赖加引号的写法带来的解析歧义。
- 远端实测：推送 `feature/ci-pipeline` 后 GitHub Actions 运行 `35199675240` 结论为 `success`——「Web 校验」76 秒（安装依赖、类型检查、代码规范、单元测试、生产构建逐步通过），「行情侧车语法检查」4 秒通过；两个作业的每一步均为 `success`。

### 风险与遗留

- 未引入端到端测试与覆盖率门槛；公共 runner（Ubuntu/Node 22）与本地 Windows 环境存在差异。

## 浏览器端到端测试（Playwright）（2026-09-17）

需求来源：下一步开发方向的第三步——把浏览器端到端测试纳入仓库，让页面外壳与关键交互（自选增删、工作台切换、背景预设）有自动化兜底，并纳入 CI。

- 关联方案：`docs/e2e-plan.md`
- 分支：`feature/e2e-playwright`

### 任务目标与范围

- 目标：引入 Playwright 端到端测试；先把本地降级数据目录改为可配置（`DATA_ROOT`）以实现数据隔离；同步方案文档、README、CI 与验收记录。
- 范围：`playwright.config.ts`、`tests/e2e/`（3 个 spec）、`src/lib/data-dir.ts`、`tests/data-dir.test.ts`、7 个存储模块与 `src/lib/data-consistency.ts` 的数据目录改造、`.github/workflows/ci.yml`、`README.md`、`docs/e2e-plan.md`、`checklist.md`。
- 非目标：不改页面结构与交互逻辑（仅两处 `data-testid`）、不改数据库结构、不引入 mock 侧车、不覆盖真实行情与 AI 链路。

### 验收项

- [x] 新增 `src/lib/data-dir.ts`：`DATA_ROOT` 可整体切换数据根目录，默认进程工作目录
- [x] 7 个存储模块（自选、基金自选、个股持仓、基金持仓、预警、日报、背景设置）改走 `dataPath()`
- [x] 数据一致性扫描依赖新增 `dataDir`，`createDefaultConsistencyDeps()` 默认取 `dataDir()`
- [x] 新增 `tests/data-dir.test.ts`（4 例）覆盖默认目录、`DATA_ROOT` 覆盖、空白回退与相对路径
- [x] 新增 `playwright.config.ts`：临时数据根目录、端口 3100、以 `/api/health` 作为就绪探针
- [x] 新增 3 个端到端 spec（共 5 例）：首页外壳、工作台切换与首屏异常、自选股增删、背景预设切换
- [x] 用例优先用无障碍语义定位，仅新增两处 `data-testid`
- [x] `package.json` 增加 `test:e2e` 与 `test:e2e:install`，`.gitignore` 忽略 Playwright 产物
- [x] CI 新增 e2e 作业（Chromium 与系统依赖、生产构建、失败上传 trace）
- [x] 本地静态校验、单元测试与端到端全部通过
- [x] 实测数据隔离：跑完后仓库 `.data` 无任何新增或改动
- [x] `docs/e2e-plan.md` 与 `README.md` 同步说明
- [x] 中文注释与中文提交信息，独立分支开发

### 验证方式

- 静态与构建：`corepack pnpm typecheck`、`corepack pnpm lint`、`corepack pnpm test`、`corepack pnpm build`
- 端到端：`corepack pnpm test:e2e`（首次先执行 `corepack pnpm test:e2e:install` 安装 Chromium）
- 隔离证据：跑前与跑后对仓库 `.data` 递归取「路径 + 大小 + 修改时间」快照并比对
- 工作流：PyYAML 解析并断言 e2e 作业的触发、步骤、版本、权限与产物上传
- 远端：推送后在 GitHub Actions 上观察含端到端作业的运行结果

### 实测结果（2026-09-17）

- typecheck：`tsc --noEmit` 退出码 0。
- lint：`eslint .` 退出码 0。
- 单测：`vitest run` 输出 `Test Files 47 passed (47)`、`Tests 574 passed (574)`，用时约 21 秒。
- 构建：`next build` 退出码 0，`next start` 可直接拉起生产产物。
- 端到端：`playwright test` 输出 `5 passed (24.3s)`，5 例依次为背景预设切换、首页默认渲染、个股台与基金台切换、首屏无未捕获异常、自选股增删全链路。
- 隔离证据：跑前与跑后对仓库 `.data` 递归取「路径 + 大小 + 修改时间」快照，13 个文件完全一致（`Compare-Object` 无输出）；用例数据落在临时根目录 `%TEMP%\stock-analysis-e2e-ZnamOs\.data\watchlist.json`，用例自身删除后为 `[]`。
- 降级依据：服务端日志出现「缺少 DATABASE_URL，请复制 .env.example 为 .env 并填写配置。」并切换为本地文件存储，与「无密钥降级路径」的预期一致（属预期行为，不是失败）。
- 工作流静态校验：PyYAML 解析通过，12 项断言全部 PASS（触发条件、三个作业顺序、runner 与超时、冻结安装、Chromium 系统依赖、先构建后跑用例、Node 22 与 pnpm 缓存、失败产物上传、最小权限、未引用密钥）。
- 依赖变更：新增 devDependency `@playwright/test`（1.63.0），锁文件随之更新；Chromium 浏览器装在用户缓存目录，不进仓库。
- 远端实测：推送 `feature/e2e-playwright` 后 GitHub Actions 运行 `35202929850` 结论为 `success`——「浏览器端到端测试」83 秒（安装依赖、安装 Chromium 与系统依赖、生产构建、端到端测试依次通过，失败产物上传按预期 skipped），「Web 校验」56 秒，「行情侧车语法检查」4 秒；三个作业的每一步均为 `success`。

### 风险与遗留

- 覆盖范围有限：只验证页面外壳与本地存储链路；行情、AI 与数据库路径依赖外部服务，用例跑的是无密钥降级分支。
- 首次需要在本地安装 Chromium（约 150MB，本机走 npmmirror 镜像下载）；CI 每次运行都要下载浏览器并重跑一次生产构建，流水线时间会变长。
- 首版只有 5 例，基金工作台、数据一致性清理对话框、多分组自选等场景尚未覆盖。
- 用例串行执行以换取稳定；后续用例变多时需要评估并行策略（例如每例独立数据根目录）。

## Agent 执行轨迹可视化与步骤耗时（2026-09-20，开发完成，自测通过，待用户验收）

需求来源：系统内 AI 能力由「编排层 + 大模型 + 本地工具 / 数据源」构成，但执行过程对用户不可见——对话提交后只有「回复中…」与逐字正文，单次回答耗时长时分不清「卡住」与「正在工作」；希望仿照 Codex、Claude 等成熟代码 Agent，把执行轨迹与每步耗时可视化，并在执行结束后自动清除轨迹、只保留最终结果。

- 关联方案：`docs/agent-trace-plan.md`
- 关联验收：`docs/checklists/09-feature-agent-trace.md`
- 分支：`feature/agent-trace`（基于 `main` 新建）

### 任务目标与范围

- 目标：R1 对所有 Agent 编排链路（T1 个股对话 / T2 个股分析 / T3 基金分析 / T4 基金对话）在运行期可视化执行轨迹；R2 展示每步耗时、步骤数与整轮总耗时、模型首字时延；R3 执行结束后轨迹自动清理，仅保留未引入本功能时的最终结果呈现，中断不残留。
- 范围：新增 `src/lib/shared/types/agent-trace.ts`、`src/lib/agent-trace.ts`、`src/lib/agent-trace-client.ts`、`src/components/panels/AgentTracePanel.tsx`、`src/components/panels/AgentTraceSettingsEntry.tsx`、`tests/agent-trace.test.ts`、`tests/agent-trace-client.test.ts`、`tests/e2e/agent-trace.spec.ts`、方案与验收文档；只增修改 `src/lib/shared/types/next-phase.ts`、`src/lib/shared/types/funds.ts`、`src/lib/shared/types/index.ts`；埋点修改 `src/lib/chat.ts`、`src/lib/analysis.ts`、`src/lib/fund-analysis.ts`、`src/lib/fund-chat.ts`；接入修改 `ChatPanel.tsx`、`AnalysisPanel.tsx`、`FundAnalysisPanel.tsx`、`StockWorkbench.tsx`、`FundWorkbench.tsx`、`src/app/page.tsx`；四条 SSE 路由原本即通用透传，经实测无需改动，样式复用既有设计令牌（未改 `globals.css`）。
- 非目标：日报生成（T5）进度通道、数据一致性巡检 / 调度器 / 数据源健康 / 预警扫描等确定性批处理、轨迹持久化与回放、数据库结构变更、模型原始思维链与原始提示词展示。

### 已确认决策（2026-09-20）

- 自清理严格度取 **C**：默认结束后完全移除，另提供设置项切换到「结束后折叠保留」。
- 本期**不含**日报生成（T5）。
- 分支策略：从 `main` **新建** `feature/agent-trace`。
- 思考步骤命名使用 **thinking**（界面标签 `Thinking`，摘要仍为中文）。

### 验收项

- [x] 契约：新增 `agent-trace.ts` 类型；三个流式事件类型各新增 `trace` 与可选 `trace` 字段，既有字段语义未变
- [x] 记录器：`createTraceRun()` 支持注入时钟；`startStep()` / `measure()` / `snapshot()` / `finish()` 计时与状态正确
- [x] 记录器护栏：步骤上限 24、`detail` 截断 180 字、纯内存不落库
- [x] T1 个股对话：每轮 `thinking` 步骤 + 每个工具 `tool` 步骤，六类工具中文名映射完整，兜底链路标注「未调用 AI（本地兜底）」
- [x] T2 / T3 分析：`data` / `thinking` / `guard` / `persist` 四类阶段步骤齐全
- [x] T4 基金对话：`data` / `thinking` 步骤齐全
- [x] 四条 SSE 路由透传 `trace` 事件（路由为通用透传，实测无需改动）；生成器中断 / 报错时由前端 `error` 分支收尾清理
- [x] 前端状态机：快照覆盖幂等、重复与乱序事件不产生重复步骤
- [x] 自清理（策略 C）：默认 `done` / `error` 后轨迹收敛并移除，仅保留正文、来源、风险提示与既有「工具调用」摘要块；中断不残留
- [x] 设置项：可切换「结束后折叠保留（`keep-collapsed`）」，选择持久化并在刷新后生效
- [x] 呈现：轨迹面板含状态圆点、步骤计数、累计耗时、每步耗时与模型首字时延；可折叠、键盘可达
- [x] 无障碍：`prefers-reduced-motion` 下停用脉冲动画与实时计时采样
- [x] 历史回看：历史会话与历史报告不渲染轨迹（轨迹只来自运行期 SSE），消息与报告结构未变
- [x] 回归：`typecheck` / `lint` / `test`（49 文件 / 598 例）/ `build` / `test:e2e`（9 例）全绿，既有行情、K 线、指标、资讯、分析、对话功能表现一致
- [x] 文档：README 能力说明、方案文档实测结果（`docs/agent-trace-plan.md` 第 9 节）、验收清单勾选，代码注释为中文且未提交真实密钥

### 验证方式

- 单测：`corepack pnpm test`（新增 `tests/agent-trace.test.ts`、`tests/agent-trace-client.test.ts`）
- 端到端：`corepack pnpm test:e2e`（新增 `tests/e2e/agent-trace.spec.ts`；利用无密钥兜底链路稳定断言「轨迹出现 → 结束后消失 → 仅剩最终结果 → 中断不残留」）
- 手工：`corepack pnpm dev` 后在配置密钥与未配置密钥两种环境下验证轨迹、耗时与自动清理，并验证设置项切换后刷新仍生效
- 回归：`corepack pnpm typecheck`、`corepack pnpm lint`、`corepack pnpm test`、`corepack pnpm build`、`corepack pnpm test:e2e`

### 风险与遗留

- 不展示模型私有思维链与原始提示词，仅展示编排层可观测阶段，避免外泄内部上下文
- 并发工具步骤各自计时，整轮总耗时不等于分步之和，前端分别展示、不做求和
- 既有 `messages.tool_calls` 落库结构本期保持不变，属「未开发本功能时」的既有呈现
- T5 日报生成进度通道、轨迹调试留痕开关留待二期评估
- 轨迹不落库，事后排查依赖既有 `recordTaskRun()` 计数
