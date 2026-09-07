[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [switch]$Install,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Continue"
$root = $PSScriptRoot
Set-Location $root

$logsDir = Join-Path $root ".logs"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
$dataLog = Join-Path $logsDir "data-service.out.log"
$dataErr = Join-Path $logsDir "data-service.err.log"

function Write-Step {
    param([string]$Message)
    Write-Host "[启动] $Message" -ForegroundColor Cyan
}

function Test-Command {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

Write-Step "检查 Node.js 版本..."
if (-not (Test-Command "node")) {
    throw "未检测到 Node.js，请先安装 Node.js 20+。"
}
$nodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 20) {
    throw "Node.js 版本过低，请升级到 Node.js 20+。"
}

Write-Step "选择 pnpm 包管理器..."
$pnpmRunner = $null
if (Test-Command "pnpm") {
    $pnpmRunner = "pnpm"
} elseif (Test-Command "corepack") {
    $pnpmRunner = "corepack"
} else {
    throw "未检测到 pnpm 或 corepack，请安装 pnpm 后重试。"
}

function Invoke-Pnpm {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$PnpmArguments)
    if ($pnpmRunner -eq "corepack") {
        & corepack pnpm @PnpmArguments
    } else {
        & pnpm @PnpmArguments
    }
    if ($LASTEXITCODE -ne 0) {
        throw "pnpm 命令执行失败：$($PnpmArguments -join ' ')"
    }
}

Write-Step "准备环境变量文件..."
if (-not (Test-Path -LiteralPath ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "  已复制 .env.example 为 .env。未填写外部密钥时，系统会自动使用降级/演示数据。" -ForegroundColor Yellow
}

$nodeModulesMarker = Join-Path $root "node_modules\.pnpm"
$shouldInstall = $false
if ($SkipInstall) {
    $shouldInstall = $false
} elseif ($Install) {
    $shouldInstall = $true
} else {
    $shouldInstall = -not (Test-Path -LiteralPath $nodeModulesMarker)
}

if ($shouldInstall) {
    Write-Step "安装/校验前端依赖..."
    Invoke-Pnpm install --frozen-lockfile
} else {
    Write-Step "已检测到前端依赖，跳过安装（需要强制安装请使用 --install）..."
}

Write-Step "定位 Python 行情/基金数据侧车运行环境..."
$pythonExe = $null

if (Test-Command "conda.exe") {
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
    if (Test-Path -LiteralPath $venvPython) {
        $pythonExe = $venvPython
    } else {
        $pythonExe = $basePython
    }
}

Write-Step "检查并安装行情/基金数据侧车基础依赖..."
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
    Write-Step "尝试安装可选 AkShare 数据源..."
    & $pythonExe -m pip install "akshare>=1.16" "py-mini-racer>=0.6"
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "AkShare 安装失败，不影响 Tencent 实时行情与确定性回退数据。"
    }
}

Write-Step "启动 FastAPI 行情/基金数据侧车..."
$dataArgs = @(
    "-m", "uvicorn",
    "app.main:app",
    "--app-dir", "data-service",
    "--host", "127.0.0.1",
    "--port", "8000"
)
$dataProcess = Start-Process -FilePath $pythonExe -ArgumentList $dataArgs -WorkingDirectory $root -RedirectStandardOutput $dataLog -RedirectStandardError $dataErr -PassThru -WindowStyle Hidden

$dataHealthy = $false
for ($index = 0; $index -lt 60; $index += 1) {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:8000/health" -TimeoutSec 2
        if ($health.status -eq "ok") {
            $dataHealthy = $true
            break
        }
    } catch {
        Start-Sleep -Seconds 1
    }
}

if (-not $dataHealthy) {
    if ($dataProcess -and -not $dataProcess.HasExited) {
        Stop-Process -Id $dataProcess.Id -Force -ErrorAction SilentlyContinue
    }
    throw "行情/基金数据侧车健康检查失败，请查看日志：$dataLog、$dataErr"
}

Write-Step "行情/基金数据侧车已就绪：http://127.0.0.1:8000/health"
$env:DATA_SERVICE_URL = "http://127.0.0.1:8000"

Write-Step "启动 Web 前端：http://127.0.0.1:3000"
if (-not $NoBrowser) {
    try {
        Start-Process "http://127.0.0.1:3000"
    } catch {
        Write-Warning "自动打开浏览器失败，请手动访问 http://127.0.0.1:3000"
    }
}

Write-Host ""
Write-Host "  Web  前端：http://127.0.0.1:3000" -ForegroundColor Green
Write-Host "  行情/基金数据侧车：http://127.0.0.1:8000" -ForegroundColor Green
Write-Host "  停止服务：在终端按 Ctrl+C" -ForegroundColor Green
Write-Host ""

try {
    Invoke-Pnpm dev
} finally {
    Write-Step "正在停止行情/基金数据侧车..."
    if ($dataProcess -and -not $dataProcess.HasExited) {
        Stop-Process -Id $dataProcess.Id -Force -ErrorAction SilentlyContinue
    }
}
