@echo off
chcp 65001 >nul
title WhatsApp Service - Restart
cd /d %~dp0

echo.
echo ================================================
echo   Restarting WhatsApp Service...
echo ================================================
echo.

REM Остановка старых процессов
echo [1/2] Stopping existing processes...
tasklist /FI "IMAGENAME eq node.exe" 2>nul | find /I "node.exe" >nul
if %ERRORLEVEL% EQU 0 (
    echo       Stopping Node.js processes...
    taskkill /F /IM node.exe >nul 2>&1
    timeout /t 3 /nobreak >nul
    echo       Processes stopped.
) else (
    echo       No running processes found.
)
echo.

REM Запуск
echo [2/2] Starting WhatsApp Service...
echo.
echo Web interface: http://localhost:3000
echo.
start "WhatsApp Service" cmd /k "title WhatsApp Service && chcp 65001 >nul && npm start"
timeout /t 3 /nobreak >nul

echo.
echo ================================================
echo   WhatsApp Service is restarting...
echo   Check the new window for startup logs.
echo   Web interface: http://localhost:3000
echo ================================================
echo.
pause


