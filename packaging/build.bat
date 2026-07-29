@echo off
setlocal
title Build SpotOn

set "REPO=%~dp0.."

echo ============================================
echo  Building SpotOn
echo ============================================
echo.

echo [1/2] Building the frontend...
pushd "%REPO%\frontend"
call npm run build || goto :failed
popd

echo.
echo [2/2] Packaging the backend and UI...
pushd "%~dp0"
python -m PyInstaller --noconfirm --clean ^
  --workpath "%~dp0build" ^
  --distpath "%~dp0dist" ^
  spoton.spec || goto :failed
popd

echo.
echo ============================================
echo  Done: packaging\dist\SpotOn\SpotOn.exe
echo ============================================
exit /b 0

:failed
echo.
echo BUILD FAILED
exit /b 1
