#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

LOGS_DIR="$ROOT/.logs"
mkdir -p "$LOGS_DIR"
DATA_LOG="$LOGS_DIR/data-service.out.log"
DATA_ERR="$LOGS_DIR/data-service.err.log"

step() {
  printf '\033[36m[启动] %s\033[0m\n' "$1"
}

warn() {
  printf '\033[33m%s\033[0m\n' "$1" >&2
}

SKIP_INSTALL="${SKIP_INSTALL:-0}"
FORCE_INSTALL="${FORCE_INSTALL:-0}"
NO_BROWSER="${NO_BROWSER:-0}"

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
    -h|--help)
      echo "用法：./start.sh [--skip-install] [--install] [--no-browser]"
      echo "  --skip-install  跳过前端依赖安装检查"
      echo "  --install       强制重新安装/校验前端依赖"
      echo "  --no-browser    启动后不自动打开浏览器"
      exit 0
      ;;
    *)
      echo "未知参数：$1" >&2
      exit 1
      ;;
  esac
done

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
  cp .env.example .env
  warn "已复制 .env.example 为 .env。未填写外部密钥时，系统会自动使用降级/演示数据。"
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

cleanup() {
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
