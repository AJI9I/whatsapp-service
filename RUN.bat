@echo off
chcp 65001 >nul
title WhatsApp Service
cd /d %~dp0

echo.
echo ================================================
echo   Starting WhatsApp Service...
echo ================================================
echo.

REM Остановка старых процессов
echo [1/3] Stopping old processes...
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul

REM Проверка Node.js
echo [2/3] Checking Node.js...
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed!
    pause
    exit /b 1
)

REM Запуск
echo [3/3] Starting service...
echo.
echo Web interface: http://localhost:3000
echo.
start "WhatsApp Service" cmd /k "title WhatsApp Service && chcp 65001 >nul && npm start"

echo.
echo Service is starting in a new window.
pause


