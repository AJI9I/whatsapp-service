@echo off
chcp 65001 >nul
title WhatsApp Service - Check and Start
echo ============================================
echo   Checking WhatsApp Service Status
echo ============================================
echo.

REM Проверка Node.js
echo [1/3] Checking Node.js installation...
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo       ERROR: Node.js is not installed or not in PATH!
    echo       Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)
echo       Node.js found.
echo.

REM Проверка запущенных процессов Node.js
echo [2/3] Checking for running Node.js processes...
tasklist /FI "IMAGENAME eq node.exe" 2>nul | find /I /N "node.exe">nul
if %ERRORLEVEL% EQU 0 (
    echo       Node.js processes found:
    tasklist /FI "IMAGENAME eq node.exe" /FO LIST | findstr /I "PID Image"
    echo.
    echo       WhatsApp service might already be running.
    echo       Check http://localhost:3000 for web interface.
    pause
    exit /b 0
) else (
    echo       No Node.js processes found.
)
echo.

REM Переход в директорию сервиса
cd /d %~dp0

REM Проверка зависимостей
echo [3/3] Checking dependencies...
if not exist "node_modules" (
    echo       Dependencies not found. Installing...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo       ERROR: Failed to install dependencies!
        pause
        exit /b 1
    )
) else (
    echo       Dependencies found.
)
echo.

echo ============================================
echo   Starting WhatsApp Service...
echo ============================================
echo.
echo Service will start in a new window.
echo Web interface: http://localhost:3000
echo.

start "WhatsApp Service" cmd /k "title WhatsApp Service && npm start"
timeout /t 3 /nobreak >nul

echo ============================================
echo   WhatsApp Service is starting...
echo   Check the new window for startup logs.
echo   Web interface: http://localhost:3000
echo ============================================
echo.
pause


