@echo off
chcp 65001 >nul
REM Скрипт для выполнения миграции базы данных WhatsApp Service
REM Добавляет колонку duplicate_count в таблицу whatsapp_messages

echo ========================================
echo Выполнение миграции базы данных WhatsApp Service
echo ========================================
echo.
echo Миграция: Добавление колонки duplicate_count в таблицу whatsapp_messages
echo.

REM Параметры подключения к базе данных (значения по умолчанию)
set DB_HOST=localhost
set DB_PORT=5432
set DB_NAME=whatsapp_service
set DB_USER=postgres
set DB_PASSWORD=vasagaroot

REM Проверяем переменные окружения
if not "%DB_HOST%"=="" set DB_HOST=%DB_HOST%
if not "%DB_PORT%"=="" set DB_PORT=%DB_PORT%
if not "%DB_NAME%"=="" set DB_NAME=%DB_NAME%
if not "%DB_USER%"=="" set DB_USER=%DB_USER%
if not "%DB_PASSWORD%"=="" set DB_PASSWORD=%DB_PASSWORD%

echo Параметры подключения:
echo   Host: %DB_HOST%
echo   Port: %DB_PORT%
echo   Database: %DB_NAME%
echo   User: %DB_USER%
echo.

REM Устанавливаем переменную окружения для пароля psql
set PGPASSWORD=%DB_PASSWORD%

REM Выполняем SQL через psql
echo Выполнение миграции через psql...
psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% -f migrations\add_duplicate_count_column.sql
if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo Миграция успешно выполнена!
    echo ========================================
    goto :end
)

REM Если psql недоступен или произошла ошибка
echo.
echo ========================================
echo ВНИМАНИЕ: psql не найден или произошла ошибка
echo ========================================
echo.
echo Пожалуйста, выполните SQL вручную через любой PostgreSQL клиент:
echo.
echo 1. Подключитесь к базе данных:
echo    psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME%
echo.
echo 2. Выполните SQL из файла migrations\add_duplicate_count_column.sql:
echo.
type migrations\add_duplicate_count_column.sql

:end
echo.
pause


