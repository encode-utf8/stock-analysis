# Linux 一键部署方案（Docker 环境自检 / 按需安装 / 起栈）

- 文档版本：v1.0
- 编制日期：2026-09-17
- 分支：`feature/docker-fullstack`（与 `docs/deploy-plan.md` 同一分支）
- 关联文档：`docs/deploy-plan.md`、`README.md`、`checklist.md`
- 需求来源：上一阶段的 `start.sh --docker` 隐含「机器上已经装好 Docker Desktop」，Linux 服务器/桌面发行版上 Docker 的安装方式、守护进程、socket 权限、compose 插件版本差异很大，换机时仍要手工折腾。本方案补一个 Linux 优先的一键部署入口，把「环境体检 → 按需安装 → 起栈 → 健康检查 → 输出访问信息」串成一条命令。

## 1. 可行性分析

- 现状（承接 `docs/deploy-plan.md`）：编排与镜像已就绪（`docker-compose.yml`、`Dockerfile`、`data-service/Dockerfile`），`start.sh --docker` 已能起栈并轮询 `/api/health`；但它默认 `docker` 已存在、可用且带 compose v2，未装 Docker 时只打印一句「请先安装并启动 Docker Desktop」。
- 可自动化的部分：发行版识别、Docker 与 compose 检测、按发行版安装、守护进程启动与开机自启、当前用户加入 docker 组、端口与资源体检、起栈与健康检查，都有确定性命令可依。
- 不能自动化的部分：
  - 加入 docker 组需要重新登录会话才生效（`newgrp docker` 只影响当前 shell）。脚本只能在本次执行里退化为 `sudo docker`，并提示用户重新登录。
  - 无 systemd 的环境（部分容器、WSL1、老发行版）无法用 `systemctl` 管守护进程，只能提示手动启动 `dockerd`。
  - 首次构建要拉取 `node:22-alpine`、`python:3.12-slim` 与 PyPI 依赖，依赖外网质量，脚本无法保证。
- 验证条件：本机（Windows + Docker Desktop，linux 容器）可以真实执行「在 Linux 容器里运行 `deploy.sh`」的端到端验证——把仓库与 `docker.sock` 挂进容器，脚本会走完体检、起栈、健康检查全流程；另外可用不带 docker CLI 的镜像验证「缺少 Docker」分支、用非 root 用户验证权限分支。
- 结论：可实现，无阻塞项。风险集中在「安装动作需要 root 与外网」，因此安装默认关闭，必须显式 `--install-docker` 才执行。

## 2. 方案设计

### 2.1 脚本定位与参数

- 新增根目录 `deploy.sh`（bash，LF 行尾），定位是「环境准备 + 委托起栈」：
  - 只体检不改动：`./deploy.sh --check`
  - 体检并自动补齐 Docker：`./deploy.sh --install-docker -y`
  - Docker 已就绪时直接起栈：`./deploy.sh`

| 参数 | 说明 |
| --- | --- |
| `--check` | 只做体检并输出报告：不安装、不改文件、不起栈 |
| `--install-docker` | 允许按发行版安装/补齐 Docker Engine 与 compose 插件 |
| `-y` / `--yes` | 非交互确认，用于无人值守场景 |
| `--mirror` | 安装时改用国内镜像源（阿里云 docker-ce 源） |
| `--no-build` | 起栈时跳过镜像构建（已有镜像时更快） |
| `-h` / `--help` | 用法说明 |

- 退出码：`0` 成功；`1` 参数错误或执行失败；`3` 环境未就绪且不允许自动处理（缺 Docker、无权限、缺 compose 插件）。
- 起栈复用 `start.sh --docker`，避免两份健康检查逻辑；两者通过环境变量约定接口：
  - `DOCKER_BIN`：`docker` 或 `sudo docker`（默认 `docker`），用于权限不足时以 root 运行本次命令
  - `COMPOSE_CMD`：`docker compose` 或 `docker-compose`（默认自动探测）
- `start.sh --docker` 同步增强：跨平台提示（不再写死 Docker Desktop）、支持上述两个环境变量与 `--no-build` 参数，行为对已有 Windows/macOS 用户保持不变。

### 2.2 环境体检项

| 体检项 | 判定方式 | 不通过时的处理 |
| --- | --- | --- |
| 操作系统 | `/etc/os-release`（`ID`、`VERSION_ID`、`ID_LIKE`），macOS 走 `uname` | 未知发行版：仅提示，安装动作退化为官方便捷脚本 |
| CPU 架构 | `uname -m`（x86_64 / aarch64 / armv7l） | 记录并用于安装源架构；非主流架构提示 |
| 是否在容器内 | `/.dockerenv` 或 `/proc/1/cgroup` | 提示 Docker 通常由宿主提供，跳过安装并说明 |
| 权限模型 | `id -u`、`command -v sudo` | 无 root 也无 sudo：只能体检，不能安装 |
| 初始化系统 | `command -v systemctl` 且存在 `/run/systemd/system` | 无 systemd：不尝试 `systemctl`，给出手动启动建议 |
| 内存 | `/proc/meminfo` 的 `MemTotal` | 小于 2GB 阻断（构建会 OOM），小于 4GB 警告 |
| 磁盘 | `df -Pk` 目标分区可用空间 | 小于 5GB 阻断，小于 15GB 警告（镜像 + 构建缓存） |
| 端口占用 | `ss` → `netstat` → `/proc/net/tcp` 逐级回退 | 3000 / 8000 / 5432 被占用时警告并提示先停本机服务 |
| Docker 命令 | `command -v docker` | 缺失：`--install-docker` 时安装，否则记为阻断 |
| Docker 守护进程 | `docker info` | 失败时区分「未启动」与「无 socket 权限」，分别给出 `systemctl start docker` 与 `usermod -aG docker` 指引 |
| compose | `docker compose version`，回退 `docker-compose version` | 都缺失：`--install-docker` 时安装 compose 插件，否则阻断 |
| `.env` | 是否存在项目根 `.env` | 缺失且非 `--check`：从 `.env.example` 复制，密钥留空走降级路径 |

### 2.3 安装策略（仅 `--install-docker` 触发）

| 发行版（`ID` / `ID_LIKE`） | 安装方式 |
| --- | --- |
| debian / ubuntu / raspbian / linuxmint / pop | 官方 docker-ce apt 源（`--mirror` 时换阿里云源）+ `docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin` |
| fedora | `dnf config-manager --add-repo` 加 docker-ce dnf 源后安装同一组包 |
| centos / rhel / rocky / almalinux / amzn / ol | 统一按 centos 源处理（Rocky/Alma/RHEL 官方推荐），`dnf` 缺失时回退 `yum` |
| alpine | `apk add docker docker-cli-compose` + `rc-update add docker default` |
| opensuse / sles | `zypper` 加 docker 源后安装 |
| 其他 | 官方便捷脚本 `https://get.docker.com` |

- 安装后统一收尾：`systemctl enable --now docker`（无 systemd 时 `service docker start` 或提示手动启动）；非 root 用户执行 `usermod -aG docker $USER` 并提示重新登录生效。
- 安装动作在 `-y` 之外会先打印将要执行的命令并要求确认；`--check` 模式下永远不安装。

### 2.4 起栈与输出

- 委托 `start.sh --docker`：`docker compose up -d --build` → 轮询 `http://127.0.0.1:3000/api/health`（最多约 3 分钟）→ 打印访问地址。
- `deploy.sh` 额外输出：访问地址、远程服务器访问提示（检测到的首个内网 IP）、`docker compose ps` 与日志命令、停止命令、以及本次体检的结论摘要。
- 健康检查失败时打印最近日志提示（`docker compose logs --tail 50 web`）并返回 `1`。

## 3. 改动范围

- 新增：`deploy.sh`、`docs/deploy-linux-plan.md`、`.gitattributes`（声明 `*.sh` 用 LF，避免 Windows 检出把 CRLF 带进 Linux 脚本）。
- 修改：`start.sh`（docker 分支跨平台化 + 环境变量接口 + `--no-build`）、`README.md`（Linux 一键部署章节）、`checklist.md`（本任务验收小节）、`docs/deploy-plan.md`（关联文档交叉引用）。
- 不改动：业务代码、数据库结构、容器编排与镜像构建（`docker-compose.yml`、`Dockerfile`、`data-service/Dockerfile` 保持上一阶段成果）、`stop.sh`、`.github/workflows/ci.yml`。

## 4. 测试与验收

- 语法：`bash -n` 校验 `deploy.sh` 与改动后的 `start.sh`（在 `python:3.12-slim` 容器内对 LF 副本执行）。
- 缺少 Docker 分支：在不含 docker CLI 的镜像里跑 `./deploy.sh --check`，应输出明确指引并以 `3` 退出。
- 权限不足分支：以非 root 用户（无 docker 组权限）跑 `--check`，应识别为权限问题并给出 `usermod`/`newgrp` 指引。
- 正常分支（端到端）：在 `docker:cli` 容器内挂载仓库与 `docker.sock` 跑 `./deploy.sh`，应完成起栈并输出访问信息；随后宿主 `GET /api/health` 与 `GET /health` 均为 ok。
- 端口占用分支：在容器内占用 3000 端口后再跑 `--check`，应报出该端口被占用。
- `--check` 只读：运行前后 `git status` 无变化、无容器被创建。
- 回归：`typecheck`、`lint`、`test`、`build`、`test:e2e` 全绿（确认只是新增脚本，未影响应用）。
- 收尾：`docker compose down`（保留卷），并把原本运行的 `postgres` 容器拉起。

## 5. 风险与替代方案

- 安装动作不可逆且需要 root：默认关闭，必须显式 `--install-docker`；`--check` 永远只读。
- 国内网络：`--mirror` 提供阿里云 docker-ce 源；镜像构建本身仍依赖 Docker Hub 与 PyPI，必要时先手动 `docker pull`。
- 权限生效延迟：加入 docker 组后必须重登录；脚本本次执行退化为 `sudo docker`，并在结尾明确提示。
- 服务器暴露面：compose 会把 3000 / 8000 / 5432 发布到 `0.0.0.0`，公网机器需自行加防火墙或安全组；本方案只在文档中提示，不改编排（避免影响本机使用习惯）。
- 仅在本机 Linux 容器内验证过，未覆盖真实发行版安装路径（apt/dnf/apk/zypper 分支无法在容器内安全实跑）；对应分支只做语法与逻辑校验，需在目标发行版上复验一次。

## 6. 实施记录（2026-09-17）

- 环境：Windows + Docker Desktop（linux 容器，Docker 29.6.1 / Compose v5.5.1）。Linux 侧验证方式：在 `python:3.12-slim` 容器内用真实 bash 执行脚本，挂载宿主 `//var/run/docker.sock` 与仓库，并用 `--network host` 让容器内的 `127.0.0.1:3000` 指向宿主机发布的端口；docker CLI 与 compose 插件从 `docker:cli` 镜像取出后挂载进容器，因此跑的是真实 Linux bash + 真实 Docker 引擎。
- 语法：`bash -n` 校验 `deploy.sh`、`start.sh`、`stop.sh`（LF 副本）全部通过。
- 只读体检（`--check`）：退出码 0。正确识别 Debian GNU/Linux 13（ID=debian）、x86_64、root、无 systemd、容器内环境、内存 6853MB、可用磁盘 70467MB、端口 3000 / 8000 空闲、5432 被占用（宿主 postgres 已发布 5432）、Docker 守护进程 29.6.1 与 compose 5.5.1 可用。
- 只读性：`--check` 前后 `git status --porcelain` 与 `docker ps -a` 完全一致，无文件改动、无容器创建。
- 缺 Docker 分支：在不含 docker CLI 的容器内执行 `--check`，输出「未检测到 docker 命令（加 --install-docker 可由脚本自动安装）」与阻断项「请安装 Docker Engine」，退出码 3。
- 无权限分支：以 uid 1000 运行、宿主 socket 属 root 时识别为 socket 权限问题，给出 `sudo usermod -aG docker <user>` 与 `newgrp docker` 指引，因无 sudo 阻断，退出码 3；compose 缺失项按预期不再重复报出（守护进程不可用时不自作判断）。
- 端口占用分支：容器内先占用 3000 再 `--check`，正确报出「端口 3000（Web 前端）已被占用」。
- 安装分发（用桩函数替换 `run_root` / `fetch` 后校验，不触碰真实系统）：debian / ubuntu → apt 源 + `docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin`，`--mirror` → `mirrors.aliyun.com/docker-ce/linux/<id>`；fedora 与 centos / rhel / rocky / alma 系 → dnf 或 yum，两者都缺失时回退官方便捷脚本；alpine → `apk add docker docker-cli-compose`；suse / sles / opensuse → zypper；未知 ID（含未知 ID + `ID_LIKE=debian`）→ 官方便捷脚本；每个分支结束后都会执行「启用守护进程并开机自启」与「把当前用户加入 docker 组」。
- 端到端（`deploy.sh -y`）：体检通过 → `docker compose up -d --build`（三个镜像构建成功）→ postgres / data-service healthy、migrate 退出码 0、web 启动 → 健康检查通过（容器内无 curl / wget，自动走 python3 回退）→ 打印访问信息，退出码 0。宿主复核：`GET /api/health` 返回 `{"success":true,"data":{"status":"ok",...}}`，`GET /health` 返回 `akshare: available`，首页 `GET /` 返回 200 且标题为「个股盘面分析」。
- 参数与退出码：`--help` 退出码 0；未知参数给出提示并退出码 1；`--no-build` 跳过构建起栈并正常通过健康检查。
- `.env` 分支：在隔离目录（符号链接指向仓库但不含 `.env`）执行，脚本按预期从 `.env.example` 复制出 `.env`（内容一致）并给出降级提示，退出码 0；用户真实 `.env` 未被触碰。
- 开发中发现并修掉的缺陷：
  1. 首版只写了安装调用与分发、漏写实现函数，`--install-docker` 会以 command not found 失败；已补齐 debian / rpm / alpine / suse / 便捷脚本分支以及守护进程与用户组处理。
  2. compose 探测原先只判断「docker 命令是否存在」，守护进程不可用（无权限或未启动）时会误报「缺少 compose」；引入 `DAEMON_OK` 后不再误报。
  3. 权限分支用 `$(id -un)`，在无名 uid 场景（容器）会打印 `id: cannot find name for user ID`；改为 `CURRENT_USER` 一次性解析并兜底。
  4. Windows 工作区里 `start.sh` 是 CRLF，在 Linux 上执行报 `set: pipefail: invalid option name`；新增 `.gitattributes`（`*.sh` 强制 LF）并把本次涉及的 shell 脚本规范为 LF。
- 环境复原：验收后 `docker compose down`（保留数据卷），并重新只拉起 postgres；镜像保留，当前宿主仅 `stock-analysis-postgres` 运行（healthy）。
- 静态检查：ShellCheck（koalaman/shellcheck:stable）扫描 `deploy.sh`、`start.sh` 无告警；`stop.sh` 仅剩本次未改动的既有告警 SC2164（第 5 行 `cd "$ROOT"` 未加 `|| exit`）。
