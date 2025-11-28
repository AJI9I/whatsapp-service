@echo off
chcp 65001 >nul
echo ========================================
echo Пересборка и перезапуск WhatsApp Service
echo ========================================
echo.

REM Переходим в директорию скрипта
cd /d "%~dp0"

REM Простая проверка и остановка процессов по порту 3000 (WhatsApp использует порт 3000)
echo Проверка запущенных процессов WhatsApp Service...
netstat -ano | findstr ":3000" >nul
if %errorlevel% == 0 (
    echo Найден процесс на порту 3000, остановка...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
        echo Остановка процесса с PID: %%a
        taskkill /F /PID %%a >nul 2>&1
    )
    timeout /t 2 /nobreak >nul
    echo Процесс остановлен
) else (
    echo WhatsApp Service не запущен
)

echo.
echo Проверка зависимостей...
if not exist "node_modules" (
    echo Установка зависимостей...
    call npm install
    if errorlevel 1 (
        echo ERROR: Установка зависимостей не удалась!
        pause
        exit /b 1
    )
) else (
    echo Зависимости установлены
)

echo.
echo Запуск WhatsApp Service...
cd /d "%~dp0"
start "WhatsApp Service - Логи" /D "%~dp0" cmd /k "npm start"

echo.
echo ========================================
echo WhatsApp Service запущен!
echo ========================================
echo.
echo Веб-интерфейс: http://localhost:3000
echo Логи выводятся в отдельном окне CMD
echo.
