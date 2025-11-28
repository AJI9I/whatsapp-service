@echo off
chcp 65001 >nul
cd /d %~dp0
echo.
echo ================================================
echo   WhatsApp Service - Starting
echo ================================================
echo.

REM Остановка процесса на порту 3000
echo [1/2] Checking port 3000...
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
REM Остановка всех процессов Node.js
tasklist /FI "IMAGENAME eq node.exe" 2>nul | find /I "node.exe" >nul
if %ERRORLEVEL% EQU 0 (
    echo       Stopping all Node.js processes...
    taskkill /F /IM node.exe >nul 2>&1
    timeout /t 2 /nobreak >nul
    echo       Node.js processes stopped.
)
echo.

REM Запуск сервиса
echo [2/2] Starting WhatsApp Service...
echo       Web interface: http://localhost:3000
echo.
start "WhatsApp Service" cmd /k "title WhatsApp Service && chcp 65001 >nul && cd /d %~dp0 && npm start"
timeout /t 3 /nobreak >nul
echo.
echo ================================================
echo   WhatsApp Service is starting...
echo   Check the new window for startup logs.
echo ================================================
echo.
pause


