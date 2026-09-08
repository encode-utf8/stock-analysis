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
- [ ] 基金净值、持仓与风险指标接入持久化仓库
- [ ] 基金资讯 `expire_at` 清理与长期公告保留
- [x] 基金 AI 报告与关键快照写入 R2
- [x] 数据源健康面板纳入基金数据源状态
- [ ] 个股工作台 M1–M8 无回归
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm lint` 通过
- [x] `corepack pnpm build` 通过

### 验证方式

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`
- 配置真实数据库时，生成基金 AI 报告与会话后重启服务仍可回看；未配置数据库时仍可内存运行。

### 完成记录

- 进行中：已落地基金 AI 持久化表、数据库回退仓库、R2 报告快照与基金数据源健康探测。
