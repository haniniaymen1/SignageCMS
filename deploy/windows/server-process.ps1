# ============================================================
#  SignageCMS v3.11.25 - processus serveur (helper PowerShell)
#  -Stop : arret propre des process node.exe qui executent le
#          serveur standalone (taskkill gracieux puis force).
#  sans -Stop : affiche les pid trouves.
#  Utilise par stop-cms.bat en dernier recours (server.pid
#  absent et port non repondant). N'arrete JAMAIS un autre
#  programme : filtre strict sur la ligne de commande.
# ============================================================
param([switch]$Stop)
$ErrorActionPreference = 'SilentlyContinue'
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*standalone*server.js*' }
$found = $false
foreach ($p in $procs) {
  $found = $true
  if ($Stop) {
    taskkill /PID $p.ProcessId /T 2>$null | Out-Null
    Start-Sleep -Seconds 2
    if (Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue) {
      taskkill /F /T /PID $p.ProcessId 2>$null | Out-Null
    }
    Write-Output "arrete pid $($p.ProcessId)"
  } else {
    Write-Output $p.ProcessId
  }
}
if ($Stop) { if ($found) { exit 0 } else { exit 1 } }
