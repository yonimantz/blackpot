@echo off
setlocal enabledelayedexpansion
title SpotOn
echo ============================================
echo        Starting SpotOn
echo ============================================
echo.

set "BASEDIR=%~dp0"

REM The Vite dev proxy sends /api to a hardcoded localhost:8000, but the backend
REM picks the next free port when 8000 is taken. A leftover server from an older
REM run therefore keeps answering the UI with stale code while the new backend
REM sits unused on 8001. Stop instead, so the mismatch is never silent.
set "BUSY="
for %%P in (8000 5173) do (
    netstat -ano -p tcp | findstr /c:":%%P " | findstr /c:"LISTENING" >nul && set "BUSY=!BUSY! %%P"
)
if defined BUSY goto :busy

echo [1/2] Starting Backend (FastAPI on port 8000)...
start "SpotOn Backend" /D "%BASEDIR%backend" cmd /k python main.py

echo [2/2] Starting Frontend (Vite on port 5173)...
start "SpotOn Frontend" /D "%BASEDIR%frontend" cmd /k npm run dev

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
exit /b 0

:busy
echo ERROR: port!BUSY! already in use - SpotOn is probably still running.
echo.
echo Close the old "SpotOn Backend" and "SpotOn Frontend" windows, then try
echo again. To stop the leftover processes by hand, run:
echo.
for %%P in (!BUSY!) do (
    for /f "tokens=5" %%I in ('netstat -ano -p tcp ^| findstr /c:":%%P " ^| findstr /c:"LISTENING"') do echo     taskkill /PID %%I /F     [port %%P]
)
echo.
pause
exit /b 1
