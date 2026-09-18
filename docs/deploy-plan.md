# Docker 全栈一键部署方案（web + data-service + postgres）

- 文档版本：v1.0
- 编制日期：2026-09-17
- 分支：`feature/docker-fullstack`
- 关联文档：`README.md`、`checklist.md`、`docs/deploy-linux-plan.md`（Linux 一键部署）、`docs/ci-plan.md`、`docs/e2e-plan.md`
- 需求来源：降低换机成本——此前仓库只有 PostgreSQL 容器，Web 前端与行情侧车依赖本机 Node / Python / conda 环境；本次把三者一起容器化，配合 `start.*` 与 `stop.*` 一键起停。

## 1. 可行性分析

- 现状：`docker-compose.yml` 只有 `postgres:16-alpine`；仓库无 `Dockerfile`、无 `.dockerignore`；Web 与侧车由 `start.*` 在本机跑 `pnpm dev` 与 `uvicorn`，换机需要重装 Node、pnpm、Python 与依赖。
- 关键前提已经具备：
  - `src/lib/data-dir.ts` 提供 `DATA_ROOT`，本地降级数据（自选、持仓、预警、日报、背景图）可以整体挂到容器卷上，重启与换机后数据仍在。
  - Web 有 `/api/health`，侧车有 `/health`，可直接充当 compose 健康检查与就绪探针。
  - `.env.example` 已有 `SKIP_INPROCESS_SCHEDULER`（注释写明适合多实例与容器部署），单容器默认跑进程内 cron 即可，不需要额外的守护进程。
  - 缺数据库、邮件、AI 与资讯密钥时应用本身有降级路径，容器不配任何密钥也能起来。
- 依赖版本约束：Next 16.3.3 要求 Node ≥ 20.9（镜像用 Node 22）；`packageManager` 固定 `pnpm@11.24.0`（镜像内 `corepack enable`）；侧车要求 Python ≥ 3.12（镜像用 `python:3.12-slim`）。
- 迁移：`drizzle/` 已有 15 个迁移文件，`pnpm db:migrate` 依赖 devDependency `drizzle-kit`，因此迁移必须在带开发依赖的镜像层里执行（方案提供一次性迁移服务）。
- 本机可验证：Docker 29.6.1 / Compose v5.2.0（Docker Desktop，linux 容器）可用，配置解析、镜像构建、健康检查、卷持久化都能实测。
- 结论：可实现，无阻塞项。

## 2. 方案设计

### 2.1 服务编排

| 服务 | 作用 | 宿主端口 | 依赖 |
| --- | --- | --- | --- |
| `postgres` | 数据库（沿用现状） | 5432 | 无 |
| `data-service` | 行情与基金数据侧车（FastAPI） | 8000 | 无 |
| `migrate` | 一次性执行 `pnpm db:migrate`，跑完即退出 | 不发布 | postgres healthy |
| `web` | Next 生产服务 | 3000 | postgres healthy、data-service healthy、migrate 成功退出 |

- `docker compose up -d postgres` 仍然只启动数据库，`scripts/db-up.ps1` 行为不变。
- `docker compose up -d --build`（或 `start.ps1 -Docker` / `start.sh --docker` / `start.bat --docker`）启动全栈。
- `docker compose down`（或 `stop.* --docker`）停止全栈，命名卷保留，数据不丢。

### 2.2 镜像

- Web（根 `Dockerfile`，多阶段）：
  - `deps`：Node 22 + corepack + 仓库 `.npmrc` 镜像源 + `pnpm install --frozen-lockfile`。
  - `source`：在 deps 之上叠加源码，同时作为 `migrate` 服务的构建目标（迁移需要 drizzle-kit）。
  - `builder`：`NEXT_OUTPUT=standalone pnpm build`。
  - `runner`：只带 `.next/standalone` 与 `.next/static`，以非 root 用户执行 `node server.js`。
  - `NEXT_OUTPUT=standalone` 只在 Docker 构建时打开，`next.config.ts` 的默认输出不变，本地 `next build` / `next start`、CI 与 Playwright 端到端都不受影响。
  - 仓库当前没有 `public/` 目录，镜像不拷贝该层；将来新增静态资源时补 `COPY --from=builder /app/public ./public`。
- 侧车（`data-service/Dockerfile`）：`python:3.12-slim`，先装必需依赖（fastapi、uvicorn、pydantic-settings、curl_cffi、pandas），再单独一层容错安装 akshare（失败只告警），与 `start.*` 的本机行为一致；缺 akshare 时降级到腾讯实时行情与确定性回退数据。
- pip 源：以 `PIP_INDEX_URL` 构建参数传入，默认与仓库 `.npmrc` 保持同样的国内镜像取向（清华 PyPI 镜像）；需要时用 `--build-arg PIP_INDEX_URL=https://pypi.org/simple` 覆盖。
- 两个镜像都安装 `tzdata` 并设置 `TZ=Asia/Shanghai`，保证定时任务与日志时间正确。

### 2.3 配置与数据

- 环境变量：Compose 自动读取项目根的 `.env` 做 `${VAR:-}` 插值，因此直接复用现有 `.env`；变量缺失或为空时按空值处理并走降级路径，不使用 `env_file`，缺 `.env` 文件也不会导致启动失败。
- 容器内固定覆盖的连接地址：`DATABASE_URL=postgresql://postgres:postgres@postgres:5432/stock_analysis`、`DATA_SERVICE_URL=http://data-service:8000`、`DATA_ROOT=/app/data`；宿主 `.env` 里的 `localhost` 地址不会带进容器。
- 数据卷：`stock_analysis_pgdata`（数据库，沿用）与新增的 `stock_analysis_appdata`（挂载到 `/app/data`，存放本地降级数据与自定义背景图）。
- 调度：单容器内进程内 cron 默认开启；将来多实例部署时设 `SKIP_INPROCESS_SCHEDULER=1`，另行启动 `pnpm scheduler:worker`。

### 2.4 脚本配合

- `start.ps1 -Docker`、`start.sh --docker`、`start.bat --docker`：执行 `docker compose up -d --build`，轮询 `/api/health` 直到就绪，打印访问地址与常用命令；不带参数时保持原有本地 dev 流程（行为完全不变）。
- `stop.ps1`、`stop.sh`、`stop.bat` 增加同一开关：执行 `docker compose down`（保留数据卷），避免用本机端口回收逻辑去处理容器进程。
- `scripts/db-down.ps1` 修正：此前是 `docker compose down`，全栈化后会连 Web 与侧车一起停；改为只停 `postgres`。
- Docker 未安装或未启动时，脚本给出明确提示（先启动 Docker Desktop 再重试），不静默失败。
- 健康检查读的是接口信封字段：Web 的 `/api/health` 返回 `{ success, data: { status } }`，脚本按 `data.status` 判定（首版按顶层 `status` 判定会一直超时，已在实施中修正）。
- 脚本编码与行尾：`scripts/stop.ps1` 与 `scripts/db-down.ps1` 原本没有 UTF-8 BOM，PowerShell 5.1 会按 GBK 读取含中文的字符串并直接解析失败（既有缺陷），本次补 BOM；本次改动涉及的 `.bat` / `.ps1` 统一收敛为 CRLF 行尾，避免 cmd 解析错位。

## 3. 改动范围

- 新增：`Dockerfile`、`.dockerignore`、`data-service/Dockerfile`、`data-service/.dockerignore`、本方案文档。
- 修改：`docker-compose.yml`（全栈编排）、`next.config.ts`（仅新增可选 standalone 输出）、`scripts/stop.ps1`、`scripts/db-down.ps1`、`start.ps1` / `start.sh` / `start.bat`、`stop.sh` / `stop.bat`、`README.md`、`checklist.md`。
- 不改动：业务代码、数据库结构与迁移文件、现有单测与 Playwright 用例、`.github/workflows/ci.yml`（CI 仍跑宿主机校验，不构建镜像）。

## 4. 测试与验收

- 静态：`docker compose config` 解析通过，服务名、依赖条件、卷与健康检查齐全。
- 起栈：`docker compose up -d --build` 后三个容器 healthy、`migrate` 退出码 0；宿主 `GET /api/health` 与 `GET /health` 均返回 ok。
- 迁移：`web` 依赖 `migrate` 成功退出，数据库表已建好（对比迁移前后的表清单）。
- 持久化：容器内新增一只自选股，`docker compose restart web` 后仍在（验证 `DATA_ROOT` 卷）；`docker compose down` 后再 `up` 数据仍在。
- 降级：不配置任何密钥时页面正常渲染，日志出现本地文件与演示数据的降级提示。
- 回归：`corepack pnpm typecheck`、`lint`、`test`、`build`、`test:e2e` 全绿，确认 `next.config.ts` 的改动没有影响默认输出。
- 清理：验收完成后 `docker compose down`（保留卷），并删除本次构建的镜像。

## 5. 风险与替代方案

- 镜像体积与构建时间：侧车带 akshare 与 pandas，首次构建可能 5 到 10 分钟；Web 侧用 standalone 精简运行层，后续若要更小可评估裁剪生产依赖。
- 端口冲突：宿主若已在跑本地 `pnpm dev`、`uvicorn` 或 PostgreSQL，3000 / 8000 / 5432 会冲突，需先停本机服务；README 说明排查方式。
- akshare 可选：镜像内安装失败只告警，功能降级到腾讯实时行情，与本地脚本一致。
- 行尾与脚本：容器内构建不受宿主 CRLF 影响，但 `start.sh` 需在 WSL / Git Bash 下执行。
- 替代方案：只容器化 Web、侧车仍跑本机，换机成本没有真正下降，否决；用 `docker compose watch` 做开发模式，与本目标无关，暂不做。

## 6. 后续可选增强

- 用 compose profile 同时提供开发模式（源码挂载 + 热更新）与生产模式。
- 镜像发布到镜像仓库，换机时直接 `docker compose pull`，省去本地构建。
- 在 CI 增加 `docker compose config` 与镜像构建的冒烟作业（需评估 runner 时间成本）。

## 7. 实施记录（2026-09-17）

- 环境：Docker 29.6.1 / Docker Compose v5.2.0（Docker Desktop，linux 容器），本机 Windows + PowerShell 5.1。
- 配置解析：`docker compose config` 通过，服务为 `data-service`、`migrate`、`postgres`、`web`。
- 镜像构建：`docker compose build` 成功，产物体积为 `stock-analysis-web:local` 303MB、`stock-analysis-data-service:local` 609MB、`stock-analysis-migrate:local` 1.71GB（含 devDependencies，供 drizzle-kit 迁移使用）。侧车镜像里 akshare 安装成功（`/health` 返回 `akshare: available`）。
- 首次构建失败过一次：buildx 访问 Docker Hub 鉴权走 IPv6 超时；`docker pull node:22-alpine` 重试后成功，随后构建正常（属网络瞬时问题，非配置问题）。
- 起栈：`docker compose up -d` 后三个常驻容器全部 healthy，`migrate` 退出码 0（日志为 `schema drizzle already exists, skipping` 等幂等提示）。
- 健康检查：宿主 `GET /api/health` 返回 `{"success":true,"data":{"status":"ok",...}}`，`GET /health` 返回 `{"status":"ok","service":"data-service","version":"0.2.0","akshare":"available"}`；首页 `GET /` 返回 200，标题为「个股盘面分析」。
- 持久化：通过 `PUT /api/ui/background` 写入配置（落到 `/app/data/.data/ui-background.json`），`docker compose restart web` 与 `docker compose up -d --force-recreate web` 后读取仍为写入值；验收后已清理该测试文件，数据卷保留。
- 脚本实测：`start.ps1 -Docker` 退出码 0（首次暴露健康检查字段 bug，修正后通过）；`start.bat --docker`、`stop.bat --docker`、`scripts/stop.ps1 -Docker` 均退出码 0；`scripts/db-down.ps1` 只移除 postgres，Web 与侧车保持 healthy。
- 环境复原：验收结束执行 `docker compose down`（保留卷），并单独把原本就在运行的 `postgres` 容器重新拉起；镜像保留，便于用户直接 `docker compose up -d` 复验。

## 8. 后续补充（同分支）

- Linux 一键部署（环境自检、按需安装 Docker、socket 权限处理）见 `docs/deploy-linux-plan.md`；它与本方案的 `start.sh --docker` 共用起栈与健康检查逻辑，并补充了 `--no-build` 与 compose 命令回退。
