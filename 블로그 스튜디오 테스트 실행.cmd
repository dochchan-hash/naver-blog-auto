@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "LEMONHOUSE_DATA_DIR=%~dp0.local"
if not exist "%~dp0node_modules\electron\dist\electron.exe" (
  echo Test runtime is missing. Run npm ci and npm run build in this folder.
  pause
  exit /b 1
)
if not exist "%~dp0dist\index.html" (
  echo Test screen is missing. Run npm run build in this folder.
  pause
  exit /b 1
)
start "" /D "%~dp0" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0desktop\main.cjs"
exit /b 0
