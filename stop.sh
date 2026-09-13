#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

stop_port() {
  local port="$1"
  local name="$2"
  local pids=""

  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  elif command -v fuser >/dev/null 2>&1; then
    pids="$(fuser "$port"/tcp 2>/dev/null || true)"
  fi

  if [[ -z "${pids//[[:space:]]/}" ]]; then
    printf '[跳过] %s（端口 %s）未在运行。\n' "$name" "$port"
    return 0
  fi

  for pid in $pids; do
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" >/dev/null 2>&1; then
      printf '[终止] %s PID %s\n' "$name" "$pid"
      kill "$pid" >/dev/null 2>&1 || true
      sleep 1
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  done
}

kill_matching() {
  local pattern="$1"
  if command -v pkill >/dev/null 2>&1; then
    pkill -f "$pattern" >/dev/null 2>&1 || true
  fi
}

printf '[终止] 回收定时任务守护进程...\n'
kill_matching "scheduler-worker.mjs"

printf '[终止] 清理行情侧车 PID 文件...\n'
rm -f "$ROOT/.logs/data-service.pid"

stop_port 8000 "行情侧车"
stop_port 3000 "Web 前端"

kill_matching "$ROOT.*next dev"
kill_matching "uvicorn app.main:app.*--port 8000"

printf '\n[完成] 已终止 Web 前端、行情侧车与定时任务守护进程。\n'
