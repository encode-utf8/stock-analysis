@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js，请先安装 Node.js 20+（项目运行依赖）。
  pause
  exit /b 1
)

echo [导出] 正在生成 .env.export ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0export-config.ps1" %*
if errorlevel 1 (
  echo.
  echo 导出失败，请查看上方提示（导出文件已存在时需要加 -Force 覆盖）。
  pause
  exit /b 1
)

echo.
echo [完成] 把 .env.export 复制到目标环境的项目根目录即可自动加载配置。
pause
