#!/usr/bin/env python3
"""Nettoie les informations personnelles de la base SignageCMS :
supprime les comptes de test (noms + emails réels), ne garde que 'admin'.
Les entités fonctionnelles (écrans, présentations, playlists, IPTV) sont conservées."""
import sqlite3

DB = '/home/z/my-project/db/custom.db'


def main() -> None:
    c = sqlite3.connect(DB)
    cur = c.cursor()
    tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")]
    print('Tables:', ', '.join(sorted(tables)))

    # 1) Comptes de test avec informations personnelles → suppression (admin conservé)
    before = cur.execute('SELECT COUNT(*) FROM User').fetchone()[0]
    removed = cur.execute("DELETE FROM User WHERE username != 'admin'").rowcount
    print(f'Users: {before} → {before - removed} (supprimé: {removed})')

    # 2) Groupes d'utilisateurs de test (vides après suppression)
    if 'UserGroup' in tables:
        for gid, name in list(cur.execute('SELECT id, name FROM UserGroup')):
            cnt = cur.execute('SELECT COUNT(*) FROM User WHERE userGroupId=?', (gid,)).fetchone()[0]
            print(f'UserGroup {name!r}: {cnt} membre(s) restant(s)')

    # 3) Neutralise les champs personnels résiduels côté admin (email générique déjà anonyme)
    cur.execute("UPDATE User SET email='admin@signage.local', name='Admin' WHERE username='admin'")

    c.commit()
    print('--- APRÈS ---')
    for r in cur.execute('SELECT username, email, name, role, status FROM User'):
        print(r)
    c.close()


if __name__ == '__main__':
    main()
