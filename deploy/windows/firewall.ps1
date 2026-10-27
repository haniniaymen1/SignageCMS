# ============================================================
#  SignageCMS - Pare-feu Windows : autoriser l'acces reseau
#  Ouvre le port 3000 (CMS + lecteur). Executer EN ADMINISTRATEUR.
# ============================================================
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Write-Host "Lancez ce script EN ADMINISTRATEUR." -ForegroundColor Red
  exit 1
}
netsh advfirewall firewall add rule name="SignageCMS HTTP 3000" dir=in action=allow protocol=TCP localport=3000
Write-Host ""
Write-Host "Port 3000 ouvert." -ForegroundColor Green
Write-Host "Le CMS est maintenant accessible depuis le reseau : http://<IP-du-serveur>:3000"
Write-Host "Pour connaitre l'IP du serveur : ipconfig"
