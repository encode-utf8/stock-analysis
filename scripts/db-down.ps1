[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

# 只停 PostgreSQL：全栈化后 docker compose down 会连 Web 与行情侧车一起停，这里不再适用。
docker compose rm -sf postgres
if ($LASTEXITCODE -ne 0) {
    throw "PostgreSQL 容器停止失败。"
}

Write-Host "PostgreSQL 容器已停止（数据卷保留，Web 与侧车不受影响）。" -ForegroundColor Cyan
