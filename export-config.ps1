<#
.SYNOPSIS
    导出当前 .env 配置，生成可迁移的 .env.export。

.DESCRIPTION
    把项目根的 .env 合并进 .env.example 的键位顺序，生成 .env.export。
    迁移到新机器 / 云服务器时，只需把 .env.export 复制到目标环境的项目根目录，
    项目启动（一键脚本 / next dev / docker compose）会自动加载并补全缺失配置，
    且不会覆盖目标环境已有的 .env 与环境变量。

.EXAMPLE
    ./export-config.ps1
    ./export-config.ps1 -Force
    ./export-config.ps1 -Output D:\backup\.env.export -Force
#>
param(
    [string]$Output = ".env.export",
    [string]$EnvPath = ".env",
    [string]$TemplatePath = ".env.example",
    [switch]$Force,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

$core = Join-Path $PSScriptRoot "scripts\export-config.mjs"
if (-not (Test-Path -LiteralPath $core)) {
    Write-Host "未找到 scripts\export-config.mjs，请在完整仓库内运行本脚本。" -ForegroundColor Red
    exit 1
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    Write-Host "未检测到 Node.js，请先安装 Node.js 20+（项目运行依赖）。" -ForegroundColor Red
    exit 1
}

if ($Help) {
    & $nodeCommand.Source $core "--help"
    exit $LASTEXITCODE
}

$nodeArgs = @($core, "--output", $Output, "--env", $EnvPath, "--template", $TemplatePath)
if ($Force) {
    $nodeArgs += "--force"
}

& $nodeCommand.Source @nodeArgs
exit $LASTEXITCODE
