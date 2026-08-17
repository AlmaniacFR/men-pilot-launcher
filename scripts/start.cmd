@echo off
setlocal
cd /d "%~dp0\.."
if not exist node_modules (
  echo Les dependances ne sont pas installees.
  echo Lancement de npm install...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
call npm start
