@echo off
chcp 65001 >nul
title WhatsApp Service - Restart
cls
echo.
echo ================================================
echo   WhatsApp Service - Restart
echo ================================================
echo.

REM Переход в директорию скрипта
cd /d %~dp0

REM Остановка существующих процессов
echo [1/5] Stopping existing Node.js processes...
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

REM Проверка Node.js
echo [2/5] Checking Node.js...
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo       ERROR: Node.js is not installed!
    echo       Please install Node.js from https://nodejs.org/
    echo.
    pause
    exit /b 1
)
echo       Node.js found.
echo.

REM Проверка зависимостей
echo [3/5] Checking dependencies...
if not exist "node_modules" (
    echo       Installing dependencies...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo       ERROR: Failed to install dependencies!
        pause
        exit /b 1
    )
    echo       Dependencies installed.
) else (
    echo       Dependencies found.
)
echo.

REM Проверка Spring Boot API
echo [4/5] Checking Spring Boot API connection...
curl -s http://localhost:8080/api/webhook/health >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo       Spring Boot API is running.
) else (
    echo       WARNING: Spring Boot API might not be running on http://localhost:8080
    echo       Make sure Spring Boot application is started.
)
echo.

REM Запуск сервиса
echo [5/5] Starting WhatsApp Service...
echo.
echo ================================================
echo   Service will start in a new window.
echo   Web interface: http://localhost:3000
echo   Make sure Spring Boot is running on port 8080
echo ================================================
echo.
start "WhatsApp Service" cmd /k "title WhatsApp Service && chcp 65001 >nul && npm start"
timeout /t 5 /nobreak >nul

echo.
echo ================================================
echo   WhatsApp Service is starting...
echo   Check the new window for startup logs.
echo   Web interface: http://localhost:3000
echo ================================================
echo.
echo Press any key to close this window...
pause >nul


