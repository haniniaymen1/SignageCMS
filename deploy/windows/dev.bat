@echo off
setlocal
title SignageCMS - Developpement
REM ============================================================
REM  SignageCMS - Mode developpement (rechargement a chaud)
REM  Reserve aux tests : en production utilisez start-cms.bat
REM ============================================================
cd /d "%~dp0..\.."
if not exist ".env" (
  echo [ERREUR] Fichier .env absent - lancez d'abord deploy\windows\install.bat
  pause
  exit /b 1
)
set NODE_ENV=development
npx next dev -p 3000
pause
