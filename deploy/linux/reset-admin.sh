#!/usr/bin/env bash
# ============================================================
#  SignageCMS (v3.11.24) - Reinitialisation du compte admin
#  Usage : sudo bash deploy/linux/reset-admin.sh
#  Effet : supprime le compte admin de la base puis le recree
#  IMMEDIATEMENT (scripts/ensure-admin.mjs) avec un mot de
#  passe ALEATOIRE affiche ici et ecrit dans
#  db/admin-credentials.txt. Aucun redemarrage ni essai de
#  connexion a l'aveugle n'est requis : reconnectez-vous
#  directement avec le mot de passe affiche.
#  Conseil : sauvegardez db/custom.db avant d'executer.
# ============================================================
set -e
cd "$(dirname "$0")/../.."

if [ ! -f prisma/schema.prisma ]; then
  echo "[ERREUR] prisma/schema.prisma introuvable - placez ce script dans deploy/linux du projet."
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "[ERREUR] node_modules absent - lancez d'abord install.sh (ou npm install)."
  exit 1
fi

echo "Ce script reinitialise le compte admin de la base (cf. DATABASE_URL du .env)."
echo "Un NOUVEAU mot de passe aleatoire sera affiche ici et ecrit dans"
echo "db/admin-credentials.txt. Aucun redemarrage n'est requis."
printf 'Taper OUI pour continuer : '
read -r CONFIRM
if [ "$CONFIRM" != "OUI" ]; then
  echo "Annule."
  exit 0
fi

echo "DELETE FROM User WHERE username='admin';" | npx prisma db execute --schema prisma/schema.prisma --stdin

echo ""
# v3.11.24 : recreation immediatee (plus d'essai de connexion a l'aveugle).
if [ -f scripts/ensure-admin.mjs ] && command -v node >/dev/null 2>&1; then
  if node scripts/ensure-admin.mjs; then
    echo ""
    echo "Reinitialisation terminee. Connectez-vous avec le mot de passe affiche"
    echo "ci-dessus, changez-le (menu Utilisateurs), puis supprimez"
    echo "db/admin-credentials.txt."
    exit 0
  fi
  echo "[!] Recreation automatique echouee - suivez les etapes ci-dessous."
fi

# Repli (comportement v3.11.17) : le compte sera recree au prochain essai de connexion
echo "Compte admin supprime. Etapes suivantes (mode degrade) :"
echo "  1. Redemarrez le serveur : sudo systemctl restart signagecms"
echo "  2. Ouvrez la page de connexion, tapez admin et un mot de passe quelconque,"
echo "     puis validez : le nouveau mot de passe apparait dans la console du"
echo "     serveur (journalctl -u signagecms -n 30) et dans db/admin-credentials.txt."
echo "  3. Connectez-vous avec ce mot de passe, changez-le (menu Utilisateurs),"
echo "     puis supprimez db/admin-credentials.txt."
