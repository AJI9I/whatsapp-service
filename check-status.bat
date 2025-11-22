@echo off
echo Checking WhatsApp Service Status...
echo.
tasklist /FI "IMAGENAME eq node.exe" 2>nul | find /I "node.exe" >nul
if %ERRORLEVEL% EQU 0 (
    echo [OK] Node.js process is running
    echo.
    echo Checking web interface...
    curl -s http://localhost:3000/api/status >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        echo [OK] Web interface is accessible at http://localhost:3000
    ) else (
        echo [WARN] Web interface might not be ready yet
    )
) else (
    echo [ERROR] Node.js process is NOT running
    echo.
    echo To start the service, run: START-NOW.bat
)
echo.
pause


