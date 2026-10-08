@echo off
set "ELECTRON_RUN_AS_NODE="
set "LEMONHOUSE_DATA_DIR=%~dp0.local"
set "STUDIO_EXE=%~dp0release\oct8-r8\win-unpacked\Lemonhouse Blog Studio.exe"
if not exist "%STUDIO_EXE%" set "STUDIO_EXE=%~dp0release\win-unpacked\Lemonhouse Blog Studio.exe"
if not exist "%STUDIO_EXE%" (
  echo Lemonhouse Blog Studio.exe is missing. Keep the complete program folder.
  exit /b 1
)
start "" "%STUDIO_EXE%"
