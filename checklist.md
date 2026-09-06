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
