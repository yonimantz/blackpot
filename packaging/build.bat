@echo off
setlocal
title Build SpotOn

set "REPO=%~dp0.."

echo ============================================
echo  Building SpotOn
echo ============================================
echo.

echo [1/3] Building the frontend...
pushd "%REPO%\frontend"
call npm run build || goto :failed
popd

echo.
echo [2/3] Packaging the backend and UI...
pushd "%~dp0"
python -m PyInstaller --noconfirm --clean ^
  --workpath "%~dp0build" ^
  --distpath "%~dp0dist" ^
  spoton.spec || goto :failed
popd

echo.
echo [3/3] Building the installer...
set "ISCC="
for %%C in (
  "%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe"
  "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
  "%ProgramFiles%\Inno Setup 6\ISCC.exe"
) do if not defined ISCC if exist %%C set "ISCC=%%~C"

if not defined ISCC (
  echo.
  echo Skipped: Inno Setup not found. The app in packaging\dist\SpotOn is ready
  echo to run, but no installer was produced. Install Inno Setup with:
  echo     winget install --id JRSoftware.InnoSetup
  echo.
  echo ============================================
  echo  Done: packaging\dist\SpotOn\SpotOn.exe
  echo ============================================
  exit /b 0
)

pushd "%~dp0"
"%ISCC%" spoton.iss || goto :failed
popd

echo.
echo ============================================
echo  Done: packaging\SpotOn-Setup.exe
echo ============================================
exit /b 0

:failed
echo.
echo BUILD FAILED
exit /b 1
