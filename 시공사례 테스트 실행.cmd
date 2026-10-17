@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
call "%~dp0블로그 스튜디오 테스트 실행.cmd"
exit /b %errorlevel%
