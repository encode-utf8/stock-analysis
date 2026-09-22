#!/usr/bin/env bash
# 一键部署（Linux / macOS）：环境体检 → 按需安装 Docker → 起全栈容器 → 健康检查 → 输出访问信息
#
# 关联文档：docs/deploy-linux-plan.md
# 用法示例：
#   ./deploy.sh --check               只做环境体检（只读：不安装、不改文件、不起栈）
#   ./deploy.sh                       体检通过后直接起栈（Docker 已就绪时）
#   ./deploy.sh --install-docker -y   体检并自动安装缺失的 Docker / compose
#
# 退出码：0 成功；1 参数错误或执行失败；3 环境未就绪（缺 Docker、无权限、缺 compose）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# ---------- 1. 参数与输出工具 ----------
INSTALL_DOCKER=0
ASSUME_YES=0
CHECK_ONLY=0
NO_BUILD=0
USE_MIRROR=0

usage() {
  cat <<'EOF'
用法：./deploy.sh [选项]

  --check            只做环境体检并输出报告（只读：不安装、不复制 .env、不起栈）
  --install-docker   允许按发行版自动安装 / 补齐 Docker Engine 与 compose 插件
  -y, --yes          非交互确认（无人值守场景）
  --mirror           安装 Docker 时使用国内镜像源（阿里云 docker-ce 源）
  --no-build         起栈时跳过镜像构建（镜像已存在时更快）
  -h, --help         显示本帮助

环境变量：
  DOCKER_BIN         指定 docker 命令（例如 "sudo docker"），默认 docker
  COMPOSE_CMD        指定 compose 命令（例如 "docker compose"），默认自动探测

退出码：0 成功；1 执行失败；3 环境未就绪
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check | --check-only)
      CHECK_ONLY=1
      shift
      ;;
    --install-docker | --install)
      INSTALL_DOCKER=1
      shift
      ;;
    -y | --yes)
      ASSUME_YES=1
      shift
      ;;
    --mirror)
      USE_MIRROR=1
      shift
      ;;
    --no-build)
      NO_BUILD=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数：$1（用 --help 查看用法）" >&2
      exit 1
      ;;
  esac
done

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_CYAN=$'\033[36m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_RED=$'\033[31m'
  C_RESET=$'\033[0m'
else
  C_CYAN=''
  C_GREEN=''
  C_YELLOW=''
  C_RED=''
  C_RESET=''
fi

step() { printf '%s[部署] %s%s\n' "$C_CYAN" "$1" "$C_RESET"; }
ok() { printf '%s  ✓ %s%s\n' "$C_GREEN" "$1" "$C_RESET"; }
warn() { printf '%s  ! %s%s\n' "$C_YELLOW" "$1" "$C_RESET" >&2; }
fail() { printf '%s  × %s%s\n' "$C_RED" "$1" "$C_RESET" >&2; }

BLOCKERS=()
WARNINGS=()

add_blocker() {
  BLOCKERS+=("$1")
  fail "$1"
}

add_warning() {
  WARNINGS+=("$1")
  warn "$1"
}

# 逐行打印数组内容（对空数组安全，调用处用 ${arr[@]+"${arr[@]}"} 形式）
print_items() {
  local item
  for item in "$@"; do
    printf '    - %s\n' "$item"
  done
}

# 交互确认：-y 时直接通过；非交互且未加 -y 时判为不确认
confirm() {
  if [[ "$ASSUME_YES" == "1" ]]; then
    return 0
  fi
  if [[ ! -t 0 ]]; then
    warn "非交互环境且未指定 -y，跳过：$1"
    return 1
  fi
  local answer=""
  read -r -p "$1 [y/N] " answer || true
  [[ "$answer" == "y" || "$answer" == "Y" ]]
}

# 以 root 执行（已经是 root 则直接执行）
run_root() {
  if [[ "$IS_ROOT" == "1" ]]; then
    "$@"
  elif [[ -n "$SUDO" ]]; then
    # shellcheck disable=SC2086
    $SUDO "$@"
  else
    fail "需要 root 权限执行：$*（当前用户没有 sudo）"
    return 1
  fi
}

# 下载 URL 内容：优先 curl，回退 wget
fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$1"
  else
    fail "缺少 curl 与 wget，无法下载 $1"
    return 1
  fi
}

# ---------- 2. 系统体检 ----------
step "1/5 系统体检"

UNAME_S="$(uname -s)"
OS_ID="unknown"
OS_LIKE=""
OS_PRETTY="$UNAME_S"
if [[ "$UNAME_S" == "Linux" && -r /etc/os-release ]]; then
  # 部分发行版的 os-release 会引用未定义变量，这里临时关闭 set -u
  set +u
  # shellcheck disable=SC1091
  . /etc/os-release
  set -u
  OS_ID="${ID:-unknown}"
  OS_LIKE="${ID_LIKE:-}"
  OS_PRETTY="${PRETTY_NAME:-$OS_ID}"
fi

ARCH="$(uname -m)"
ok "系统：$OS_PRETTY（ID=$OS_ID，架构=$ARCH）"

IS_ROOT=0
if [[ "$(id -u)" == "0" ]]; then
  IS_ROOT=1
fi

SUDO=""
CURRENT_USER="$(id -un 2>/dev/null || echo "${USER:-uid$(id -u)}")"

if [[ "$IS_ROOT" != "1" ]] && command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
fi

HAS_SYSTEMD=0
if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then
  HAS_SYSTEMD=1
fi

IN_CONTAINER=0
if [[ -f /.dockerenv ]]; then
  IN_CONTAINER=1
elif [[ -r /proc/1/cgroup ]] && grep -qaE '(docker|containerd|kubepods|podman)' /proc/1/cgroup 2>/dev/null; then
  IN_CONTAINER=1
fi

if [[ "$IS_ROOT" == "1" ]]; then
  ok "权限：root"
elif [[ -n "$SUDO" ]]; then
  ok "权限：$CURRENT_USER（可用 sudo 提权）"
else
  add_warning "权限：$CURRENT_USER 无 sudo，安装类操作不可用（体检与起栈不受影响）"
fi

if [[ "$HAS_SYSTEMD" == "1" ]]; then
  ok "服务管理：systemd"
else
  add_warning "未检测到 systemd，守护进程需手动管理（脚本不会调用 systemctl）"
fi

if [[ "$IN_CONTAINER" == "1" ]]; then
  add_warning "当前环境看起来是容器：Docker 通常由宿主提供，需挂载 /var/run/docker.sock"
fi

MEM_MB=""
if [[ -r /proc/meminfo ]]; then
  MEM_MB="$(awk '/^MemTotal:/ {printf "%d", $2 / 1024}' /proc/meminfo 2>/dev/null || true)"
fi
if [[ -n "$MEM_MB" ]]; then
  if ((MEM_MB < 2048)); then
    add_blocker "可用内存仅 ${MEM_MB}MB，构建镜像会 OOM（建议 ≥ 4GB）"
  elif ((MEM_MB < 4096)); then
    add_warning "内存 ${MEM_MB}MB 偏低，首次构建（Node + Python 镜像）可能失败，建议 ≥ 4GB"
  else
    ok "内存：${MEM_MB}MB"
  fi
else
  add_warning "未读取到内存信息（无 /proc/meminfo），跳过内存检查"
fi

DISK_MB=""
if command -v df >/dev/null 2>&1; then
  DISK_MB="$(df -Pk "$ROOT" 2>/dev/null | awk 'NR==2 {printf "%d", $4 / 1024}' || true)"
fi
if [[ -n "$DISK_MB" ]]; then
  if ((DISK_MB < 5120)); then
    add_blocker "项目所在分区可用空间仅 ${DISK_MB}MB，镜像与构建缓存约需 10GB"
  elif ((DISK_MB < 15360)); then
    add_warning "可用空间 ${DISK_MB}MB 偏紧，镜像与构建缓存约需 10GB"
  else
    ok "可用磁盘：${DISK_MB}MB"
  fi
fi

# 端口占用检测：ss → netstat → /proc/net/tcp 逐级回退
port_in_use() {
  local port="$1"
  local hex=""
  if command -v ss >/dev/null 2>&1; then
    if ss -H -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${port}$"; then
      return 0
    fi
    return 1
  fi
  if command -v netstat >/dev/null 2>&1; then
    if netstat -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${port}$"; then
      return 0
    fi
    return 1
  fi
  if [[ -r /proc/net/tcp ]]; then
    hex="$(printf '%04X' "$port")"
    if awk 'NR > 1 {print $2}' /proc/net/tcp | grep -q ":${hex}$"; then
      return 0
    fi
  fi
  return 1
}

if command -v ss >/dev/null 2>&1 || command -v netstat >/dev/null 2>&1 || [[ -r /proc/net/tcp ]]; then
  for entry in "3000:Web 前端" "8000:行情侧车" "5432:PostgreSQL"; do
    port="${entry%%:*}"
    label="${entry#*:}"
    if port_in_use "$port"; then
      add_warning "端口 ${port}（${label}）已被占用：可能是上一次部署的容器仍在运行（可先执行 ./stop.sh --docker）"
    else
      ok "端口 ${port}（${label}）空闲"
    fi
  done
else
  add_warning "缺少 ss / netstat 且无法读取 /proc/net/tcp，跳过端口检查"
fi

# ---------- 3. Docker 与 compose 检测 ----------
step "2/5 检查 Docker 环境"

DOCKER_BIN="${DOCKER_BIN:-docker}"
MISSING_DOCKER=0
MISSING_COMPOSE=0
USE_SUDO_DOCKER=0
DAEMON_OK=0

daemon_ready() {
  # shellcheck disable=SC2086
  $DOCKER_BIN info >/dev/null 2>&1
}

# 守护进程连不上时区分「权限问题」与「没启动」，并尽量给出可执行指引
handle_daemon_problem() {
  if [[ -S /var/run/docker.sock && "$IS_ROOT" != "1" ]]; then
    if id -Gn "$CURRENT_USER" 2>/dev/null | tr ' ' '\n' | grep -qx docker; then
      add_blocker "已在 docker 组但连接守护进程失败：请重新登录会话（或执行 newgrp docker）后重试"
    else
      add_warning "当前用户不在 docker 组，无法访问 /var/run/docker.sock"
      add_warning "修复：sudo usermod -aG docker $CURRENT_USER && newgrp docker（或重新登录会话）"
    fi
    if [[ -n "$SUDO" ]]; then
      # shellcheck disable=SC2086
      if $SUDO docker info >/dev/null 2>&1; then
        DOCKER_BIN="$SUDO docker"
        USE_SUDO_DOCKER=1
        DAEMON_OK=1
        ok "本次执行改用「$DOCKER_BIN」（重新登录会话后即可免 sudo）"
      else
        add_blocker "sudo docker 仍无法连接守护进程：请先启动 Docker（sudo systemctl start docker）"
      fi
    else
      add_blocker "没有 root 或 sudo 权限，无法访问 Docker 守护进程"
    fi
    return 0
  fi

  if [[ "$HAS_SYSTEMD" == "1" ]]; then
    if [[ "$CHECK_ONLY" == "1" || "$INSTALL_DOCKER" != "1" ]]; then
      add_blocker "Docker 守护进程未运行：请执行 sudo systemctl start docker（或加 --install-docker 由脚本处理）"
      return 0
    fi
    if confirm "Docker 守护进程未运行，是否现在启动并设为开机自启？"; then
      if run_root systemctl enable --now docker >/dev/null 2>&1 && daemon_ready; then
        DAEMON_OK=1
        ok "Docker 守护进程已启动并设为开机自启"
      else
        add_blocker "启动 Docker 守护进程失败，请手动排查：sudo systemctl status docker"
      fi
    else
      add_blocker "Docker 守护进程未运行（已跳过启动）"
    fi
    return 0
  fi

  if [[ -x /etc/init.d/docker ]] && command -v service >/dev/null 2>&1; then
    if [[ "$CHECK_ONLY" != "1" && "$INSTALL_DOCKER" == "1" ]] && confirm "Docker 守护进程未运行，是否现在启动？"; then
      if run_root service docker start >/dev/null 2>&1 && daemon_ready; then
        DAEMON_OK=1
        ok "Docker 守护进程已启动"
        return 0
      fi
    fi
  fi

  add_blocker "Docker 守护进程未运行，且未检测到 systemd / SysV 脚本，请手动启动 dockerd"
}

if ! command -v "${DOCKER_BIN##* }" >/dev/null 2>&1; then
  MISSING_DOCKER=1
  add_warning "未检测到 docker 命令（加 --install-docker 可由脚本自动安装）"
elif daemon_ready; then
  DAEMON_OK=1
  DOCKER_VERSION="$($DOCKER_BIN version --format '{{.Server.Version}}' 2>/dev/null || true)"
  ok "Docker 守护进程可用（命令：$DOCKER_BIN${DOCKER_VERSION:+，服务端 ${DOCKER_VERSION}}）"
else
  handle_daemon_problem
fi

step "3/5 检查 compose"

COMPOSE_CMD="${COMPOSE_CMD:-}"
if [[ -n "$COMPOSE_CMD" ]]; then
  ok "使用指定的 compose 命令：$COMPOSE_CMD"
elif [[ "$DAEMON_OK" == "1" ]]; then
  # shellcheck disable=SC2086
  if $DOCKER_BIN compose version >/dev/null 2>&1; then
    COMPOSE_CMD="$DOCKER_BIN compose"
    COMPOSE_VERSION="$($DOCKER_BIN compose version --short 2>/dev/null || true)"
    ok "compose 插件可用${COMPOSE_VERSION:+（${COMPOSE_VERSION}）}"
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD="docker-compose"
    add_warning "只检测到 docker-compose（v1，官方已停止维护），建议升级为 compose 插件"
  else
    MISSING_COMPOSE=1
    add_warning "缺少 compose：docker compose 与 docker-compose 都不可用（加 --install-docker 可自动安装）"
  fi
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD="docker-compose"
else
  # 守护进程不可用时 compose 无从判断：交给前面的阻断项说明，不重复报缺组件
  MISSING_COMPOSE=0
fi

# ---------- 3.1 Docker 安装实现（仅 --install-docker 触发） ----------
install_convenience_script() {
  if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
    add_blocker "缺少 curl 与 wget，无法下载安装脚本"
    return 0
  fi
  step "使用官方便捷脚本安装（https://get.docker.com）"
  if fetch "https://get.docker.com" | run_root sh; then
    ok "官方便捷脚本执行完成"
  else
    add_blocker "官方便捷脚本安装失败，请参考 https://docs.docker.com/engine/install/ 手动安装"
  fi
}

install_debian() {
  if [[ "$OS_ID" == "unknown" ]]; then
    add_warning "无法识别发行版，改用官方便捷脚本"
    install_convenience_script
    return 0
  fi
  local repo="https://download.docker.com/linux/$OS_ID"
  if [[ "$USE_MIRROR" == "1" ]]; then
    repo="https://mirrors.aliyun.com/docker-ce/linux/$OS_ID"
  fi
  local codename=""
  if command -v lsb_release >/dev/null 2>&1; then
    codename="$(lsb_release -cs 2>/dev/null || true)"
  fi
  if [[ -z "$codename" && -r /etc/os-release ]]; then
    codename="$(sed -n 's/^VERSION_CODENAME=//p' /etc/os-release | tr -d '"' | head -n1)"
  fi
  if [[ -z "$codename" ]]; then
    add_blocker "无法识别发行版代号（codename），请手动安装 Docker"
    return 0
  fi
  local arch=""
  arch="$(dpkg --print-architecture 2>/dev/null || true)"
  if [[ -z "$arch" ]]; then
    arch="$ARCH"
  fi
  step "通过 apt 安装 docker-ce（源：$repo，代号：$codename，架构：$arch）"
  if ! run_root apt-get update; then
    add_blocker "apt-get update 失败"
    return 0
  fi
  if ! run_root apt-get install -y ca-certificates curl gnupg; then
    add_blocker "安装 apt 基础依赖失败"
    return 0
  fi
  run_root install -m 0755 -d /etc/apt/keyrings
  if ! fetch "$repo/gpg" | run_root gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg; then
    add_blocker "下载 Docker 签名密钥失败（检查网络与镜像源）"
    return 0
  fi
  run_root chmod a+r /etc/apt/keyrings/docker.gpg
  if ! printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.gpg] %s %s stable\n' "$arch" "$repo" "$codename" | run_root tee /etc/apt/sources.list.d/docker.list >/dev/null; then
    add_blocker "写入 apt 源失败"
    return 0
  fi
  if ! run_root apt-get update; then
    add_blocker "刷新 apt 源失败"
    return 0
  fi
  if ! run_root apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin; then
    add_blocker "安装 docker-ce 失败，请手动安装"
    return 0
  fi
  ok "docker-ce 与 compose 插件安装完成"
}

install_rpm() {
  local repo_id="$1"
  local repo="https://download.docker.com/linux/$repo_id/docker-ce.repo"
  if [[ "$USE_MIRROR" == "1" ]]; then
    repo="https://mirrors.aliyun.com/docker-ce/linux/$repo_id/docker-ce.repo"
  fi
  local mgr="dnf"
  if ! command -v dnf >/dev/null 2>&1; then
    mgr="yum"
  fi
  if ! command -v "$mgr" >/dev/null 2>&1; then
    add_warning "未找到 dnf / yum，改用官方便捷脚本安装"
    install_convenience_script
    return 0
  fi
  step "通过 $mgr 安装 docker-ce（仓库：$repo）"
  run_root "$mgr" -y install ca-certificates curl || true
  if [[ "$mgr" == "dnf" ]]; then
    run_root dnf -y install dnf-plugins-core || true
  else
    run_root yum -y install yum-utils || true
  fi
  if ! fetch "$repo" | run_root tee /etc/yum.repos.d/docker-ce.repo >/dev/null; then
    add_blocker "写入 docker-ce 仓库失败（检查网络与镜像源）"
    return 0
  fi
  if ! run_root "$mgr" -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin; then
    add_warning "docker-ce 安装失败（RHEL 系可能需要 --allowerasing 处理 podman 冲突），改用官方便捷脚本重试"
    install_convenience_script
    return 0
  fi
  ok "docker-ce 与 compose 插件安装完成"
}

install_alpine() {
  step "通过 apk 安装 docker 与 compose 插件"
  if ! run_root apk add --no-cache docker docker-cli-compose; then
    add_blocker "apk 安装失败"
    return 0
  fi
  run_root apk add --no-cache docker-cli-buildx >/dev/null 2>&1 || true
  ok "docker 与 compose 插件安装完成"
}

install_suse() {
  step "通过 zypper 安装 docker"
  if run_root zypper -n install --no-recommends docker docker-compose || run_root zypper -n install docker docker-compose; then
    ok "docker 安装完成（openSUSE 自带包，compose 走 docker-compose 兼容命令）"
    return 0
  fi
  add_warning "zypper 安装失败，改用官方便捷脚本"
  install_convenience_script
}

start_daemon_after_install() {
  if [[ "$HAS_SYSTEMD" == "1" ]]; then
    if run_root systemctl enable --now docker >/dev/null 2>&1; then
      ok "Docker 守护进程已启动并设为开机自启"
    else
      add_warning "systemctl enable --now docker 失败，请手动检查：sudo systemctl status docker"
    fi
  elif command -v rc-update >/dev/null 2>&1; then
    run_root rc-update add docker default >/dev/null 2>&1 || true
    run_root service docker start >/dev/null 2>&1 || true
  else
    add_warning "未检测到 systemd / OpenRC，请手动启动 dockerd"
  fi
}

add_user_to_docker_group() {
  if [[ "$IS_ROOT" == "1" || -z "$SUDO" ]]; then
    return 0
  fi
  if id -Gn "$CURRENT_USER" 2>/dev/null | tr ' ' '\n' | grep -qx docker; then
    return 0
  fi
  if run_root usermod -aG docker "$CURRENT_USER" >/dev/null 2>&1; then
    add_warning "已把 $CURRENT_USER 加入 docker 组：重新登录会话（或 newgrp docker）后免 sudo 生效"
  else
    add_warning "自动加入 docker 组失败，请手动执行：sudo usermod -aG docker $CURRENT_USER"
  fi
}

# 按发行版分发安装：先按 ID，再按 ID_LIKE 归类
install_docker_engine() {
  local family="$OS_ID"
  case " $OS_LIKE " in
    *debian* | *ubuntu*)
      if [[ "$family" == "unknown" ]]; then
        family="debian"
      fi
      ;;
    *rhel* | *fedora* | *centos*)
      if [[ "$family" == "unknown" ]]; then
        family="centos"
      fi
      ;;
    *suse*)
      if [[ "$family" == "unknown" ]]; then
        family="suse"
      fi
      ;;
    *) ;;
  esac

  case "$family" in
    debian | ubuntu | raspbian | linuxmint | pop | neon | kali) install_debian ;;
    fedora) install_rpm fedora ;;
    centos | rhel | rocky | almalinux | ol | amzn | cloudlinux) install_rpm centos ;;
    alpine) install_alpine ;;
    suse | sles | opensuse | opensuse-leap | opensuse-tumbleweed) install_suse ;;
    *) install_convenience_script ;;
  esac

  start_daemon_after_install
  add_user_to_docker_group
}

# ---------- 4. 按需安装 Docker 环境 ----------
if [[ "$INSTALL_DOCKER" == "1" && "$CHECK_ONLY" != "1" && ("$MISSING_DOCKER" == "1" || "$MISSING_COMPOSE" == "1") ]]; then
  step "4/5 安装 Docker 环境"

  if [[ "$IN_CONTAINER" == "1" ]]; then
    add_blocker "容器内环境不建议安装 Docker：请在宿主机执行，或挂载 /var/run/docker.sock"
  elif [[ "$UNAME_S" != "Linux" ]]; then
    add_blocker "非 Linux 系统（$UNAME_S）：请先安装 Docker Desktop / colima 后重试"
  elif [[ "$IS_ROOT" != "1" && -z "$SUDO" ]]; then
    add_blocker "安装需要 root 权限，当前用户没有 sudo"
  elif confirm "将安装 Docker Engine 与 compose 插件（需要 root 权限与外网），是否继续？"; then
    install_docker_engine
  else
    add_warning "已跳过 Docker 安装（未确认）"
  fi
fi

# 安装/启动完成后重新探测，成功则清掉缺失标记
refresh_docker_state() {
  if command -v docker >/dev/null 2>&1; then
    if docker info >/dev/null 2>&1; then
      DOCKER_BIN="docker"
      MISSING_DOCKER=0
      DAEMON_OK=1
    elif [[ -n "$SUDO" ]] && $SUDO docker info >/dev/null 2>&1; then
      DOCKER_BIN="$SUDO docker"
      USE_SUDO_DOCKER=1
      MISSING_DOCKER=0
      DAEMON_OK=1
      ok "Docker 已可用（本次执行用「$DOCKER_BIN」，重新登录会话后可免 sudo）"
    fi
  fi
  if [[ -z "$COMPOSE_CMD" && "$DAEMON_OK" == "1" ]]; then
    # shellcheck disable=SC2086
    if $DOCKER_BIN compose version >/dev/null 2>&1; then
      COMPOSE_CMD="$DOCKER_BIN compose"
      MISSING_COMPOSE=0
    elif command -v docker-compose >/dev/null 2>&1; then
      COMPOSE_CMD="docker-compose"
      MISSING_COMPOSE=0
    fi
  fi
}

if [[ "$MISSING_DOCKER" == "1" || "$MISSING_COMPOSE" == "1" ]]; then
  refresh_docker_state
fi

if [[ "$MISSING_DOCKER" == "1" ]]; then
  add_blocker "未检测到 docker 命令：请安装 Docker Engine（https://docs.docker.com/engine/install/）"
fi
if [[ "$MISSING_COMPOSE" == "1" && -z "$COMPOSE_CMD" ]]; then
  add_blocker "缺少 compose 插件：请安装 docker-compose-plugin"
fi

# ---------- 5. 结论与起栈 ----------
step "体检结论"

if [[ ${#WARNINGS[@]} -gt 0 ]]; then
  printf '  警告 %d 项：\n' "${#WARNINGS[@]}"
  print_items ${WARNINGS[@]+"${WARNINGS[@]}"}
fi

if [[ ${#BLOCKERS[@]} -gt 0 ]]; then
  printf '  阻断 %d 项：\n' "${#BLOCKERS[@]}"
  print_items ${BLOCKERS[@]+"${BLOCKERS[@]}"}
  printf '\n环境未就绪，已终止（退出码 3）。\n' >&2
  exit 3
fi

ok "环境就绪：Docker 与 compose 均可用"

if [[ "$CHECK_ONLY" == "1" ]]; then
  printf '\n仅体检模式（--check）：未做任何改动。\n'
  exit 0
fi

step "5/5 启动全栈容器"

if [[ "$USE_SUDO_DOCKER" == "1" ]]; then
  warn "本次以「$DOCKER_BIN」运行：容器由 root 创建；重新登录会话后可直接用 docker"
fi

if [[ ! -f .env ]]; then
  if [[ -f .env.export ]]; then
    cp .env.export .env
    warn "已从迁移导出文件 .env.export 复制出 .env：迁移过来的配置会直接生效"
  else
    cp .env.example .env
    warn "已从 .env.example 复制出 .env：未填写外部密钥时会走降级 / 演示数据"
  fi
fi

HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
if [[ -n "$HOST_IP" && "$HOST_IP" != "127.0.0.1" ]]; then
  printf '  远程访问：http://%s:3000（请确认防火墙 / 安全组已放行 3000、8000）\n' "$HOST_IP"
fi

export DOCKER_BIN
export COMPOSE_CMD

ARGS=(--docker)
if [[ "$NO_BUILD" == "1" ]]; then
  ARGS+=(--no-build)
fi

# 起栈与健康检查复用 start.sh --docker，避免两份逻辑
exec bash "$ROOT/start.sh" "${ARGS[@]}"
