@echo off
setlocal
cd /d "%~dp0\.."
if not exist node_modules (
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
call npm run dist
if errorlevel 1 (
  echo.
  echo [ERREUR] La construction de l'installateur a echoue.
  pause
  exit /b 1
)
echo.
echo Installateur disponible dans dist\
pause
