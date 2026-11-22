@echo off
setlocal EnableExtensions
REM ============================================================
REM  SignageCMS - Arret du serveur (v3.11.26)
REM  Arret PROPRE : sans fenetre enoncee par l'utilisateur,
REM  sans confirmation, sans pause - exit silencieux.
REM  Double-clic, ou stop-cms-silent.vbs pour zero fenetre.
REM  Ordre : 1 server.pid, 2 port du .env, 3 recherche node.exe.
REM ============================================================
cd /d "%~dp0..\.."
set "LOG=%CD%\service.log"
set "PIDFILE=%CD%\server.pid"
set "TS=%DATE% %TIME%"
REM ---------- port : fichier .env puis 3000 (v3.11.26 : parseur durci) ----------
set "PORT=3000"
if exist ".env" for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%CD%\.env") do call :env_port "%%~a" "%%~b"
echo [%TS%] stop-cms.bat lance >> "%LOG%"
set "STOPPED="
if exist "%PIDFILE%" goto by_pid
goto by_port
:by_pid
set /p PID=<"%PIDFILE%" 2>nul
if not defined PID goto by_port
tasklist /FI "PID eq %PID%" 2>nul | find /I "node.exe" >nul || goto by_port
taskkill /PID %PID% /T >nul 2>&1
ping -n 4 127.0.0.1 >nul
tasklist /FI "PID eq %PID%" 2>nul | find /I "node.exe" >nul && taskkill /F /T /PID %PID% >nul 2>&1
set STOPPED=1
echo [%TS%] Serveur arrete (pid %PID%) >> "%LOG%"
goto fin
:by_port
for /f "tokens=5" %%q in ('netstat -aon -p TCP 2^>nul ^| findstr /C:":%PORT% " ^| findstr /I "LISTENING"') do call :kill_node_port %%q
if defined STOPPED goto fin
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server-process.ps1" -Stop >nul 2>&1 && (
  set STOPPED=1
  echo [%TS%] Serveur arrete (recherche node.exe) >> "%LOG%"
)
goto fin
:kill_node_port
tasklist /FI "PID eq %1" 2>nul | find /I "node.exe" >nul || goto :eof
taskkill /F /T /PID %1 >nul 2>&1
set STOPPED=1
echo [%TS%] Serveur arrete (pid %1, port %PORT%) >> "%LOG%"
goto :eof
:fin
if defined STOPPED (
  del /q "%PIDFILE%" >nul 2>&1
) else (
  echo [%TS%] Aucun serveur a arreter >> "%LOG%"
)
exit /b 0

REM Sous-programme : ne retient que PORT avec une valeur numerique pure.
REM Tolere les espaces autour du nom et de la valeur, les guillemets et
REM un commentaire en fin de ligne (v3.11.26).
:env_port
set "ENVK=%~1"
:ep_kr
if "%ENVK:~-1%"==" " (set "ENVK=%ENVK:~0,-1%" & goto ep_kr)
:ep_kl
if "%ENVK:~0,1%"==" " (set "ENVK=%ENVK:~1%" & goto ep_kl)
if /i not "%ENVK%"=="PORT" goto :eof
set "ENVV=%~2"
if not defined ENVV goto :eof
set "ENVV=%ENVV:"=%"
if not defined ENVV goto :eof
:ep_vr
if "%ENVV:~-1%"==" " (set "ENVV=%ENVV:~0,-1%" & goto ep_vr)
:ep_vl
if "%ENVV:~0,1%"==" " (set "ENVV=%ENVV:~1%" & goto ep_vl)
for /f "tokens=1" %%t in ("%ENVV%") do set "ENVV=%%t"
echo %ENVV%| findstr /R "^[0-9][0-9]*$" >nul || goto :eof
set "PORT=%ENVV%"
goto :eof
