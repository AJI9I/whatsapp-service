@echo off
chcp 65001 >nul
cd /d %~dp0

REM Остановка старых процессов
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul

REM Проверка Node.js
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed!
    pause
    exit /b 1
)

REM Проверка зависимостей
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
)

REM Запуск
echo Starting WhatsApp Service...
start "WhatsApp Service" cmd /k "title WhatsApp Service && chcp 65001 >nul && cd /d %~dp0 && npm start"
timeout /t 2 /nobreak >nul

echo.
echo WhatsApp Service is starting...
echo Web interface: http://localhost:3000
echo.
pause


