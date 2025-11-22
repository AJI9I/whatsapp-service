@echo off
cd /d %~dp0
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul
start "WhatsApp Service" cmd /k "title WhatsApp Service && cd /d %~dp0 && npm start"


