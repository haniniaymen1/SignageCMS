#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
reset-admin.py — Réinitialise le compte administrateur SignageCMS.

Remet le compte « admin » avec le mot de passe par défaut « admin123 »,
le rôle admin et le statut actif. À utiliser en cas de perte du mot de passe
sur un déploiement auto-hébergé (serveur arrêté de préférence).

Usage :
    python3 reset-admin.py [chemin_vers_base.db]

Le hash généré (scrypt:salt:hash) est compatible avec src/lib/password.ts :
    scryptSync(password, salt_hex_string, 64) — salt passé comme chaîne UTF-8.

Aucune dépendance externe (bibliothèque standard Python uniquement).
"""
import hashlib
import os
import sqlite3
import sys


def main() -> int:
    # Chemin de la base : argument, sinon valeur par défaut relative au script
    default_db = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'db', 'custom.db')
    db_path = sys.argv[1] if len(sys.argv) > 1 else os.path.normpath(default_db)

    if not os.path.exists(db_path):
        print(f"ERREUR : base introuvable : {db_path}")
        return 1

    password = 'admin123'
    salt = os.urandom(16).hex()
    digest = hashlib.scrypt(
        password.encode('utf-8'),
        salt=salt.encode('utf-8'),
        n=16384, r=8, p=1, dklen=64,
        maxmem=64 * 1024 * 1024,
    ).hex()
    stored = f"scrypt:{salt}:{digest}"

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    try:
        cur.execute(
            "UPDATE User SET password = ?, status = 'active', role = 'admin', updatedAt = datetime('now') "
            "WHERE username = 'admin'",
            (stored,),
        )
        if cur.rowcount == 0:
            cur.execute(
                "INSERT INTO User (id, username, email, name, password, role, status, createdAt, updatedAt) "
                "VALUES (?, 'admin', 'admin@signage.local', 'Admin', ?, 'admin', 'active', datetime('now'), datetime('now'))",
                ('admin-rescue-001', stored),
            )
            print("Compte admin absent — recréé.")
        conn.commit()
        print(f"OK — compte admin réinitialisé (admin / {password}) dans : {db_path}")
        print("Connectez-vous puis changez ce mot de passe depuis l'onglet Utilisateurs.")
        return 0
    except sqlite3.Error as exc:
        print(f"ERREUR SQLite : {exc}")
        return 1
    finally:
        conn.close()


if __name__ == '__main__':
    sys.exit(main())
