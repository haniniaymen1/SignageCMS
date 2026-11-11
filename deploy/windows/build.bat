@echo off
setlocal enabledelayedexpansion
title SignageCMS - Build production
REM ============================================================
REM  SignageCMS - Build production (v3.11 - remplace build.ps1)
REM  Compile Next.js et prepare le dossier standalone deployable.
REM
REM  Usage :
REM    - double-clic sur ce fichier
REM    - ou depuis une console : deploy\windows\build.bat
REM    - appele automatiquement par install.bat (--from-install)
REM
REM  Journal : deploy\windows\build-cms.log
REM  Fonctionne depuis un chemin contenant des espaces ou parentheses.
REM ============================================================
cd /d "%~dp0..\.."
set "ROOT=%CD%"
set "LOG=%~dp0build-cms.log"
set ERRORS=0
set "INTERACTIVE=1"
if "%~1"=="--from-install" set "INTERACTIVE=0"

if "%INTERACTIVE%"=="1" (
  echo [%DATE% %TIME%] === Build SignageCMS === > "!LOG!"
  echo ================================================
  echo   SignageCMS - Build production
  echo   Dossier : !ROOT!
  echo ================================================
) else (
  echo [%DATE% %TIME%] === Build SignageCMS ^(depuis install.bat^) === >> "!LOG!"
)

REM ---------- 1) Pre-requis : .env ----------
if exist ".env" goto env_ok
echo [ECHEC] Fichier .env absent a la racine du projet.
echo         Lancez d'abord : deploy\windows\install.bat
set ERRORS=1
goto :fin
:env_ok

REM ---------- 2) Pre-requis : Node.js ----------
where node >nul 2>nul || goto no_node
where npx >nul 2>nul || goto no_node
for /f "delims=" %%v in ('node -v 2^>nul') do set "NODEV=%%v"
echo [OK] Node.js !NODEV!
goto node_done
:no_node
echo [ECHEC] Node.js introuvable. Installez Node.js 20 LTS ou 22 LTS : https://nodejs.org
set ERRORS=1
goto :fin
:node_done

REM ---------- 3) Compilation ----------
echo [INFO] Compilation Next.js en cours (2 a 6 minutes)...
call npx next build >>"!LOG!" 2>&1
if errorlevel 1 (
  echo [ECHEC] La compilation a echoue - voir le journal : !LOG!
  set ERRORS=1
  goto :fin
)
echo [OK] Compilation terminee

REM ---------- 4) Preparation du dossier standalone ----------
echo [INFO] Copie des assets statiques (standalone)...
call node scripts\copy-standalone.js >>"!LOG!" 2>&1
if errorlevel 1 (
  echo [ECHEC] Echec de la copie standalone - voir le journal : !LOG!
  set ERRORS=1
  goto :fin
)
if not exist ".next\standalone\server.js" (
  echo [ECHEC] server.js introuvable dans .next\standalone - build incomplet.
  set ERRORS=1
  goto :fin
)
echo [OK] Build standalone pret : .next\standalone\server.js

:fin
echo.
if "%ERRORS%"=="0" (
  if "%INTERACTIVE%"=="1" (
    echo ================================================
    echo   BUILD TERMINE AVEC SUCCES
    echo   Demarrage : deploy\windows\start-cms.bat
    echo   Interface : http://localhost:3000
    echo ================================================
  ) else (
    echo [%DATE% %TIME%] Build OK >> "!LOG!"
  )
) else (
  if "%INTERACTIVE%"=="1" (
    echo ================================================
    echo   BUILD INTERROMPU - corrigez l'erreur ci-dessus puis relancez.
    echo   Journal detaille : !LOG!
    echo ================================================
  ) else (
    echo [%DATE% %TIME%] Build en echec >> "!LOG!"
  )
)
if "%INTERACTIVE%"=="1" pause
exit /b %ERRORS%
