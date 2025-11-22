@echo off
chcp 65001 >nul
title WhatsApp Service
cd /d %~dp0

echo.
echo ================================================
echo   WhatsApp Service - Starting
echo ================================================
echo.

REM Stop old processes
echo [1/4] Stopping old Node.js processes...
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul
echo Done.
echo.

REM Check Node.js
echo [2/4] Checking Node.js...
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/
    echo.
    pause
    exit /b 1
)
echo Node.js found.
echo.

REM Check dependencies
echo [3/4] Checking dependencies...
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo ERROR: Failed to install dependencies!
        pause
        exit /b 1
    )
    echo Dependencies installed.
) else (
    echo Dependencies found.
)
echo.

REM Start service
echo [4/4] Starting WhatsApp Service...
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


