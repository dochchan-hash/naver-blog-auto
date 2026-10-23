@echo off
setlocal
set "ELECTRON_RUN_AS_NODE="
set "LEMONHOUSE_DATA_DIR=%~dp0.local"
set "STUDIO_EXE=%~dp0release\win-unpacked\Lemonhouse Blog Studio.exe"
if not exist "%STUDIO_EXE%" goto missing
if not exist "%~dp0release\win-unpacked\resources\app.asar" goto missing
start "" "%STUDIO_EXE%"
if errorlevel 1 (
  echo Blog Studio failed to start.
  pause
  exit /b 1
)
exit /b 0
:missing
echo Program files could not be found for "%STUDIO_EXE%".
echo Keep the complete program folder, including resources and DLL files.
pause
exit /b 1
