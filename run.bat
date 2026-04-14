@echo off
title Blackpot
echo ============================================
echo        Starting Blackpot
echo ============================================
echo.

set "BASEDIR=%~dp0"

echo [1/2] Starting Backend (FastAPI on port 8000)...
start "Blackpot Backend" /D "%BASEDIR%backend" cmd /k python main.py

echo [2/2] Starting Frontend (Vite on port 5173)...
start "Blackpot Frontend" /D "%BASEDIR%frontend" cmd /k npm run dev

echo.
echo Waiting for servers to start...
timeout /t 10 /nobreak >nul

echo Opening browser...
start "" "http://localhost:5173"

echo.
echo ============================================
echo  Both servers are running in separate windows.
echo  Close those windows to stop the servers.
echo ============================================
echo.
pause
