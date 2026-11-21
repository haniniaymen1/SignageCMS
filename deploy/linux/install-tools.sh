#!/usr/bin/env bash
# ============================================================
#  SignageCMS — Installation des outils de conversion de documents
#  Installe LibreOffice (PPT/PPTX/PPS/PPSX/ODP -> PDF) et
#  Poppler (PDF -> PNG par diapositive) pour le serveur CMS.
#
#  Usage :
#    bash deploy/linux/install-tools.sh            # installation standard (sudo si besoin)
#    sudo bash deploy/linux/install-tools.sh       # déjà root
#    bash deploy/linux/install-tools.sh --no-sudo  # sans sudo : repli archive TDF dans $HOME
#
#  Compatible : Ubuntu / Debian (apt), RHEL / CentOS / Rocky / Alma / Fedora (dnf/yum),
#  openSUSE (zypper), Arch (pacman), Alpine (apk). Sans gestionnaire de paquets :
#  archive officielle LibreOffice (documentfoundation.org).
#
#  Idempotent : ne réinstalle pas ce qui est déjà présent.
# ============================================================
set -u

C_OK='\033[32m'; C_WARN='\033[33m'; C_ERR='\033[31m'; C_INFO='\033[36m'; C_END='\033[0m'
ok()   { echo -e "${C_OK}[OK]${C_END} $*"; }
warn() { echo -e "${C_WARN}[!]${C_END} $*"; }
err()  { echo -e "${C_ERR}[ERREUR]${C_END} $*"; }
info() { echo -e "${C_INFO}[..]${C_END} $*"; }

NO_SUDO=0
[ "${1:-}" = "--no-sudo" ] && NO_SUDO=1

SUDO=""
if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
elif [ "$NO_SUDO" -eq 1 ]; then
  SUDO=""
  warn "Mode --no-sudo : installation dans \$HOME (sans apt/dnf)."
elif command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
fi

echo "=========================================="
echo "  SignageCMS — Outils de conversion"
echo "  LibreOffice + Poppler (diapositives PPT/PDF)"
echo "=========================================="
echo

# ---------- 1. Détection de l'existant ----------
have_soffice() {
  [ -n "${SOFFICE_PATH:-}" ] && [ -x "${SOFFICE_PATH:-}" ] && return 0
  command -v soffice >/dev/null 2>&1 && return 0
  command -v soffice.bin >/dev/null 2>&1 && return 0
  return 1
}
have_pdftoppm() {
  [ -n "${PDFTOPPM_PATH:-}" ] && [ -x "${PDFTOPPM_PATH:-}" ] && return 0
  command -v pdftoppm >/dev/null 2>&1 && return 0
  return 1
}

MISSING_LO=0; MISSING_PP=0
if have_soffice; then
  ok "LibreOffice déjà installé : $(soffice --version 2>/dev/null | head -1 || echo 'soffice')"
else
  MISSING_LO=1; warn "LibreOffice absent."
fi
if have_pdftoppm; then
  ok "Poppler (pdftoppm) déjà installé : $(pdftoppm -v 2>&1 | head -1 || echo 'pdftoppm')"
else
  MISSING_PP=1; warn "Poppler (pdftoppm) absent."
fi

if [ "$MISSING_LO" -eq 0 ] && [ "$MISSING_PP" -eq 0 ]; then
  echo
  ok "Rien à faire — les deux outils sont déjà installés."
  echo "      Le CMS peut convertir les PowerPoint et PDF en diapositives."
  exit 0
fi

# ---------- 2. Installation via le gestionnaire de paquets ----------
PKG=""
for m in apt-get dnf yum zypper pacman apk; do
  command -v "$m" >/dev/null 2>&1 && { PKG="$m"; break; }
done

pkg_install() {
  case "$1" in
    apt-get) $SUDO apt-get update -y && $SUDO apt-get install -y $2 ;;
    dnf)     $SUDO dnf install -y $2 ;;
    yum)     $SUDO yum install -y $2 ;;
    zypper)  $SUDO zypper --non-interactive install $2 ;;
    pacman)  $SUDO pacman -Sy --noconfirm $2 ;;
    apk)     $SUDO apk add --no-cache $2 ;;
    *)       return 1 ;;
  esac
}

if [ -n "$PKG" ] && { [ "$MISSING_LO" -eq 1 ] || [ "$MISSING_PP" -eq 1 ]; }; then
  info "Gestionnaire de paquets détecté : $PKG"
  if [ "$(id -u)" -ne 0 ] && [ -z "$SUDO" ]; then
    err "Ni root ni sudo : relancez avec « sudo bash $0 » ou « bash $0 --no-sudo »."
    PKG=""
  else
    case "$PKG" in
      apt-get|dnf|yum)
        [ "$MISSING_LO" -eq 1 ] && pkg_install "$PKG" "libreoffice-impress"
        [ "$MISSING_PP" -eq 1 ] && pkg_install "$PKG" "poppler-utils"
        ;;
      zypper)
        [ "$MISSING_LO" -eq 1 ] && pkg_install "$PKG" "libreoffice-impress"
        [ "$MISSING_PP" -eq 1 ] && pkg_install "$PKG" "poppler-tools"
        ;;
      pacman)
        [ "$MISSING_LO" -eq 1 ] && pkg_install "$PKG" "libreoffice-still"
        [ "$MISSING_PP" -eq 1 ] && pkg_install "$PKG" "poppler"
        ;;
      apk)
        [ "$MISSING_LO" -eq 1 ] && pkg_install "$PKG" "libreoffice"
        [ "$MISSING_PP" -eq 1 ] && pkg_install "$PKG" "poppler-utils"
        ;;
    esac
  fi
elif [ -z "$PKG" ] && [ "$MISSING_LO" -eq 1 ]; then
  warn "Aucun gestionnaire de paquets connu — repli : archive officielle LibreOffice."
fi

# ---------- 3. Repli : archive officielle TDF (sans root / sans paquet) ----------
tdf_install() {
  local ver url tarball dest flavor target d
  # dernière version stable annoncée par le miroir officiel
  ver=$(curl -fsSL -m 30 "https://download.documentfoundation.org/libreoffice/stable/" 2>/dev/null \
        | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | sort -uV | tail -1)
  [ -z "$ver" ] && ver="26.8.1"
  flavor=""
  command -v dpkg >/dev/null 2>&1 && flavor="deb"
  command -v rpm  >/dev/null 2>&1 && [ -z "$flavor" ] && flavor="rpm"
  if [ -z "$flavor" ]; then
    err "Repli impossible : ni dpkg ni rpm sur ce système (Alpine/musl ?)."
    return 1
  fi
  url="https://download.documentfoundation.org/libreoffice/stable/${ver}/${flavor}/x86_64/LibreOffice_${ver}_Linux_x86-64_${flavor}.tar.gz"
  tarball="$(mktemp -u /tmp/lo.XXXXXX).tar.gz"
  dest="$(mktemp -d /tmp/lo-src.XXXXXX)"
  info "Téléchargement LibreOffice ${ver} (${flavor}, x86_64)…"
  info "  $url"
  curl -fSL --retry 3 -m 1800 -o "$tarball" "$url" || { err "Téléchargement échoué."; return 1; }
  tar -xzf "$tarball" -C "$dest" || { err "Extraction échouée."; return 1; }
  if [ "$flavor" = "deb" ]; then
    if [ "$(id -u)" -ne 0 ]; then
      warn "Sans root : extraction des .deb dans \$HOME/.local/libreoffice (portable)."
      target="$HOME/.local/libreoffice-portable"
      mkdir -p "$target"
      for d in "$dest"/LibreOffice*_${flavor}/DEBS/*.deb; do
        [ -e "$d" ] || { err "Aucun .deb trouvé dans l'archive."; return 1; }
        dpkg-deb -x "$d" "$target" 2>/dev/null || { err "dpkg-deb indisponible."; return 1; }
      done
      mkdir -p "$HOME/.local/bin"
      ln -sf "$(echo "$target"/opt/libreoffice*/program/soffice)" "$HOME/.local/bin/soffice"
      ok "soffice installé : $HOME/.local/bin/soffice"
      echo '      Ajoutez ~/.local/bin à votre PATH, ou définissez dans .env :'
      echo "      SOFFICE_PATH=$HOME/.local/bin/soffice"
    else
      (cd "$dest"/LibreOffice*_${flavor} && $SUDO dpkg -i DEBS/*.deb) || { err "Installation dpkg échouée."; return 1; }
    fi
  else
    (cd "$dest"/LibreOffice*_${flavor}/RPMS && $SUDO rpm -Uvh --force *.rpm) || { err "Installation rpm échouée."; return 1; }
  fi
  rm -rf "$dest" "$tarball"
  return 0
}

if [ "$MISSING_LO" -eq 1 ] && ! have_soffice && { [ -z "$PKG" ] || [ "$NO_SUDO" -eq 1 ]; }; then
  tdf_install || err "LibreOffice n'a pas pu être installé automatiquement."
fi

# Poppler sans gestionnaire de paquets : pas d'archive officielle fiable
if [ "$MISSING_PP" -eq 1 ] && ! have_pdftoppm && [ -z "$PKG" ]; then
  err "Poppler : aucune archive standalone fiable pour Linux sans gestionnaire de paquets."
  err "        Sur Ubuntu/Debian : sudo apt install poppler-utils"
  err "        Sur RHEL/Fedora   : sudo dnf install poppler-utils"
fi

# ---------- 4. Vérification finale ----------
echo
echo "=========================================="
FINAL_LO=0; FINAL_PP=0
if have_soffice; then FINAL_LO=1; ok "LibreOffice : $(soffice --version 2>/dev/null | head -1)"; else err "LibreOffice : TOUJOURS ABSENT"; fi
if have_pdftoppm; then FINAL_PP=1; ok "Poppler    : $(pdftoppm -v 2>&1 | head -1)"; else err "Poppler    : TOUJOURS ABSENT"; fi
echo "=========================================="

if [ "$FINAL_LO" -eq 1 ] && [ "$FINAL_PP" -eq 1 ]; then
  echo
  ok "Installation terminée."
  echo "      Redémarrez le CMS, puis cliquez « Reconvertir » sur les médias"
  echo "      marqués « Non converti » dans la bibliothèque (ou réimportez-les)."
  exit 0
fi
exit 1
