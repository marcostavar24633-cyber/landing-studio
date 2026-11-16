@echo off
chcp 65001 >nul
title Landing Studio - AI bridge
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Не найден Node.js. Установите его с https://nodejs.org и запустите файл снова.
  pause
  exit /b 1
)
node tools\local-ai-bridge.cjs --check
if errorlevel 2 (
  echo.
  echo Сейчас откроется вход в аккаунт Claude. Это нужно сделать один раз.
  echo.
  node tools\local-ai-bridge.cjs --login
)
echo.
node tools\local-ai-bridge.cjs
pause
