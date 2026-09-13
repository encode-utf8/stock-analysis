[CmdletBinding()]
param(
    [switch]$Stop,
    [int]$IntervalSeconds = 0,
    [int]$MaxFailures = 0
)

# 定时任务守护进程生命周期管理：默认按 .logs/scheduler-worker.pid 启动 / 停止。

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$logsDir = Join-Path $root ".logs"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
$pidFile = Join-Path $logsDir "scheduler-worker.pid"
$outLog = Join-Path $logsDir "scheduler-worker.out.log"
$errLog = Join-Path $logsDir "scheduler-worker.err.log"

if ($Stop) {
    if (Test-Path -LiteralPath $pidFile) {
        $workerPid = [int]((Get-Content -LiteralPath $pidFile -Raw).Trim())
        if ($workerPid -gt 0) {
            Stop-Process -Id $workerPid -Force -ErrorAction SilentlyContinue
        }
        Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    }
    exit 0
}

if ($env:SKIP_SCHEDULER_WORKER -eq "1") {
    Write-Output "SKIP_SCHEDULER_WORKER=1，已跳过定时任务守护进程。"
    exit 0
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    throw "未检测到 Node.js，无法启动定时任务守护进程。"
}

$workerArgs = @("scripts/scheduler-worker.mjs")
if ($IntervalSeconds -gt 0) {
    $workerArgs += @("--interval", "$IntervalSeconds")
}
if ($MaxFailures -gt 0) {
    $workerArgs += @("--max-failures", "$MaxFailures")
}

$workerProcess = Start-Process -FilePath $nodeCommand.Source -ArgumentList $workerArgs -WorkingDirectory $root -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru -WindowStyle Hidden
Set-Content -LiteralPath $pidFile -Value $workerProcess.Id

# 与 start-data.ps1 一致：父进程退出后自动回收守护进程，避免残留。
$parentPid = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId
$watchFile = Join-Path $logsDir "watch-scheduler.ps1"
$watchContent = @"
`$parentPid = $parentPid
`$workerPid = $($workerProcess.Id)
`$pidFile = '$pidFile'
while (Get-Process -Id `$parentPid -ErrorAction SilentlyContinue) {
    Start-Sleep -Seconds 2
}
Stop-Process -Id `$workerPid -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath `$pidFile -Force -ErrorAction SilentlyContinue
"@
Set-Content -LiteralPath $watchFile -Value $watchContent -Encoding UTF8
Start-Process -FilePath "powershell" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $watchFile) -WindowStyle Hidden

Write-Output $workerProcess.Id
