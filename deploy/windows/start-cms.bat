@echo off
setlocal
title SignageCMS - Serveur
REM ============================================================
REM  SignageCMS - Demarrage production (v3.11)
REM  Double-cliquez ce fichier ou lancez-le depuis le service Windows
REM ============================================================
cd /d "%~dp0..\.."

if not exist ".env" (
  echo [ERREUR] Fichier .env absent - lancez d'abord deploy\windows\install.bat
  pause
  exit /b 1
)
if not exist ".next\standalone\server.js" (
  echo [ERREUR] Build absent - lancez d'abord deploy\windows\build.bat
  pause
  exit /b 1
)

set NODE_ENV=production
REM Port surchargeable : set PORT=8080 avant de lancer ce script
if not defined PORT set PORT=3000
REM Ecoute sur toutes les interfaces : indispensable pour l'acces depuis les ecrans du reseau
set HOSTNAME=0.0.0.0

REM Binaires externes pour la conversion PPT/PDF en diapositives (inoffensif si absents)
if exist "C:\poppler\Library\bin" set "PATH=%PATH%;C:\poppler\Library\bin"
if exist "C:\Program Files\LibreOffice\program" set "PATH=%PATH%;C:\Program Files\LibreOffice\program"

echo ================================================
echo   SignageCMS - http://localhost:%PORT%
echo   Interface CMS : http://localhost:%PORT%/
echo   Lecteur ecran : http://localhost:%PORT%/player
echo   Reseau        : http://ADRESSE-IP-DU-SERVEUR:%PORT%/  (ipconfig pour l'adresse)
echo   Arreter le serveur : CTRL+C
echo ================================================
node .next\standalone\server.js
pause
