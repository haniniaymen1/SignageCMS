# ============================================================
#  SignageCMS - Installation des outils de conversion (Windows)
#  Telecharge et installe :
#    - LibreOffice  (PPT/PPTX/PPS/PPSX/ODP -> PDF)  depuis documentfoundation.org
#    - Poppler      (PDF -> PNG par diapositive)    depuis github.com/oschwartz10612/poppler-windows
#
#  Usage : clic droit sur install-tools.bat -> "Executer en tant qu'administrateur"
#          ou : powershell -ExecutionPolicy Bypass -File install-tools.ps1
#          ou automatiquement en fin de install.bat (etape 6)
#
#  - Aucune dependance winget/choco requise (telechargement direct).
#  - Multi-sources : miroir TDF "stable" + archive TDF "old", avec reprise
#    automatique (curl.exe integre a Windows) et validation de taille.
#  - Idempotent : ne reinstalle pas ce qui est deja present.
#  - Journal : deploy\windows\install-tools.log
# ============================================================
param([switch]$Silent)  # -Silent : pas de pause finale (appel depuis install.bat / install.ps1)
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = "SilentlyContinue"

$winDir = $PSScriptRoot
$logFile = Join-Path $winDir "install-tools.log"
function Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Write-Host $line
  Add-Content -Path $logFile -Value $line -Encoding UTF8
}

# --- Elévation administrateur (nécessaire pour msiexec + Program Files) ---
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  if ($Silent) {
    Log "[!] Droits administrateur requis - lancez : install-tools.bat (clic droit, Executer en tant qu'administrateur)."
    exit 2
  }
  Write-Host "Elevation administrateur requise - relance automatique..." -ForegroundColor Yellow
  Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  exit
}

Log "=== SignageCMS - Installation des outils de conversion ==="

# ---------- 1. LibreOffice ----------
$sofficePaths = @(
  "${env:ProgramFiles}\LibreOffice\program\soffice.exe",
  "${env:ProgramFiles(x86)}\LibreOffice\program\soffice.exe"
)
$loOk = $sofficePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($loOk) {
  Log "[OK] LibreOffice deja installe : $loOk"
} elseif ($env:SOFFICE_PATH -and (Test-Path $env:SOFFICE_PATH)) {
  Log "[OK] LibreOffice declare via SOFFICE_PATH : $($env:SOFFICE_PATH)"
} else {
  if ($env:PROCESSOR_ARCHITECTURE -notlike "*64*") {
    Log "[!] Windows 32 bits detecte : le MSI x86_64 est incompatible."
    Log "    Installez manuellement LibreOffice 32 bits : https://fr.libreoffice.org/download/"
  } else {
    Log "[..] LibreOffice absent - telechargement officiel (~360 Mo, 5 a 20 min selon la connexion)..."

    # --- 1a. Versions candidates : listing officiel TDF, tri du plus recent au plus ancien
    $cand = New-Object System.Collections.Generic.List[string]
    try {
      $listing = (Invoke-WebRequest -UseBasicParsing -Uri "https://download.documentfoundation.org/libreoffice/stable/" -TimeoutSec 30).Content
      [regex]::Matches($listing, 'href="([0-9]+(?:\.[0-9]+)+)/"') | ForEach-Object { $cand.Add($_.Groups[1].Value) }
      if ($cand.Count -gt 0) {
        Log ("[OK] Versions TDF detectees : " + (($cand | Select-Object -Unique) -join ", "))
      }
    } catch {
      Log "[!] Listing TDF injoignable ($($_.Exception.Message)) - versions de repli utilisees."
    }
    @("26.8.1", "26.2.6", "25.8.7") | ForEach-Object { $cand.Add($_) }
    $versions = $cand | Select-Object -Unique | ForEach-Object {
      try { New-Object psobject -Property @{ V = $_; Num = [version]$_ } } catch { $null }
    } | Where-Object { $_ -ne $null } | Sort-Object Num -Descending | Select-Object -ExpandProperty V

    # --- 1b. Sources par version : miroir "stable" puis archive "old" (test HEAD)
    $sources = New-Object System.Collections.Generic.List[string]
    foreach ($v in $versions) {
      $name = "LibreOffice_${v}_Win_x86-64.msi"
      $sources.Add("https://download.documentfoundation.org/libreoffice/stable/$v/win/x86_64/$name")
      $sources.Add("https://downloadarchive.documentfoundation.org/libreoffice/old/$v/win/x86_64/$name")
    }
    $msiUrl = $null
    foreach ($u in $sources) {
      try {
        $head = Invoke-WebRequest -UseBasicParsing -Method Head -Uri $u -TimeoutSec 25 -MaximumRedirection 5
        if ($head.StatusCode -eq 200) { $msiUrl = $u; break }
      } catch { }
    }
    if (-not $msiUrl) {
      Log "[ERREUR] Aucun MSI LibreOffice joignable. Installez manuellement : https://fr.libreoffice.org/download/"
    } else {
      Log "[..] Telechargement : $msiUrl"
      $msi = Join-Path $env:TEMP "LibreOffice_install.msi"
      if (Test-Path $msi) { Remove-Item $msi -Force -ErrorAction SilentlyContinue }
      $dlOk = $false

      # --- 1c. curl.exe (integre Windows 10 1803+/Server 2019+) : reprise auto,
      #         3 essais, abandon si debit < 10 Ko/s pendant 60 s (lien fige)
      $curlExe = Join-Path $env:SystemRoot "System32\curl.exe"
      if (Test-Path $curlExe) {
        Log "[..] Telechargement via curl.exe (3 essais, reprise automatique)..."
        & $curlExe -L --fail --retry 3 --retry-delay 3 --connect-timeout 30 `
          --speed-limit 10240 --speed-time 60 --silent --show-error `
          -o "$msi" "$msiUrl" 2>>$logFile
        if ($LASTEXITCODE -eq 0 -and (Test-Path $msi)) { $dlOk = $true }
        else { Log "[!] curl.exe a echoue (code $LASTEXITCODE) - source suivante tentee." }
      }
      # --- 1d. Repli : Invoke-WebRequest
      if (-not $dlOk) {
        Log "[..] Repli : telechargement via Invoke-WebRequest (jusqu'a 60 min)..."
        try {
          Invoke-WebRequest -UseBasicParsing -Uri $msiUrl -OutFile $msi -TimeoutSec 3600
          $dlOk = $true
        } catch {
          Log "[ERREUR] Telechargement : $($_.Exception.Message)"
        }
      }

      # --- 1e. Validation de taille puis installation silencieuse
      if ($dlOk -and (Test-Path $msi)) {
        $mo = [math]::Round((Get-Item $msi).Length / 1MB)
        if ($mo -lt 150) {
          Log "[ERREUR] Fichier incomplet (${mo} Mo, attendu ~360 Mo) - essai suivant."
          $dlOk = $false
        } else {
          Log "[OK] MSI telecharge (${mo} Mo) - installation silencieuse (2-5 min)..."
          $p = Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait -PassThru
          $after = $sofficePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
          if ($p.ExitCode -eq 0 -and $after) {
            Log "[OK] LibreOffice installe avec succes : $after"
          } else {
            Log "[ERREUR] msiexec code $($p.ExitCode) - relancez manuellement : $msi"
            $dlOk = $false
          }
        }
      }
      if (-not $dlOk) { Remove-Item $msi -Force -ErrorAction SilentlyContinue }
    }
  }
}

# ---------- 2. Poppler ----------
$popplerPaths = @(
  "C:\poppler\Library\bin\pdftoppm.exe",
  "${env:ProgramFiles}\poppler\Library\bin\pdftoppm.exe",
  "C:\ProgramData\chocolatey\bin\pdftoppm.exe"
)
$ppOk = $popplerPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($ppOk) {
  Log "[OK] Poppler deja installe : $ppOk"
} elseif ($env:PDFTOPPM_PATH -and (Test-Path $env:PDFTOPPM_PATH)) {
  Log "[OK] Poppler declare via PDFTOPPM_PATH : $($env:PDFTOPPM_PATH)"
} else {
  Log "[..] Poppler absent - telechargement depuis GitHub (oschwartz10612/poppler-windows)..."
  $zipUrl = $null
  try {
    $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/oschwartz10612/poppler-windows/releases/latest" -TimeoutSec 30
    $asset = $rel.assets | Where-Object { $_.name -match "\.zip$" } | Select-Object -First 1
    if ($asset) { $zipUrl = $asset.browser_download_url }
  } catch {
    Log "[!] API GitHub injoignable ($($_.Exception.Message)) - version de repli utilisee."
  }
  if (-not $zipUrl) { $zipUrl = "https://github.com/oschwartz10612/poppler-windows/releases/download/v26.09.0-0/Release-26.09.0-0.zip" }
  Log "[..] Telechargement : $zipUrl"
  $zip = Join-Path $env:TEMP "poppler-windows.zip"
  $zipOk = $false
  $curlExe = Join-Path $env:SystemRoot "System32\curl.exe"
  if (Test-Path $curlExe) {
    & $curlExe -L --fail --retry 3 --retry-delay 3 --connect-timeout 30 `
      --speed-limit 10240 --speed-time 60 --silent --show-error `
      -o "$zip" "$zipUrl" 2>>$logFile
    if ($LASTEXITCODE -eq 0 -and (Test-Path $zip)) { $zipOk = $true }
  }
  if (-not $zipOk) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $zipUrl -OutFile $zip -TimeoutSec 1800
      $zipOk = $true
    } catch {
      Log "[ERREUR] Telechargement Poppler : $($_.Exception.Message)"
    }
  }
  if ($zipOk) {
    Log "[OK] ZIP telecharge - extraction vers C:\poppler..."
    $tmpEx = Join-Path $env:TEMP ("poppler-ex-" + [guid]::NewGuid().ToString("N"))
    try {
      Expand-Archive -Path $zip -DestinationPath $tmpEx -Force
      # l'archive contient poppler-XX.YY.Z\Library\bin\pdftoppm.exe
      $pdftoppm = Get-ChildItem -Path $tmpEx -Recurse -Filter "pdftoppm.exe" | Select-Object -First 1
      if (-not $pdftoppm) {
        Log "[ERREUR] pdftoppm.exe introuvable dans l'archive telechargee."
      } else {
        $libDir = Split-Path -Parent (Split-Path -Parent $pdftoppm.FullName)   # ...\Library
        New-Item -ItemType Directory -Force -Path "C:\poppler" | Out-Null
        $dest = "C:\poppler\Library"
        if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
        Move-Item $libDir $dest
        Log "[OK] Poppler installe : C:\poppler\Library\bin\pdftoppm.exe"
        # chemin systeme (commodite pour d'autres outils)
        $binDir = "C:\poppler\Library\bin"
        $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
        if ($machinePath -notlike "*$binDir*") {
          [Environment]::SetEnvironmentVariable("Path", "$machinePath;$binDir", "Machine")
          Log "[OK] $binDir ajoute au PATH systeme."
        }
      }
    } catch {
      Log "[ERREUR] Extraction Poppler : $($_.Exception.Message)"
    }
    Remove-Item $tmpEx -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
  }
}

# ---------- 3. Verification finale ----------
Log "------------------------------------------------------------"
$finalLo = $sofficePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
$finalPp = @("C:\poppler\Library\bin\pdftoppm.exe", "${env:ProgramFiles}\poppler\Library\bin\pdftoppm.exe") |
           Where-Object { Test-Path $_ } | Select-Object -First 1
if ($finalLo) { Log "[OK] LibreOffice : $finalLo" } else { Log "[ECHEC] LibreOffice : TOUJOURS ABSENT" }
if ($finalPp) { Log "[OK] Poppler    : $finalPp" } else { Log "[ECHEC] Poppler    : TOUJOURS ABSENT" }

if ($finalLo -and $finalPp) {
  Log "Installation terminee avec succes."
  Log "Redemarrez le CMS, puis bouton 'Reconvertir' sur les medias 'Non converti' dans la bibliotheque."
  if (-not $Silent) {
    Write-Host ""
    Write-Host "=== INSTALLATION DES OUTILS TERMINEE AVEC SUCCES ===" -ForegroundColor Green
    Write-Host "Appuyez sur Entree pour fermer..."
    Read-Host | Out-Null
  }
} else {
  if (-not $Silent) {
    Write-Host ""
    Write-Host "=== INSTALLATION PARTIELLE - voir le journal : $logFile ===" -ForegroundColor Red
    Write-Host "Appuyez sur Entree pour fermer..."
    Read-Host | Out-Null
  }
  exit 1
}
