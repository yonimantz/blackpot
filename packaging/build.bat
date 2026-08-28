@echo off
setlocal
title Build SpotOn

set "REPO=%~dp0.."

echo ============================================
echo  Building SpotOn
echo ============================================
echo.

echo [1/4] Checking the version...
for /f "delims=" %%v in ('python -c "import sys; sys.path.insert(0, r'%REPO%\backend'); from version import __version__; print(__version__)"') do set "APP_VERSION=%%v"
if not defined APP_VERSION (
  echo Could not read backend\version.py. Is Python on PATH?
  goto :failed
)
for /f "delims=" %%v in ('python -c "import json; print(json.load(open(r'%REPO%\frontend\package.json'))['version'])"') do set "PKG_VERSION=%%v"
if not "%APP_VERSION%"=="%PKG_VERSION%" (
  echo.
  echo Version mismatch: backend\version.py says %APP_VERSION%, frontend\package.json
  echo says %PKG_VERSION%. Bump both to the same version before building - that
  echo mismatch is exactly what used to make the shipped version unknowable.
  goto :failed
)
echo Building version %APP_VERSION%.

echo.
echo [2/4] Building the frontend...
pushd "%REPO%\frontend"
call npm run build || goto :failed
popd

echo.
echo [3/4] Packaging the backend and UI...
pushd "%~dp0"
python -m PyInstaller --noconfirm --clean ^
  --workpath "%~dp0build" ^
  --distpath "%~dp0dist" ^
  spoton.spec || goto :failed
popd

echo.
echo [4/4] Building the installer...
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
"%ISCC%" /DMyAppVersion="%APP_VERSION%" spoton.iss || goto :failed
popd

echo.
echo ============================================
echo  Done: packaging\SpotOn-Setup.exe (v%APP_VERSION%)
echo ============================================
exit /b 0

:failed
echo.
echo BUILD FAILED
exit /b 1
