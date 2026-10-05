@echo off
set "LEMONHOUSE_DATA_DIR=%~dp0.local"
if not exist "%~dp0release\win-unpacked\Lemonhouse Blog Studio.exe" (
  echo Lemonhouse Blog Studio.exe is missing. Keep the complete program folder.
  exit /b 1
)
start "" "%~dp0release\win-unpacked\Lemonhouse Blog Studio.exe"
