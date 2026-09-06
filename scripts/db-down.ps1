[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

docker compose down
if ($LASTEXITCODE -ne 0) {
    throw "PostgreSQL 容器停止失败。"
}

Write-Host "PostgreSQL 容器已停止。" -ForegroundColor Cyan
