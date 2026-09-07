@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "SKIP_INSTALL="
set "FORCE_INSTALL="
set "NO_BROWSER="

:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="--skip-install" set "SKIP_INSTALL=1"
if /i "%~1"=="--install" set "FORCE_INSTALL=1"
if /i "%~1"=="--no-browser" set "NO_BROWSER=1"
shift
goto parse_args
:args_done

if not exist ".logs" mkdir ".logs"

echo [启动] 检查 Node.js 版本...
where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js，请先安装 Node.js 20+。
  pause
  exit /b 1
)
for /f "delims=." %%v in ('node -p "process.versions.node.split('.')[0]"') do set "NODE_MAJOR=%%v"
if !NODE_MAJOR! LSS 20 (
  echo Node.js 版本过低，请升级到 Node.js 20+。
  pause
  exit /b 1
)

echo [启动] 选择 pnpm 包管理器...
set "PNPM_RUNNER="
where pnpm >nul 2>nul
if not errorlevel 1 set "PNPM_RUNNER=pnpm"
if not defined PNPM_RUNNER (
  where corepack >nul 2>nul
  if errorlevel 1 (
    echo 未检测到 pnpm 或 corepack，请安装 pnpm 后重试。
    pause
    exit /b 1
  )
  set "PNPM_RUNNER=corepack pnpm"
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo [提示] 已复制 .env.example 为 .env；未填写外部密钥时会使用降级数据。
)

if defined SKIP_INSTALL goto install_done
if defined FORCE_INSTALL goto install_run
if exist "node_modules\.pnpm" goto install_done

:install_run
echo [启动] 安装/校验前端依赖...
if "%PNPM_RUNNER%"=="pnpm" (
  call pnpm install --frozen-lockfile
) else (
  call corepack pnpm install --frozen-lockfile
)
if errorlevel 1 (
  echo pnpm 依赖安装失败。
  pause
  exit /b 1
)
:install_done

echo [启动] 启动行情/基金数据侧车...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-data.ps1"
if errorlevel 1 (
  echo 行情/基金数据侧车启动失败。
  pause
  exit /b 1
)

set "DATA_HEALTHY="
for /l %%i in (1,1,60) do (
  curl.exe -fsS http://127.0.0.1:8000/health >nul 2>nul
  if not errorlevel 1 (
    set "DATA_HEALTHY=1"
    goto data_ready
  )
  timeout /t 1 /nobreak >nul
)
:data_ready
if not defined DATA_HEALTHY (
  echo 行情/基金数据侧车健康检查失败，请查看 .logs\data-service.err.log
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-data.ps1" -Stop
  pause
  exit /b 1
)

echo [启动] 行情/基金数据侧车已就绪：http://127.0.0.1:8000/health
set "DATA_SERVICE_URL=http://127.0.0.1:8000"

echo [启动] 启动 Web 前端：http://127.0.0.1:3000
if not defined NO_BROWSER start "" "http://127.0.0.1:3000"

echo.
echo   Web 前端：http://127.0.0.1:3000
echo   行情/基金数据侧车：http://127.0.0.1:8000
echo   停止服务：在终端按 Ctrl+C
echo.

if "%PNPM_RUNNER%"=="pnpm" (
  call pnpm dev
) else (
  call corepack pnpm dev
)
set "FRONTEND_EXIT=%errorlevel%"

echo [启动] 正在停止行情/基金数据侧车...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-data.ps1" -Stop

exit /b %FRONTEND_EXIT%
