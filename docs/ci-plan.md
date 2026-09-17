# CI 流水线方案（GitHub Actions）

- 文档版本：v1.0
- 编制日期：2026-09-17
- 分支：`feature/ci-pipeline`
- 关联文档：`docs/engineering-quality-plan.md`（E 组工程质量）、`README.md`、`checklist.md`
- 需求来源：下一步开发方向的第二步——给仓库补上自动化校验，让每次提交都自动跑 `lint / typecheck / test / build`。

# 1. 可行性分析

- 仓库已托管在 GitHub（`origin` = `https://github.com/encode-utf8/stock-analysis.git`），当前没有 `.github/` 目录，Actions 开箱可用，无需额外配置或付费。
- 四道校验本地已全部跑通（`typecheck`、`lint`、`test` 46 文件 570 例、`build` 退出码均为 0），CI 只是把它们搬到 runner 上重放，不新增任何依赖。
- 单测本身自洽：`vitest.config.mts` 明确使用 `node` 环境且不加载 `.env`，不连数据库、行情侧车与 AI 服务，因此 CI 不需要 Postgres、也不需要任何密钥。
- 版本约束：`next@16.3.3` 要求 Node ≥ 20.9；`package.json` 的 `packageManager` 固定 `pnpm@11.24.0`；侧车 `data-service/pyproject.toml` 要求 Python ≥ 3.12。
- 镜像源：`.npmrc` 指向 npmmirror，锁文件（`lockfileVersion: 9.0`）只记录 integrity 未写死 registry，runner 沿用仓库镜像不会冲突。
- 结论：可实现，无阻塞项，不需要用户决策。

## 2. 方案设计

### 2.1 触发与并发

- 触发：`push` 覆盖所有分支（功能分支提交后即可看到结果）加 `pull_request`。
- 并发：同一 ref 上后一次运行取消前一次未完成的运行，避免排队堆积。

### 2.2 作业

- 作业一「Web 校验」：`ubuntu-latest` + Node 22。步骤为 checkout → `pnpm/action-setup`（版本取自 `packageManager` 字段）→ `actions/setup-node`（缓存 pnpm store）→ `pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm lint` → `pnpm test` → `pnpm build`。四道校验串行，任一失败即停。
- 作业二「侧车语法检查」：`ubuntu-latest` + Python 3.12。步骤为 checkout → `actions/setup-python` → `python -m compileall -q data-service/app`。不安装 akshare 等重依赖，只校验语法与导入语句可编译。

### 2.3 其他约定

- 权限：`permissions: contents: read`，最小权限。
- 超时：每个作业 `timeout-minutes: 20`，避免 runner 挂死。
- 不注入任何密钥：CI 跑的就是「未配置密钥时的降级路径」，与设计一致。
- 缓存：pnpm store 交给 `actions/setup-node` 的 `cache: pnpm`；Python 侧不装依赖，无需缓存。
- 不在 CI 里启动 Postgres 或行情侧车。

## 3. 改动范围

- 新增：`.github/workflows/ci.yml`、本方案文档。
- 修改：`checklist.md`（验收记录）、`README.md`（补一条 CI 说明）。
- 不改动：任何业务代码、`package.json`、锁文件与本地启动脚本。

## 4. 测试与验收

- 本地复核：`corepack pnpm typecheck`、`corepack pnpm lint`、`corepack pnpm test`、`corepack pnpm build`；构建时把密钥与数据库类环境变量置空，模拟 CI 的「无 `.env`」路径。
- 工作流静态校验：用 PyYAML 解析 `.github/workflows/ci.yml`，并断言关键字段（触发分支、作业与步骤、Node 与 Python 版本、缓存、权限、超时）。
- 远端验证：推送到 GitHub 后由 Actions 实际执行，观察一次绿色运行。

## 5. 风险与替代方案

- 镜像源：runner 上沿用 npmmirror，若安装偏慢或偶发失败，可在工作流里加一步 `pnpm config set registry https://registry.npmjs.org` 覆盖；锁文件不含 registry，切换无副作用。
- 侧车只做语法检查：真正的运行验证依赖 akshare 与外部行情源，成本高且不稳定，暂不纳入 CI。
- 不引入浏览器端到端测试：Playwright 的成本与稳定性另行评估，保留在遗留项。
- 公共 runner 与本地环境存在差异（Node 22 / Ubuntu），本次以「与本地同版本 Node」降低风险。

## 6. 后续可选增强

- 覆盖率门槛（`pnpm test:coverage` 加阈值）与报告上传。
- 依赖更新（Dependabot）与 CodeQL 安全扫描。
- 侧车 pytest 用例、pip 依赖缓存与导入级检查。
