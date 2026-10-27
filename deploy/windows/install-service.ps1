# ============================================================
#  SignageCMS - Service Windows (demarrage automatique au boot)
#  - Avec NSSM (recommande) : relance automatique en cas de crash + journal
#    Telechargez nssm.exe (https://nssm.cc/download) et placez-le :
#    a cote de ce script, ou dans C:\nssm\nssm.exe, ou via choco install nssm
#  - Sans NSSM : tache planifiee SYSTEM au demarrage (solution de repli)
#  Executer EN ADMINISTRATEUR.
# ============================================================
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$bat  = Join-Path $root "deploy\windows\start-cms.bat"

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Write-Host "Lancez ce script EN ADMINISTRATEUR (clic droit -> Executer avec PowerShell)." -ForegroundColor Red
  exit 1
}
if (-not (Test-Path (Join-Path $root ".next\standalone\server.js"))) {
  Write-Host "Build absent - lancez d'abord .\build.bat" -ForegroundColor Red
  exit 1
}

$nssmCandidates = @((Join-Path $PSScriptRoot "nssm.exe"), "C:\nssm\nssm.exe", "C:\ProgramData\chocolatey\bin\nssm.exe") | Where-Object { Test-Path $_ }
if ($nssmCandidates) {
  $nssm = $nssmCandidates[0]
  Write-Host "NSSM detecte : $nssm" -ForegroundColor Cyan
  $existing = Get-Service -Name "SignageCMS" -ErrorAction SilentlyContinue
  if ($existing) { & $nssm stop SignageCMS; & $nssm remove SignageCMS confirm }
  & $nssm install SignageCMS "C:\Windows\System32\cmd.exe" "/c `"$bat`""
  & $nssm set SignageCMS AppDirectory $root
  & $nssm set SignageCMS DisplayName "SignageCMS - Serveur d'affichage dynamique"
  & $nssm set SignageCMS Description "CMS d'affichage dynamique (Next.js) - port 3000"
  & $nssm set SignageCMS Start SERVICE_AUTO_START
  & $nssm set SignageCMS AppStdout (Join-Path $root "service.log")
  & $nssm set SignageCMS AppStderr (Join-Path $root "service.log")
  & $nssm set SignageCMS AppRotateFiles 1
  & $nssm set SignageCMS AppRotateOnline 1
  & $nssm set SignageCMS AppRotateBytes 10485760
  & $nssm start SignageCMS
  Write-Host ""
  Write-Host "Service Windows 'SignageCMS' installe et demarre." -ForegroundColor Green
  Write-Host "Demarrage automatique au boot + relance en cas de crash. Journal : service.log"
} else {
  Write-Host "NSSM absent - solution de repli : tache planifiee SYSTEM au boot." -ForegroundColor Yellow
  schtasks /Create /TN "SignageCMS" /TR "\"$bat\"" /SC ONSTART /RU SYSTEM /RL HIGHEST /F
  schtasks /Run /TN "SignageCMS"
  Write-Host ""
  Write-Host "Tache planifiee 'SignageCMS' creee et lancee (demarrage auto au boot)." -ForegroundColor Green
  Write-Host "Pour un vrai service avec relance auto, telechargez NSSM et relancez ce script."
}
Write-Host "Verification : http://localhost:3000"
