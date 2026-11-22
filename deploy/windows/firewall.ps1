# ============================================================
#  SignageCMS - Pare-feu Windows : autoriser l'acces reseau
#  Ouvre le port du CMS : lit PORT dans le fichier .env
#  (defaut 3000). Executer EN ADMINISTRATEUR.
# ============================================================
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Write-Host "Lancez ce script EN ADMINISTRATEUR." -ForegroundColor Red
  exit 1
}
$port = 3000
$envFile = Join-Path $PSScriptRoot "..\..\.env"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*PORT\s*=\s*"?(\d+)"?\s*(?:#.*)?$') { $port = $Matches[1] }
  }
}
netsh advfirewall firewall add rule name="SignageCMS HTTP $port" dir=in action=allow protocol=TCP localport=$port
Write-Host ""
Write-Host "Port $port ouvert." -ForegroundColor Green
Write-Host "Le CMS est maintenant accessible depuis le reseau : http://<IP-du-serveur>:$port"
Write-Host "Pour connaitre l'IP du serveur : ipconfig"
