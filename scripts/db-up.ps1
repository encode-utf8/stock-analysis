[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

docker compose up -d postgres
if ($LASTEXITCODE -ne 0) {
    throw "PostgreSQL 容器启动失败，请确认 Docker Desktop 正在运行。"
}

Write-Host "PostgreSQL 容器已启动，请等待 healthy 后执行：corepack pnpm db:migrate" -ForegroundColor Cyan
docker compose ps postgres
