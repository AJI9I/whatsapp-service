@echo off
chcp 65001 >nul
title WhatsApp Service - Starting
cd /d %~dp0

echo.
echo ================================================
echo   Starting WhatsApp Service...
echo ================================================
echo.

REM Stop old Node.js processes
echo [1/3] Stopping old processes...
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul
echo Done.
echo.

REM Check Node.js
echo [2/3] Checking Node.js...
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)
echo Node.js found.
echo.

REM Start service
echo [3/3] Starting WhatsApp Service...
echo.
echo Web interface: http://localhost:3000
echo A new window will open with logs.
echo.
start "WhatsApp Service" cmd /k "title WhatsApp Service && chcp 65001 >nul && cd /d %~dp0 && npm start"
timeout /t 3 /nobreak >nul

echo.
echo ================================================
echo   WhatsApp Service is starting...
echo   Check the new window for startup logs.
echo   Web interface: http://localhost:3000
echo ================================================
echo.
pause
