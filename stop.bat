@echo off
setlocal
cd /d "%~dp0"

if /i "%~1"=="--docker" goto docker_stop

echo [stop] stopping project processes...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop.ps1"

call :stop_port 8000 "data-service"
call :stop_port 3000 "web-frontend"

echo.
echo [done] web frontend, data service and scheduler worker stopped.
exit /b 0

:docker_stop
echo [stop] stopping full stack containers...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop.ps1" -Docker
echo.
echo [done] containers stopped; data volumes are kept.
exit /b 0

:stop_port
set "PORT=%~1"
set "NAME=%~2"
set "FOUND="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /C:":%PORT%" ^| findstr /C:"LISTENING"') do (
    if not defined FOUND set "FOUND=1"
    echo [stop] %NAME% PID %%P
    taskkill /PID %%P /T /F >nul 2>nul
)
if not defined FOUND (
    echo [skip] %NAME% port %PORT% not running.
)
exit /b 0
