[CmdletBinding()]
param()

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$currentPid = $PID
$patterns = @(
    "*$root*next*",
    "*next dev*",
    "*uvicorn app.main:app*",
    "*$root*data-service*",
    "*dev-data.ps1*",
    "*start-data.ps1*",
    "*watch-data.ps1*",
    "*scheduler-worker.mjs*"
)

$targets = @()
foreach ($process in Get-CimInstance Win32_Process) {
    if ($process.ProcessId -eq $currentPid) {
        continue
    }
    $commandLine = [string]$process.CommandLine
    if ([string]::IsNullOrWhiteSpace($commandLine)) {
        continue
    }

    foreach ($pattern in $patterns) {
        if ($commandLine -like $pattern) {
            $targets += $process
            break
        }
    }
}

foreach ($process in $targets) {
    Write-Host "[stop] $($process.Name) PID $($process.ProcessId)"
    & taskkill.exe /PID $process.ProcessId /T /F 2>$null | Out-Null
}

# 回收定时任务守护进程（同时清理 .logs/scheduler-worker.pid）
& (Join-Path $PSScriptRoot "start-scheduler.ps1") -Stop

$pidFile = Join-Path $root ".logs\data-service.pid"
if (Test-Path -LiteralPath $pidFile) {
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}
