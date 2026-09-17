# 浏览器端到端测试方案（Playwright）

- 文档版本：v1.0
- 编制日期：2026-09-17
- 分支：`feature/e2e-playwright`
- 关联文档：`docs/ci-plan.md`、`docs/tech-ui-plan.md`、`README.md`、`checklist.md`
- 需求来源：下一步开发方向的第三步——给仓库补上浏览器端到端测试，让「页面能不能真的打开、点了按钮会不会坏」有自动化兜底。

# 1. 可行性分析

- 现有测试栈是 `vitest`（node 环境，47 个文件 / 574 例），只覆盖纯逻辑与本地存储；页面渲染、交互与前端链路没有任何自动化覆盖。上一轮科技风 UI 的视觉验收靠 `%TEMP%\ui-verify\` 下的一次性脚本，脚本未入库，无法在 CI 复现。
- Playwright 自带 webServer 生命周期管理，能直接拉起 Next.js 生产构建（`next start`）并在就绪后开跑，不需要额外的进程编排脚本。
- 关键障碍是数据隔离：本地降级存储此前把路径硬编码为 `<进程工作目录>/.data/...`，用例一旦写数据就会污染真实自选、持仓、预警与背景设置。因此先把数据目录收敛到 `src/lib/data-dir.ts`，用 `DATA_ROOT` 环境变量整体切换根目录，再在此基础上跑端到端。
- 依赖与体积：只新增一个 devDependency（`@playwright/test`）与 Chromium 浏览器（约 150MB，装在用户缓存目录，不进仓库）。
- 本机与 CI 均可离线运行：缺少数据库、邮件、AI 与行情侧车时，应用本身就有降级路径（见 `docs/design.md` 与 README「数据与降级」），端到端跑的就是这条降级路径。
- 结论：可实现，无阻塞项，不需要用户决策。

## 2. 方案设计

### 2.1 数据隔离

- 新增 `src/lib/data-dir.ts`：`dataRootDir()` 在 `DATA_ROOT` 有值时以它为根（相对路径按工作目录解析），否则用 `process.cwd()`；`dataDir()` 返回 `<根>/.data`；`dataPath(...)` 拼接子路径。
- 7 个存储模块（`watchlist.ts`、`fund-watchlist.ts`、`stock-portfolio.ts`、`fund-position.ts`、`alert-store.ts`、`daily-report-store.ts`、`ui-background-store.ts`）全部改走 `dataPath()`。
- 数据一致性扫描（`data-consistency.ts`）的依赖对象新增 `dataDir`，所有 `.data` 路径拼接改为 `deps.dataDir`，默认值取 `dataDir()`；单测注入的临时目录因此与运行时口径一致。
- Playwright 每次运行创建独立临时根目录（`mkdtempSync(os.tmpdir(), stock-analysis-e2e-)`），也可用 `E2E_DATA_ROOT` 指定固定目录，便于复现失败现场。

### 2.2 服务端与端口

- 端口固定 3100（`E2E_PORT` 可覆盖），避开本地开发常用的 3000。
- 用 `node ./node_modules/next/dist/bin/next start --port 3100` 拉起生产构建；就绪探针为 `/api/health`，超时 120 秒；本地开发时复用已存在的服务，CI 上强制新起。
- 服务端环境：`DATA_ROOT` 指向临时目录；`DATABASE_URL`、`SMTP_HOST`、`SMTP_USER`、`SMTP_PASS`、`DEEPSEEK_API_KEY`、`TAVILY_API_KEY`、`R2_*` 一律置空串（空串等价于未配置），确保走本地文件与演示数据降级。

### 2.3 用例集（首版 5 例）

- `tests/e2e/home.spec.ts`：默认渲染个股工作台与免责声明；在个股台与基金台之间切换（断言 tablist 的 `aria-selected` 与两侧面板可见性）；首屏加载后没有未捕获异常（收集 `pageerror`，等待取数收敛后断言为空）。
- `tests/e2e/watchlist.spec.ts`：新增 `600519` → 计数变为「共 1 只」→ 二次确认弹窗删除 → 回到「共 0 只」且列表不再包含该代码。
- `tests/e2e/background.spec.ts`：打开「背景与光效」弹窗，切换「星域」与「科技网格」预设，断言 `.app-backdrop` 的 `data-preset` 随之变化，最后关闭弹窗。
- 串行执行（`workers: 1`、`fullyParallel: false`），共用同一份数据目录与同一个服务端；失败保留 trace 与截图，产物写在 `.logs/e2e`（已被 `.gitignore` 忽略）。

### 2.4 定位约定

- 优先用无障碍语义（`role` 加可访问名称）与可见文本定位，其次才加 `data-testid`。本次只在 `WatchlistSidebar`、`FundWatchlistPanel` 的根节点各加一处 `data-testid`，不改动页面结构、样式与交互逻辑。

## 3. 改动范围

- 新增：`playwright.config.ts`、`tests/e2e/`（3 个 spec）、`src/lib/data-dir.ts`、`tests/data-dir.test.ts`、本方案文档。
- 修改：7 个存储模块与 `src/lib/data-consistency.ts`（数据目录可配置）、`tests/data-consistency.test.ts`（补 `dataDir`）、`package.json`（`test:e2e`、`test:e2e:install` 与 devDependency）、`.gitignore`（Playwright 产物）、`.github/workflows/ci.yml`、`README.md`、`checklist.md`。
- 不改动：页面结构与交互逻辑（仅两处 `data-testid`）、数据库结构、本地启动脚本、`next.config.ts`。

## 4. 测试与验收

- 本地：`corepack pnpm typecheck`、`corepack pnpm lint`、`corepack pnpm test`（单测回归）、`corepack pnpm build`（`next start` 的前置产物）、`corepack pnpm test:e2e`。
- 隔离实证：端到端跑完后检查仓库 `.data` 未新增、未改动文件，且临时根目录下 `.data/watchlist.json` 与用例操作一致（用例自身删除后回到空数组）。
- CI：新增端到端作业，在 ubuntu runner 上 `pnpm exec playwright install --with-deps chromium` → `pnpm build` → `pnpm test:e2e`。

## 5. 风险与替代方案

- 覆盖范围有限：只验证页面外壳与本地存储链路；行情、AI 与数据库路径依赖外部服务，用例跑的是降级分支，不覆盖真实数据源。
- 稳定性：用例数量少且串行执行以降低抖动；CI 上失败自动重试 1 次，并开启 `forbidOnly` 防止误提交 `test.only`。
- 资源与耗时：Chromium 需要下载（本机可走 npmmirror 镜像），CI 每次运行都要装浏览器并重跑一次生产构建，会拉长流水线时间，后续可加浏览器缓存与产物上传优化。
- 替代方案：继续用一次性验证脚本 → 无法在 CI 复现、无法防回归，因此否决。

## 6. 后续可选增强

- 用 `storageState` 预置多分组自选、持仓与预警数据，覆盖更真实的盘面场景。
- 给基金工作台与数据一致性清理对话框补端到端用例。
- 用可控的 mock 侧车替换降级分支，覆盖真实取数链路与错误提示。

