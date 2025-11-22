@echo off
chcp 65001 >nul
title WhatsApp Service - Launch
cd /d %~dp0

echo ================================================
echo   WhatsApp Service - Launch
echo ================================================
echo.

REM Остановка старых процессов
echo [1/3] Остановка старых процессов...
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul
echo       Готово
echo.

REM Проверка Node.js
echo [2/3] Проверка Node.js...
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo       ОШИБКА: Node.js не установлен!
    echo       Установите Node.js с https://nodejs.org/
    echo.
    pause
    exit /b 1
)
echo       Node.js найден
echo.

REM Запуск
echo [3/3] Запуск WhatsApp Service...
echo.
echo       Веб-интерфейс: http://localhost:3000
echo       Окно с логами откроется автоматически
echo.
start "WhatsApp Service" cmd /k "title WhatsApp Service && chcp 65001 >nul && cd /d %~dp0 && npm start"
timeout /t 3 /nobreak >nul

echo ================================================
echo   WhatsApp Service запускается...
echo   Проверьте новое окно с логами
echo   Веб-интерфейс: http://localhost:3000
echo ================================================
echo.


