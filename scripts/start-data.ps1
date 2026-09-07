[CmdletBinding()]
param(
    [switch]$Stop
)

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$logsDir = Join-Path $root ".logs"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
$pidFile = Join-Path $logsDir "data-service.pid"
$dataLog = Join-Path $logsDir "data-service.out.log"
$dataErr = Join-Path $logsDir "data-service.err.log"

if ($Stop) {
    if (Test-Path -LiteralPath $pidFile) {
        $dataPid = [int]((Get-Content -LiteralPath $pidFile -Raw).Trim())
        if ($dataPid -gt 0) {
            Stop-Process -Id $dataPid -Force -ErrorAction SilentlyContinue
        }
        Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    }
    exit 0
}

$pythonExe = $null

if (Get-Command conda.exe -ErrorAction SilentlyContinue) {
    $condaSource = (Get-Command conda.exe -ErrorAction SilentlyContinue).Source
    $condaBase = Split-Path (Split-Path $condaSource -Parent) -Parent
    $candidate = Join-Path $condaBase "envs\stock-analysis\python.exe"
    if (Test-Path -LiteralPath $candidate) {
        $pythonExe = $candidate
    }
}

if (-not $pythonExe) {
    $venvPython = Join-Path $root ".venv\Scripts\python.exe"
    if (Test-Path -LiteralPath $venvPython) {
        $pythonExe = $venvPython
    }
}

if (-not $pythonExe) {
    $basePython = $null
    foreach ($name in @("py", "python", "python3")) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($command) {
            $basePython = $command.Source
            break
        }
    }
    if (-not $basePython) {
        throw "未检测到 Python，请先安装 Python 3.12+。"
    }

    & $basePython -m venv .venv
    if ($LASTEXITCODE -ne 0) {
        throw "创建 Python 虚拟环境失败。"
    }
    $venvPython = Join-Path $root ".venv\Scripts\python.exe"
    $pythonExe = if (Test-Path -LiteralPath $venvPython) { $venvPython } else { $basePython }
}

& $pythonExe -c "import fastapi, uvicorn, curl_cffi" *> $null
if ($LASTEXITCODE -ne 0) {
    & $pythonExe -m pip install --upgrade pip
    & $pythonExe -m pip install "fastapi>=0.115" "uvicorn[standard]>=0.30" "pydantic-settings>=2.6" "curl_cffi>=0.10"
    if ($LASTEXITCODE -ne 0) {
        throw "行情/基金数据侧车基础依赖安装失败。"
    }
}

& $pythonExe -c "import akshare" *> $null
if ($LASTEXITCODE -ne 0) {
    & $pythonExe -m pip install "akshare>=1.16" "py-mini-racer>=0.6"
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "AkShare 安装失败，不影响 Tencent 实时行情与确定性回退数据。"
    }
}

$dataArgs = @(
    "-m", "uvicorn",
    "app.main:app",
    "--app-dir", "data-service",
    "--host", "127.0.0.1",
    "--port", "8000"
)

$dataProcess = Start-Process -FilePath $pythonExe -ArgumentList $dataArgs -WorkingDirectory $root -RedirectStandardOutput $dataLog -RedirectStandardError $dataErr -PassThru -WindowStyle Hidden
Set-Content -LiteralPath $pidFile -Value $dataProcess.Id

$parentPid = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId
$watchFile = Join-Path $logsDir "watch-data.ps1"
$watchContent = @"
`$parentPid = $parentPid
`$dataPid = $($dataProcess.Id)
`$pidFile = '$pidFile'
while (Get-Process -Id `$parentPid -ErrorAction SilentlyContinue) {
    Start-Sleep -Seconds 2
}
Stop-Process -Id `$dataPid -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath `$pidFile -Force -ErrorAction SilentlyContinue
"@
Set-Content -LiteralPath $watchFile -Value $watchContent -Encoding UTF8
Start-Process -FilePath "powershell" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $watchFile) -WindowStyle Hidden

Write-Output $dataProcess.Id
