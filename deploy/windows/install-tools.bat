@echo off
title SignageCMS - Installation outils de conversion (LibreOffice + Poppler)
REM ============================================================
REM  SignageCMS - Installe LibreOffice et Poppler automatiquement
REM  (telechargement direct, sans winget ni chocolatey)
REM
REM  Requis pour lire les PowerPoint et PDF sur les ecrans :
REM    PPT/PPTX -> LibreOffice -> PDF -> Poppler -> images PNG
REM
REM  Usage : clic droit -> Executer en tant qu'administrateur
REM  Journal : deploy\windows\install-tools.log
REM ============================================================
cd /d "%~dp0"
echo ================================================
echo   SignageCMS - Outils de conversion PowerPoint/PDF
echo   LibreOffice + Poppler seront telecharges et installes
echo   (LibreOffice ~ 350 Mo, comptez 3 a 8 minutes)
echo ================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-tools.ps1"
