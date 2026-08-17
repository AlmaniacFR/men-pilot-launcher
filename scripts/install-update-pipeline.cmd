@echo off
setlocal EnableExtensions
title MEN Pilot Launcher - Installation du pipeline GitHub

echo.
echo ============================================================
echo   MEN Pilot Launcher - Pipeline GitHub (depot standalone)
echo ============================================================
echo.

for %%I in ("%~dp0..") do set "LAUNCHER=%%~fI"

echo [INFO] Dossier source du launcher :
echo        %LAUNCHER%
echo.

where git >nul 2>nul
if errorlevel 1 (
    echo [ERREUR] Git est introuvable dans le PATH Windows.
    echo.
    echo Teste d'abord :
    echo     git --version
    echo.
    pause
    exit /b 1
)

if not exist "%LAUNCHER%\package.json" (
    echo [ERREUR] package.json introuvable dans :
    echo          %LAUNCHER%
    echo.
    echo Ce script doit etre place dans :
    echo     D:\Workspaces\men-pilot-launcher\scripts
    echo.
    pause
    exit /b 1
)

if not exist "%LAUNCHER%\.git" (
    echo [INFO] Aucun depot Git detecte.
    echo [INFO] Initialisation d'un depot Git standalone...
    git -C "%LAUNCHER%" init
    if errorlevel 1 (
        echo.
        echo [ERREUR] git init a echoue.
        pause
        exit /b 1
    )
) else (
    echo [OK] Depot Git local deja initialise.
)

set "REPO_RAW="
for /f "usebackq delims=" %%I in (`git -C "%LAUNCHER%" rev-parse --show-toplevel 2^>nul`) do set "REPO_RAW=%%I"

if not defined REPO_RAW (
    echo [ERREUR] Impossible de determiner la racine Git.
    pause
    exit /b 1
)

REM Git for Windows renvoie souvent D:/chemin/alors que CMD travaille avec D:\chemin.
REM On normalise explicitement les slashs puis le chemin absolu avant comparaison.
set "REPO_WIN=%REPO_RAW:/=\%"
for %%I in ("%REPO_WIN%") do set "REPO=%%~fI"
for %%I in ("%LAUNCHER%") do set "LAUNCHER_NORM=%%~fI"

echo [OK] Depot Git :
echo      %REPO%
echo.

if /I not "%REPO%"=="%LAUNCHER_NORM%" (
    echo [ERREUR] Le depot Git detecte n'est pas le dossier standalone attendu.
    echo.
    echo Depot detecte :
    echo   %REPO%
    echo.
    echo Dossier launcher :
    echo   %LAUNCHER_NORM%
    echo.
    echo Pour ton architecture, ces deux chemins doivent etre identiques.
    pause
    exit /b 1
)

set "SOURCE=%LAUNCHER%\templates\men-pilot-launcher-release.yml"
set "TARGET_DIR=%LAUNCHER%\.github\workflows"
set "TARGET=%TARGET_DIR%\men-pilot-launcher-release.yml"

if not exist "%SOURCE%" (
    echo [ERREUR] Template introuvable :
    echo          %SOURCE%
    echo.
    echo Copie aussi le nouveau fichier :
    echo     templates\men-pilot-launcher-release.yml
    echo.
    pause
    exit /b 1
)

if not exist "%TARGET_DIR%" (
    echo [INFO] Creation du dossier GitHub Actions...
    mkdir "%TARGET_DIR%"
    if errorlevel 1 (
        echo [ERREUR] Impossible de creer :
        echo          %TARGET_DIR%
        pause
        exit /b 1
    )
) else (
    echo [OK] Dossier GitHub Actions deja present.
)

echo [INFO] Installation du workflow...
copy /Y "%SOURCE%" "%TARGET%" >nul
if errorlevel 1 (
    echo [ERREUR] Impossible de copier le workflow.
    pause
    exit /b 1
)

if not exist "%TARGET%" (
    echo [ERREUR] Le workflow n'existe pas apres la copie :
    echo          %TARGET%
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   PIPELINE INSTALLE
echo ============================================================
echo.
echo Workflow :
echo   %TARGET%
echo.
echo Depot source standalone :
echo   %LAUNCHER%
echo.
echo Verification recommandee :
echo.
echo   cd /d "%LAUNCHER%"
echo   git status
echo.
echo Tu dois voir notamment :
echo   .github/workflows/men-pilot-launcher-release.yml
echo.
echo Ensuite :
echo.
echo   git branch -M main
echo   git add .
echo   git commit -m "Initial MEN Pilot Launcher 2.0.0"
echo.
echo IMPORTANT :
echo Il restera ensuite a relier ce depot local a un depot GitHub distant
echo pour pouvoir publier et distribuer les futures mises a jour.
echo.
pause
exit /b 0
