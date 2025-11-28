@echo off
setlocal enabledelayedexpansion
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
echo [1/5] Stopping existing processes on port 3000...
REM Проверка и остановка процесса на порту 3000
netstat -ano | findstr :3000 | findstr LISTENING >nul
if %ERRORLEVEL% EQU 0 (
    echo       Found process on port 3000, stopping...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
        echo       Stopping process PID: %%a
        taskkill /F /PID %%a >nul 2>&1
    )
    timeout /t 2 /nobreak >nul
    echo       Process stopped.
) else (
    echo       Port 3000 is free.
)
REM Остановка всех процессов Node.js (на случай если порт занят другим процессом)
tasklist /FI "IMAGENAME eq node.exe" 2>nul | find /I "node.exe" >nul
if %ERRORLEVEL% EQU 0 (
    echo       Stopping all Node.js processes...
    taskkill /F /IM node.exe >nul 2>&1
    timeout /t 2 /nobreak >nul
    echo       Node.js processes stopped.
) else (
    echo       No Node.js processes found.
)
REM Дополнительная проверка порта после остановки
timeout /t 1 /nobreak >nul
netstat -ano | findstr :3000 | findstr LISTENING >nul
if %ERRORLEVEL% EQU 0 (
    echo       WARNING: Port 3000 is still in use!
    echo       Trying to stop process again...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
        taskkill /F /PID %%a >nul 2>&1
    )
    timeout /t 2 /nobreak >nul
    echo       Port should be free now.
) else (
    echo       Port 3000 is free.
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
curl -s http://localhost:8050/api/webhook/health >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo       Spring Boot API is running.
) else (
    echo       WARNING: Spring Boot API might not be running on http://localhost:8050
    echo       Make sure Spring Boot application is started.
)
echo.

REM Запуск сервиса
echo [5/5] Starting WhatsApp Service...
echo.
echo ================================================
echo   Service will start in a new window.
echo   Web interface: http://localhost:3000
echo   Make sure Spring Boot is running on port 8050
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


