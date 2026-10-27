# ============================================================
#  SignageCMS - Installation automatique sur Windows Server
#  Executer en ADMINISTRATEUR : clic droit -> Executer avec PowerShell
#  Usage : powershell -ExecutionPolicy Bypass -File install.ps1
# ============================================================
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root
Write-Host "=== SignageCMS - Installation sur Windows ===" -ForegroundColor Cyan
Write-Host "Repertoire projet : $root"
Write-Host ""

# --- 1. Node.js ---
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  Write-Host "[OK] Node.js detecte : $(node --version)" -ForegroundColor Green
} else {
  Write-Host "[..] Node.js absent - installation via winget..." -ForegroundColor Yellow
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    Write-Host "Node.js installe. FERMEZ et ROUVREZ PowerShell, puis relancez ce script." -ForegroundColor Red
    exit 1
  } else {
    Write-Host "winget indisponible : telechargez Node.js LTS depuis https://nodejs.org," -ForegroundColor Red
    Write-Host "installez-le (options par defaut), puis relancez ce script." -ForegroundColor Red
    exit 1
  }
}

# --- 2. LibreOffice + Poppler (conversion PPT/PPTX/PDF en slides) ---
# v3.11.9 : delegation a install-tools.ps1 (telechargement direct officiel,
# sans winget ni chocolatey - fiabilise pour Windows Server sans Store).
$toolsScript = Join-Path $PSScriptRoot "install-tools.ps1"
Write-Host ""
Write-Host "=== LibreOffice / Poppler (outils de conversion) ===" -ForegroundColor Cyan
$loOk = (Test-Path "C:\Program Files\LibreOffice\program\soffice.exe") -or (Test-Path "C:\Program Files (x86)\LibreOffice\program\soffice.exe") -or ($env:SOFFICE_PATH -and (Test-Path $env:SOFFICE_PATH))
$ppOk = (Test-Path "C:\poppler\Library\bin\pdftoppm.exe") -or (Test-Path "C:\Program Files\poppler\Library\bin\pdftoppm.exe") -or (Test-Path "C:\ProgramData\chocolatey\bin\pdftoppm.exe")
if ($loOk -and $ppOk) {
  Write-Host "[OK] LibreOffice et Poppler deja installes (conversion PPT/PDF activee)" -ForegroundColor Green
} else {
  Write-Host "[..] Installation automatique des outils de conversion manquants..." -ForegroundColor Yellow
  if (Test-Path $toolsScript) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $toolsScript -Silent
  } else {
    Write-Host "[ERREUR] install-tools.ps1 introuvable a cote de ce script." -ForegroundColor Red
    Write-Host "         Installez manuellement LibreOffice : https://fr.libreoffice.org"
  }
  if ((Test-Path "C:\Program Files\LibreOffice\program\soffice.exe") -and (Test-Path "C:\poppler\Library\bin\pdftoppm.exe")) {
    Write-Host "[OK] LibreOffice + Poppler installes." -ForegroundColor Green
  } else {
    Write-Host "[!] Outils encore absents - voir deploy\windows\install-tools.log" -ForegroundColor Yellow
    Write-Host "    Le CMS s'installe quand meme ; relancez install-tools.bat plus tard." -ForegroundColor Yellow
  }
}

# --- 3. Fichier .env (base SQLite) ---
$envFile = Join-Path $root ".env"
if (Test-Path $envFile) {
  Write-Host "[OK] Fichier .env deja present" -ForegroundColor Green
} else {
  $dbPath = (Join-Path $root "db\custom.db") -replace "\\", "/"
  New-Item -ItemType Directory -Force -Path (Join-Path $root "db") | Out-Null
  "DATABASE_URL=file:$dbPath" | Out-File -FilePath $envFile -Encoding ascii
  Write-Host "[OK] .env cree : DATABASE_URL=file:$dbPath" -ForegroundColor Green
}

# --- 4. Dependances ---
Write-Host ""
if (Get-Command bun -ErrorAction SilentlyContinue) {
  Write-Host "[..] Installation des dependances avec bun..." -ForegroundColor Yellow
  bun install
} else {
  Write-Host "[..] Installation des dependances avec npm (5-10 min)..." -ForegroundColor Yellow
  npm install --no-audit --no-fund
}
if ($LASTEXITCODE -ne 0) { Write-Host "Echec de l'installation des dependances" -ForegroundColor Red; exit 1 }

# --- 5. Base de donnees + client Prisma ---
Write-Host ""
Write-Host "[..] Creation de la base SQLite + client Prisma..." -ForegroundColor Yellow
npx prisma db push
if ($LASTEXITCODE -ne 0) { Write-Host "Echec prisma db push" -ForegroundColor Red; exit 1 }
npx prisma generate
if ($LASTEXITCODE -ne 0) { Write-Host "Echec prisma generate" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "=== INSTALLATION TERMINEE AVEC SUCCES ===" -ForegroundColor Cyan
Write-Host "Etape suivante : .\build.bat        (compile le CMS en mode production)"
Write-Host "Puis            : .\start-cms.bat   (demarre sur http://localhost:3000)"
Write-Host "Optionnel       : .\firewall.ps1    (ouvre le port 3000 pour le reseau)"
Write-Host "Optionnel       : .\install-service.ps1  (demarrage automatique au boot)"
