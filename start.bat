@echo off
title Claude History Viewer - Server (close this window to stop)
cd /d "%~dp0"
start "Claude History Viewer - Server" cmd /k node server.js
timeout /t 2 /nobreak >nul
start "" "http://localhost:4173"
exit
