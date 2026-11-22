@echo off
setlocal EnableExtensions
REM ============================================================
REM  SignageCMS - Demarrage SILENCIEUX en arriere-plan (v3.11.26)
REM  - aucune fenetre CMD ni PowerShell pour le serveur (VBS cache)
REM  - continue de tourner apres la fermeture du terminal
REM  - port modifiable dans le fichier .env (PORT=3000) : relancez
REM    simplement ce script ; si le serveur tourne deja sur un autre
REM    port, il redemarre automatiquement sur le nouveau port
REM  - anti-demarrage multiple : server.pid + port + WMI
REM  Arret : deploy\windows\stop-cms.bat
REM  100 % invisible : deploy\windows\start-cms-silent.vbs
REM ============================================================
cd /d "%~dp0..\.."
set "LOG=%CD%\service.log"
set "PIDFILE=%CD%\server.pid"
set "VBS=%~dp0start-cms-hidden.vbs"
set "TS=%DATE% %TIME%"
echo [%TS%] start-cms.bat lance >> "%LOG%"

REM ---------- port : fichier .env puis 3000 (v3.11.26 : parseur durci) ----------
set "PORT=3000"
if exist ".env" for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%CD%\.env") do call :env_port "%%~a" "%%~b"
goto port_ok

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

:port_ok
REM ---------- pre-requis ----------
if not exist ".env" (
  echo [ERREUR] Fichier .env absent - lancez d'abord deploy\windows\install.bat
  echo [%TS%] ERREUR : .env absent >> "%LOG%"
  if not defined SMCMS_SILENT pause
  exit /b 1
)
if not exist ".next\standalone\server.js" (
  echo [ERREUR] Build absent - lancez d'abord deploy\windows\install.bat ou build.bat
  echo [%TS%] ERREUR : build absent >> "%LOG%"
  if not defined SMCMS_SILENT pause
  exit /b 1
)

REM ---------- deja actif ? (anti-demarrage multiple) ----------
if exist "%PIDFILE%" goto check_pid
goto check_wmi
:check_pid
set "PID="
set /p PID=<"%PIDFILE%" 2>nul
if not defined PID goto check_wmi
tasklist /FI "PID eq %PID%" 2>nul | find /I "node.exe" >nul && goto active_server
echo [%TS%] server.pid perime (pid %PID% absent) >> "%LOG%"
del /q "%PIDFILE%" >nul 2>&1
goto check_wmi
:check_wmi
REM pidfile absent ou perime : le serveur tourne-t-il quand meme ?
wscript.exe "%VBS%" %PORT% --check
if errorlevel 2 goto wmi_active
goto port_free
:wmi_active
REM le VBS --check a retrouve un serveur actif et a ecrit son pid dans server.pid
set "PID="
if exist "%PIDFILE%" set /p PID=<"%PIDFILE%" 2>nul
if not defined PID goto already

:active_server
REM ---------- serveur actif : port d'ecoute reel (netstat, v3.11.26) ----------
set "CURPORT="
for /f "tokens=2,5" %%i in ('netstat -aon -p TCP 2^>nul ^| findstr /I "LISTENING" ^| findstr /C:"0.0.0.0:"') do (
  if "%%j"=="%PID%" set "CURPORT=%%i"
)
if defined CURPORT for /f "tokens=2 delims=:" %%p in ("%CURPORT%") do set "CURPORT=%%p"
if not defined CURPORT goto already
if "%CURPORT%"=="%PORT%" goto already
REM ---------- port change dans .env : le nouveau port est-il libre ? ----------
set "OTHER="
for /f "tokens=5" %%q in ('netstat -aon -p TCP 2^>nul ^| findstr /C:":%PORT% " ^| findstr /I "LISTENING"') do (
  if not "%%q"=="%PID%" set "OTHER=%%q"
)
if defined OTHER (
  echo [ERREUR] Le port %PORT% demande dans .env est deja utilise par un autre programme ^(pid %OTHER%^).
  echo          Le serveur continue de tourner sur le port %CURPORT%. Changez PORT dans .env.
  echo [%TS%] ERREUR : port %PORT% occupe par pid %OTHER% - serveur maintenu sur %CURPORT% >> "%LOG%"
  if not defined SMCMS_SILENT pause
  exit /b 1
)
REM ---------- port change : arret propre puis relance automatique ----------
echo [INFO] Port change dans le fichier .env : %CURPORT% -^> %PORT%. Redemarrage du serveur...
echo [%TS%] Port change dans .env : %CURPORT% -^> %PORT% : redemarrage du serveur >> "%LOG%"
taskkill /PID %PID% /T >nul 2>&1
ping -n 4 127.0.0.1 >nul
tasklist /FI "PID eq %PID%" 2>nul | find /I "node.exe" >nul && taskkill /F /T /PID %PID% >nul 2>&1
del /q "%PIDFILE%" >nul 2>&1

:port_free
REM ---------- port deja occupe par un autre programme ? ----------
for /f "tokens=5" %%q in ('netstat -aon -p TCP 2^>nul ^| findstr /C:":%PORT% " ^| findstr /I "LISTENING"') do (
  echo [ERREUR] Le port %PORT% est deja utilise par un autre programme (pid %%q^).
  echo [%TS%] ERREUR : port %PORT% occupe par pid %%q >> "%LOG%"
  if not defined SMCMS_SILENT pause
  exit /b 1
)
REM ---------- binaires externes (conversion PPT/PDF) ----------
if exist "C:\poppler\Library\bin" set "PATH=%PATH%;C:\poppler\Library\bin"
if exist "C:\Program Files\LibreOffice\program" set "PATH=%PATH%;C:\Program Files\LibreOffice\program"
REM ---------- compte admin cree au besoin (conserve v3.11.23) ----------
if exist "scripts\ensure-admin.mjs" call node scripts\ensure-admin.mjs >> "%LOG%" 2>&1
REM ---------- lancement invisible ----------
wscript.exe "%VBS%" %PORT%
if errorlevel 2 goto already
if errorlevel 1 (
  echo [ERREUR] Lancement impossible - consultez %LOG%
  echo [%TS%] ERREUR : lancement impossible >> "%LOG%"
  if not defined SMCMS_SILENT pause
  exit /b 1
)
REM ---------- resume final ----------
set "PID="
if exist "%PIDFILE%" set /p PID=<"%PIDFILE%" 2>nul
echo [OK] SignageCMS demarre en arriere-plan sur le port %PORT%.
if defined PID echo      Processus : %PID%    Arret : deploy\windows\stop-cms.bat
echo      Interface : http://localhost:%PORT%    Journal : service.log
echo      Le serveur continue de tourner apres la fermeture de cette fenetre.
echo [%TS%] Demarrage OK : pid %PID%, port %PORT% >> "%LOG%"
if not defined SMCMS_SILENT ping -n 4 127.0.0.1 >nul
exit /b 0
:already
if defined CURPORT (
  echo [INFO] SignageCMS tourne deja sur le port %CURPORT% - le fichier .env demande le meme port : rien a faire.
  echo [%TS%] Deja actif sur le port %CURPORT% (.env : %PORT%) >> "%LOG%"
) else (
  echo [INFO] SignageCMS est deja actif - pour changer de port, modifiez PORT dans .env puis relancez start-cms.bat
  echo [%TS%] Demarrage refuse : deja actif >> "%LOG%"
)
if defined PID echo      Arret : deploy\windows\stop-cms.bat ^(pid %PID%^)
if not defined SMCMS_SILENT ping -n 4 127.0.0.1 >nul
exit /b 0
