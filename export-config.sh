#!/usr/bin/env bash
# 配置导出脚本（Linux / macOS 入口）：参数直接转发给 scripts/export-config.mjs。
# 用法：./export-config.sh [--output .env.export] [--env .env] [--template .env.example] [--force] [--help]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE="$SCRIPT_DIR/scripts/export-config.mjs"

if [[ ! -f "$CORE" ]]; then
  echo "未找到 $CORE，请在完整仓库内运行本脚本。" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 node，请先安装 Node.js 20+（项目运行依赖）。" >&2
  exit 1
fi

exec node "$CORE" "$@"
