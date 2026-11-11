@echo off
setlocal enabledelayedexpansion
title SignageCMS - Installation
REM ============================================================
REM  SignageCMS - Installation complete en un seul script
REM  (v3.11 - remplace install-cms.bat)
REM
REM  Ce script :
REM    1. verifie Node.js (20 LTS ou 22 LTS requis)
REM    2. cree le fichier .env avec le bon chemin de base de donnees
REM    3. installe les dependances (npm install)
REM    4. prepare la base SQLite (Prisma)
REM    5. compile la version production (appel de build.bat)
REM
REM  Usage : double-clic, ou depuis une console :
REM          deploy\windows\install.bat
REM  Journal : deploy\windows\install-cms.log
REM  Fonctionne depuis un chemin contenant des espaces ou parentheses.
REM ============================================================
cd /d "%~dp0..\.."
set "ROOT=%CD%"
set "WIN=%~dp0"
set "LOG=%~dp0install-cms.log"
set ERRORS=0

echo [%DATE% %TIME%] === Installation SignageCMS v3.11 === > "!LOG!"

echo ================================================
echo   SignageCMS v3.11 - Installation automatique
echo   Dossier : !ROOT!
echo ================================================
echo.

REM ---------- 1) Verification de Node.js et npm ----------
set "NODE_OK="
where node >nul 2>nul && set NODE_OK=1
where npm >nul 2>nul || set NODE_OK=
if not defined NODE_OK goto no_node
set "NODEV="
for /f "delims=" %%v in ('node -v 2^>nul') do set "NODEV=%%v"
set "NODEV=%NODEV:~1%"
set "MAJOR="
for /f "tokens=1 delims=." %%a in ("%NODEV%") do set "MAJOR=%%a"
if "%MAJOR%"=="" set "MAJOR=0"
echo [OK] Node.js v%NODEV% detecte
echo [%DATE% %TIME%] Node.js v%NODEV% >> "!LOG%"
if %MAJOR% GEQ 20 goto node_ok
echo [ATTENTION] Next.js 16 exige Node.js 20.9 ou plus recent.
echo             Version detectee : v%NODEV%
echo             L'installation continue, mais le build peut echouer.
echo             Installez Node.js 20 LTS ou 22 LTS : https://nodejs.org
echo.
goto node_ok
:no_node
echo [ECHEC] Node.js ou npm est introuvable.
echo         Installez Node.js 20 LTS ou 22 LTS : https://nodejs.org
echo         (options par defaut suffisent), puis relancez ce script.
set ERRORS=1
goto :fin
:node_ok

REM ---------- 2) Fichier .env (chemin de base calcule depuis le dossier reel) ----------
if exist ".env" goto env_ok
if not exist "db" mkdir "db"
set "DBURL=file:%ROOT:\=/%/db/custom.db"
>".env" echo DATABASE_URL=%DBURL%
if errorlevel 1 goto env_fail
echo [OK] Fichier .env cree : %DBURL%
goto env_done
:env_ok
echo [OK] Fichier .env deja present
goto env_done
:env_fail
echo [ECHEC] Impossible de creer .env (droits insuffisants ?)
set ERRORS=1
goto :fin
:env_done

REM ---------- 3) Dependances ----------
echo [INFO] Installation des dependances (5 a 10 minutes)...
call npm install --no-audit --no-fund >>"!LOG!" 2>&1
if errorlevel 1 (
  echo [ECHEC] npm install a echoue - voir le journal : !LOG!
  set ERRORS=1
  goto :fin
)
echo [OK] Dependances installees

REM ---------- 4) Base de donnees + client Prisma ----------
echo [INFO] Preparation de la base de donnees (Prisma)...
call npx prisma generate >>"!LOG!" 2>&1
if errorlevel 1 (
  echo [ECHEC] prisma generate a echoue - voir le journal : !LOG!
  set ERRORS=1
  goto :fin
)
call npx prisma db push >>"!LOG!" 2>&1
if errorlevel 1 (
  echo [ECHEC] Initialisation de la base impossible - voir le journal : !LOG!
  set ERRORS=1
  goto :fin
)
echo [OK] Base de donnees prete (db\custom.db)

REM ---------- 5) Compilation production (build.bat) ----------
echo [INFO] Compilation de la version production (2 a 6 minutes)...
call "%WIN%build.bat" --from-install
if errorlevel 1 (
  echo [ECHEC] La construction a echoue - voir les journaux :
  echo         !LOG!
  echo         !WIN!build-cms.log
  set ERRORS=1
  goto :fin
)
echo [OK] Construction terminee

REM ---------- 6) LibreOffice / Poppler (conversion PPT/PDF) ----------
REM v3.11.9 - telechargement + installation automatiques integres : MSI officiel
REM TDF (~360 Mo, multi-sources + reprise via curl.exe) et ZIP Poppler GitHub.
REM Definir SKIP_TOOLS=1 avant de lancer install.bat pour ignorer cette etape.
if defined SKIP_TOOLS (
  echo [INFO] SKIP_TOOLS defini - etape LibreOffice/Poppler ignoree.
  goto tools_done
)
set "LO_PRESENT="
set "PP_PRESENT="
if defined SOFFICE_PATH if exist "!SOFFICE_PATH!" set "LO_PRESENT=1"
if exist "C:\Program Files\LibreOffice\program\soffice.exe" set "LO_PRESENT=1"
if exist "C:\Program Files (x86)\LibreOffice\program\soffice.exe" set "LO_PRESENT=1"
if exist "C:\poppler\Library\bin\pdftoppm.exe" set "PP_PRESENT=1"
if exist "C:\Program Files\poppler\Library\bin\pdftoppm.exe" set "PP_PRESENT=1"
if defined LO_PRESENT if defined PP_PRESENT (
  echo [OK] LibreOffice et Poppler deja installes - conversion PPT/PDF activee.
  goto tools_done
)
if not defined LO_PRESENT (
  echo [..] LibreOffice absent - telechargement officiel TDF ^(~360 Mo^), 5 a 20 min...
) else (
  echo [..] LibreOffice deja present - Poppler absent, telechargement officiel 1 a 3 min...
)
echo        Definir SKIP_TOOLS=1 pour passer cette etape ; le CMS fonctionne
echo        aussi sans ces outils ^(seuls PowerPoint et PDF ne s'afficheront pas^).
powershell -NoProfile -ExecutionPolicy Bypass -File "!WIN!install-tools.ps1" -Silent
if errorlevel 2 (
  echo [INFO] Droits administrateur requis pour l'installation automatique.
  echo        Plus tard : clic droit sur deploy\windows\install-tools.bat
  echo        puis "Executer en tant qu'administrateur".
) else if errorlevel 1 (
  echo [ATTENTION] Installation des outils incomplete - journal :
  echo             !WIN!install-tools.log
  echo             Relancez install-tools.bat en administrateur, ou relancez
  echo             install.bat : les outils deja installes ne sont pas retouchees
  echo             et le telechargement reprend automatiquement.
) else (
  echo [%DATE% %TIME%] Outils de conversion installes via install-tools.ps1 >> "!LOG!"
  echo [OK] Outils de conversion prets - conversion PPT/PDF activee.
)
:tools_done

:fin
echo.
if "%ERRORS%"=="0" (
  echo ================================================
  echo   INSTALLATION TERMINEE AVEC SUCCES
  echo.
  echo   Pour demarrer le serveur : deploy\windows\start-cms.bat
  echo   Interface : http://localhost:3000
  echo.
  echo   Premiere connexion : utilisateur admin
  echo   Le mot de passe initial est affiche dans la console du serveur
  echo   et enregistre dans db\admin-credentials.txt
  echo   (changez-le puis supprimez ce fichier).
  echo.
  echo   Reseau : deploy\windows\firewall.ps1         (ouvre le port 3000)
  echo   Auto-demarrage : deploy\windows\install-service.ps1
  echo ================================================
  echo [%DATE% %TIME%] Installation OK >> "!LOG!"
) else (
  echo ================================================
  echo   INSTALLATION INTERROMPUE - corrigez l'erreur ci-dessus puis relancez.
  echo   Journal detaille : !LOG!
  echo ================================================
  echo [%DATE% %TIME%] Installation en echec >> "!LOG!"
)
pause
exit /b %ERRORS%
