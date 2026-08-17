@echo off
setlocal
cd /d "%~dp0\.."
echo.
echo ==========================================
echo   MEN Pilot Launcher - installation
echo ==========================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] Node.js est introuvable dans le PATH.
  pause
  exit /b 1
)

call npm install
if errorlevel 1 (
  echo.
  echo [ERREUR] npm install a echoue.
  pause
  exit /b 1
)

echo.
echo Installation terminee.
echo Lancez scripts\start.cmd
pause
