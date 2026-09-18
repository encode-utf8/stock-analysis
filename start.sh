#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

LOGS_DIR="$ROOT/.logs"
mkdir -p "$LOGS_DIR"
DATA_LOG="$LOGS_DIR/data-service.out.log"
DATA_ERR="$LOGS_DIR/data-service.err.log"
WORKER_LOG="$LOGS_DIR/scheduler-worker.out.log"
WORKER_ERR="$LOGS_DIR/scheduler-worker.err.log"

step() {
  printf '\033[36m[启动] %s\033[0m\n' "$1"
}

warn() {
  printf '\033[33m%s\033[0m\n' "$1" >&2
}

SKIP_INSTALL="${SKIP_INSTALL:-0}"
FORCE_INSTALL="${FORCE_INSTALL:-0}"
NO_BROWSER="${NO_BROWSER:-0}"
DOCKER_MODE="${DOCKER_MODE:-0}"
NO_BUILD="${NO_BUILD:-0}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-install)
      SKIP_INSTALL=1
      shift
      ;;
    --install)
      FORCE_INSTALL=1
      shift
      ;;
    --no-browser)
      NO_BROWSER=1
      shift
      ;;
    --docker)
      DOCKER_MODE=1
      shift
      ;;
    --no-build)
      NO_BUILD=1
      shift
      ;;
    -h|--help)
      echo "用法：./start.sh [--skip-install] [--install] [--no-browser] [--docker]"
      echo "  --skip-install  跳过前端依赖安装检查"
      echo "  --install       强制重新安装/校验前端依赖"
      echo "  --no-browser    启动后不自动打开浏览器"
      echo "  --docker        用 docker compose 启动全栈（postgres + 行情侧车 + Web）"
      echo "  --no-build      --docker 时跳过镜像构建（镜像已存在时更快）"
      exit 0
      ;;
    *)
      echo "未知参数：$1" >&2
      exit 1
      ;;
  esac
done

# --docker：全栈容器启动（postgres + 行情侧车 + Web），不依赖本机 Node / Python 环境。
if [[ "$DOCKER_MODE" == "1" ]]; then
  DOCKER_BIN="${DOCKER_BIN:-docker}"
  if ! command -v "${DOCKER_BIN##* }" >/dev/null 2>&1; then
    echo "未检测到 docker 命令：Linux 可执行 ./deploy.sh --install-docker 自动安装，Windows / macOS 请安装并启动 Docker Desktop。" >&2
    exit 1
  fi

  # compose 命令自动探测：优先 compose v2 插件，回退 v1 的 docker-compose
  COMPOSE_CMD="${COMPOSE_CMD:-}"
  if [[ -z "$COMPOSE_CMD" ]]; then
    if $DOCKER_BIN compose version >/dev/null 2>&1; then
      COMPOSE_CMD="$DOCKER_BIN compose"
    elif command -v docker-compose >/dev/null 2>&1; then
      COMPOSE_CMD="docker-compose"
    else
      echo "未检测到 compose：请安装 docker-compose-plugin 后重试。" >&2
      exit 1
    fi
  fi

  if [[ "$NO_BUILD" == "1" ]]; then
    step "启动全栈容器（跳过镜像构建）..."
    $COMPOSE_CMD up -d
  else
    step "构建并启动全栈容器（首次构建约 5 到 10 分钟）..."
    $COMPOSE_CMD up -d --build
  fi

  # 健康检查：curl → wget → python3 逐级回退，都没有时跳过等待
  HTTP_GET=""
  if command -v curl >/dev/null 2>&1; then
    HTTP_GET="curl"
  elif command -v wget >/dev/null 2>&1; then
    HTTP_GET="wget"
  elif command -v python3 >/dev/null 2>&1; then
    HTTP_GET="python3"
  fi

  http_ok() {
    case "$HTTP_GET" in
      curl) curl -fsS "$1" >/dev/null 2>&1 ;;
      wget) wget -qO- "$1" >/dev/null 2>&1 ;;
      python3) python3 -c 'import sys, urllib.request; urllib.request.urlopen(sys.argv[1], timeout=3)' "$1" >/dev/null 2>&1 ;;
      *) return 0 ;;
    esac
  }

  step "等待 Web 健康检查 http://127.0.0.1:3000/api/health ..."
  if [[ -z "$HTTP_GET" ]]; then
    warn "未检测到 curl / wget / python3，跳过健康检查等待，请自行访问 http://127.0.0.1:3000"
  else
    HEALTHY=0
    for _ in $(seq 1 90); do
      if http_ok http://127.0.0.1:3000/api/health; then
        HEALTHY=1
        break
      fi
      sleep 2
    done

    if [[ "$HEALTHY" != "1" ]]; then
      echo "Web 健康检查超时，请查看日志：$COMPOSE_CMD logs web" >&2
      exit 1
    fi
  fi

  printf '\n'
  printf '  Web  前端：%s\n' 'http://127.0.0.1:3000'
  printf '  行情/基金数据侧车：%s\n' 'http://127.0.0.1:8000'
  printf '  数据库：%s\n' 'postgresql://postgres:postgres@localhost:5432/stock_analysis'
  printf '  查看状态：%s ps\n' "$COMPOSE_CMD"
  printf '  停止全栈：./stop.sh --docker\n'
  printf '\n'
  exit 0
fi

step "检查 Node.js 版本..."
if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js，请先安装 Node.js 20+。" >&2
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "Node.js 版本过低，请升级到 Node.js 20+。" >&2
  exit 1
fi

step "选择 pnpm 包管理器..."
if command -v pnpm >/dev/null 2>&1; then
  PNPM_RUNNER="pnpm"
elif command -v corepack >/dev/null 2>&1; then
  PNPM_RUNNER="corepack"
else
  echo "未检测到 pnpm 或 corepack，请安装 pnpm 后重试。" >&2
  exit 1
fi

run_pnpm() {
  if [[ "$PNPM_RUNNER" == "corepack" ]]; then
    corepack pnpm "$@"
  else
    pnpm "$@"
  fi
}

step "准备环境变量文件..."
if [[ ! -f .env ]]; then
  if [[ -f .env.export ]]; then
    cp .env.export .env
    warn "已从迁移导出文件 .env.export 复制出 .env（如需调整请直接编辑 .env）。"
  else
    cp .env.example .env
    warn "已复制 .env.example 为 .env。未填写外部密钥时，系统会自动使用降级/演示数据。"
  fi
fi

if [[ "$SKIP_INSTALL" == "1" ]]; then
  :
elif [[ "$FORCE_INSTALL" == "1" || ! -d "$ROOT/node_modules/.pnpm" ]]; then
  step "安装/校验前端依赖..."
  run_pnpm install --frozen-lockfile
else
  step "已检测到前端依赖，跳过安装（需要强制安装请使用 --install）..."
fi

step "定位 Python 行情/基金数据侧车运行环境..."
PYTHON_BIN=""

if command -v conda >/dev/null 2>&1; then
  CONDA_BIN="$(command -v conda)"
  CONDA_BASE="$(dirname "$(dirname "$CONDA_BIN")")"
  CANDIDATE="$CONDA_BASE/envs/stock-analysis/bin/python"
  if [[ -x "$CANDIDATE" ]]; then
    PYTHON_BIN="$CANDIDATE"
  fi
fi

if [[ -z "$PYTHON_BIN" && -x "$ROOT/.venv/bin/python" ]]; then
  PYTHON_BIN="$ROOT/.venv/bin/python"
fi

if [[ -z "$PYTHON_BIN" ]]; then
  BASE_PYTHON=""
  for candidate in python3.12 python3.11 python3 python; do
    if command -v "$candidate" >/dev/null 2>&1; then
      BASE_PYTHON="$(command -v "$candidate")"
      break
    fi
  done

  if [[ -z "$BASE_PYTHON" ]]; then
    echo "未检测到 Python，请先安装 Python 3.12+。" >&2
    exit 1
  fi

  step "创建本地 Python 虚拟环境 .venv..."
  "$BASE_PYTHON" -m venv "$ROOT/.venv"
  PYTHON_BIN="$ROOT/.venv/bin/python"
fi

step "检查并安装行情/基金数据侧车基础依赖..."
if ! "$PYTHON_BIN" -c "import fastapi, uvicorn, curl_cffi" >/dev/null 2>&1; then
  "$PYTHON_BIN" -m pip install --upgrade pip
  "$PYTHON_BIN" -m pip install "fastapi>=0.115" "uvicorn[standard]>=0.30" "pydantic-settings>=2.6" "curl_cffi>=0.10"
fi

if ! "$PYTHON_BIN" -c "import akshare" >/dev/null 2>&1; then
  step "尝试安装可选 AkShare 数据源..."
  if ! "$PYTHON_BIN" -m pip install "akshare>=1.16" "py-mini-racer>=0.6"; then
    warn "AkShare 安装失败，不影响 Tencent 实时行情与确定性回退数据。"
  fi
fi

step "启动 FastAPI 行情/基金数据侧车..."
"$PYTHON_BIN" -m uvicorn app.main:app --app-dir data-service --host 127.0.0.1 --port 8000 \
  >"$DATA_LOG" 2>"$DATA_ERR" &
DATA_PID=$!

WORKER_PID=""

cleanup() {
  if [[ -n "$WORKER_PID" ]] && kill -0 "$WORKER_PID" >/dev/null 2>&1; then
    kill "$WORKER_PID" >/dev/null 2>&1 || true
  fi
  if kill -0 "$DATA_PID" >/dev/null 2>&1; then
    kill "$DATA_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

check_data_health() {
  "$PYTHON_BIN" -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)" >/dev/null 2>&1
}

DATA_HEALTHY=0
for _ in {1..60}; do
  if check_data_health; then
    DATA_HEALTHY=1
    break
  fi
  sleep 1
done

if [[ "$DATA_HEALTHY" != "1" ]]; then
  echo "行情/基金数据侧车健康检查失败，请查看日志：$DATA_LOG、$DATA_ERR" >&2
  exit 1
fi

step "行情/基金数据侧车已就绪：http://127.0.0.1:8000/health"
export DATA_SERVICE_URL="http://127.0.0.1:8000"

if [[ "${SKIP_SCHEDULER_WORKER:-0}" != "1" ]]; then
  step "启动定时任务守护进程..."
  node "$ROOT/scripts/scheduler-worker.mjs" >"$WORKER_LOG" 2>"$WORKER_ERR" &
  WORKER_PID=$!
fi

step "启动 Web 前端：http://127.0.0.1:3000"
if [[ "$NO_BROWSER" != "1" ]]; then
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://127.0.0.1:3000" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then
    open "http://127.0.0.1:3000" >/dev/null 2>&1 || true
  fi
fi

printf '\n'
printf '  Web  前端：%s\n' 'http://127.0.0.1:3000'
printf '  行情/基金数据侧车：%s\n' 'http://127.0.0.1:8000'
printf '  停止服务：在终端按 Ctrl+C\n'
printf '\n'

run_pnpm dev
