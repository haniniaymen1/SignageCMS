@echo off
setlocal
title SignageCMS - Reinitialisation du mot de passe administrateur
REM ============================================================
REM  SignageCMS (v3.11.24) - Reinitialisation du compte admin
REM  Usage : double-clic ou execution depuis une console.
REM  Effet : supprime le compte admin de la base puis le recree
REM  IMMEDIATEMENT (scripts\ensure-admin.mjs) avec un mot de
REM  passe ALEATOIRE affiche ici et ecrit dans
REM  db\admin-credentials.txt. Aucun redemarrage ni essai de
REM  connexion a l'aveugle n'est requis.
REM  Conseil : sauvegardez db\custom.db avant d'executer.
REM ============================================================
cd /d "%~dp0..\.."

if not exist "prisma\schema.prisma" (
  echo [ERREUR] prisma\schema.prisma introuvable - placez ce script dans deploy\windows du projet.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo [ERREUR] node_modules absent - lancez d'abord install.bat (ou npm install).
  pause
  exit /b 1
)

echo Ce script reinitialise le compte admin de la base (db\custom.db).
echo Un NOUVEAU mot de passe aleatoire sera affiche ici et ecrit dans
echo db\admin-credentials.txt. Aucun redemarrage n'est requis.
echo.
set /p CONFIRM=Taper OUI pour continuer : 
if /I not "%CONFIRM%"=="OUI" (
  echo Annule.
  pause
  exit /b 0
)

echo DELETE FROM User WHERE username='admin'; | npx prisma db execute --schema prisma\schema.prisma --stdin
if errorlevel 1 (
  echo [ERREUR] Suppression echouee - verifiez le fichier .env et la base.
  pause
  exit /b 1
)

echo.
REM v3.11.24 : recreation immediatee (plus d'essai de connexion a l'aveugle).
if exist "scripts\ensure-admin.mjs" (
  call node scripts\ensure-admin.mjs
  if not errorlevel 1 (
    echo.
    echo Reinitialisation terminee. Connectez-vous avec le mot de passe affiche
    echo ci-dessus, changez-le (menu Utilisateurs), puis supprimez
    echo db\admin-credentials.txt.
    pause
    exit /b 0
  )
  echo [!] Recreation automatique echouee - suivez les etapes ci-dessous.
)

echo Compte admin supprime. Etapes suivantes (mode degrade) :
echo   1. Redemarrez le serveur (start-cms.bat, ou nssm restart SignageCMS).
echo   2. Ouvrez la page de connexion, tapez admin et un mot de passe quelconque,
echo      puis validez : le nouveau mot de passe apparait dans la console du
echo      serveur et dans db\admin-credentials.txt.
echo   3. Connectez-vous avec ce mot de passe, changez-le (menu Utilisateurs),
echo      puis supprimez db\admin-credentials.txt.
pause
