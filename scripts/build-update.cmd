@echo off
setlocal
cd /d "%~dp0\.."
if not exist node_modules (
  call npm install
  if errorlevel 1 exit /b 1
)
call npm run dist
if errorlevel 1 (
  echo [ERREUR] Build impossible.
  pause
  exit /b 1
)
echo.
echo Build termine. Les fichiers de mise a jour sont dans dist\
echo Uploadez l'EXE, le blockmap et latest.yml sur votre serveur generique,
echo ou utilisez GitHub Actions pour une publication automatique.
pause
