// Vérification rapide du serveur LDAP fictif (hors CMS)
import { Client } from 'ldapts'

const URL = 'ldap://127.0.0.1:1389'
const c = new Client({ url: URL, timeout: 4000, connectTimeout: 4000 })

await c.bind('cn=service-lecture,ou=Services,dc=societe,dc=local', 'service-annuaire-2024')
console.log('bind service OK')

const root = await c.search('', { scope: 'base', attributes: ['namingContexts'] })
console.log('rootDSE namingContexts →', root.searchEntries[0]?.namingContexts ?? root.searchEntries[0])

const r1 = await c.search('ou=Personnel,dc=societe,dc=local', { scope: 'sub', filter: '(objectClass=person)' })
console.log('objectClass=person (Personnel) →', r1.searchEntries.length, 'utilisateur(s)')

const r2 = await c.search('ou=Personnel,dc=societe,dc=local', { scope: 'sub', filter: '(uid=alice)' })
console.log('uid=alice →', r2.searchEntries.length, JSON.stringify({ dn: r2.searchEntries[0]?.dn, cn: r2.searchEntries[0]?.cn, mail: r2.searchEntries[0]?.mail }))

const r3 = await c.search('dc=societe,dc=local', { scope: 'one', filter: '(|(objectClass=organizationalUnit)(objectClass=container))' })
console.log('liste OU →', r3.searchEntries.map((e) => e.dn).sort())

const r4 = await c.search('dc=societe,dc=local', {
  scope: 'sub',
  filter: '(&(objectClass=person)(uid=stagiaire1))',
})
console.log('(&(objectClass=person)(uid=stagiaire1)) →', r4.searchEntries.length, r4.searchEntries[0]?.dn)

await c.unbind()

const c2 = new Client({ url: URL, timeout: 4000, connectTimeout: 4000 })
try { await c2.bind('uid=alice,ou=Personnel,dc=societe,dc=local', 'alice123'); console.log('bind alice + alice123 → OK') } catch { console.log('bind alice + alice123 → ÉCHEC (inattendu)') }
try { await c2.bind('uid=alice,ou=Personnel,dc=societe,dc=local', 'wrong'); console.log('bind alice + wrong → ACCEPTÉ (BUG)') } catch { console.log('bind alice + wrong → refusé (OK)') }
try { await c2.bind('uid=ghost,ou=Personnel,dc=societe,dc=local', 'x'); console.log('bind ghost → ACCEPTÉ (BUG)') } catch { console.log('bind ghost → refusé (OK)') }
await c2.unbind()
console.log('Vérification LDAP fictif terminée')
