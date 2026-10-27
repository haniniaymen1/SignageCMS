// Serveur LDAP fictif pour les tests E2E — annuaire avec plusieurs OUs
// Usage : node scripts/mock-ldap-server.mjs  (port 1389)
import ldap from 'ldapjs'

const BASE = 'dc=societe,dc=local'
const PORT = process.env.LDAP_MOCK_PORT || 1389

const TREE = new Map() // clé : DN normalisé minuscule → { dn, attrs }
const norm = (s) => ldap.parseDN(s).toString().toLowerCase()

function add(dn, attrs) {
  TREE.set(norm(dn), { dn: ldap.parseDN(dn).toString(), attrs })
}

const PERSON = ['top', 'person', 'organizationalPerson', 'inetOrgPerson']

// Racine + OUs
add(BASE, { objectclass: ['top', 'domain'], dc: 'societe' })
add(`ou=Personnel,${BASE}`, { objectclass: ['top', 'organizationalUnit'], ou: 'Personnel' })
add(`ou=Stagiaires,${BASE}`, { objectclass: ['top', 'organizationalUnit'], ou: 'Stagiaires' })
add(`ou=Direction,${BASE}`, { objectclass: ['top', 'organizationalUnit'], ou: 'Direction' })
add(`ou=Services,${BASE}`, { objectclass: ['top', 'organizationalUnit'], ou: 'Services' })

// Compte technique (lecture)
add(`cn=service-lecture,ou=Services,${BASE}`, {
  objectclass: PERSON, cn: 'service-lecture', userpassword: 'service-annuaire-2024',
})

// OU Personnel : 3 utilisateurs
add(`uid=alice,ou=Personnel,${BASE}`, {
  objectclass: PERSON, uid: 'alice', cn: 'Alice Durand', sn: 'Durand',
  mail: 'alice@societe.local', userpassword: 'alice123',
})
add(`uid=bob,ou=Personnel,${BASE}`, {
  objectclass: PERSON, uid: 'bob', cn: 'Bob Leroy', sn: 'Leroy',
  mail: 'bob@societe.local', userpassword: 'bob123',
})
add(`uid=carole,ou=Personnel,${BASE}`, {
  objectclass: PERSON, uid: 'carole', cn: 'Carole Petit', sn: 'Petit',
  mail: 'carole@societe.local', userpassword: 'carole123',
})

// OU Stagiaires : 1 utilisateur (test création auto à la connexion)
add(`uid=stagiaire1,ou=Stagiaires,${BASE}`, {
  objectclass: PERSON, uid: 'stagiaire1', cn: 'Marc Stage', sn: 'Stage',
  mail: 'marc.stage@societe.local', userpassword: 'stage123',
})

// OU Direction : 1 utilisateur (test import dans une autre OU)
add(`uid=d.dupont,ou=Direction,${BASE}`, {
  objectclass: PERSON, uid: 'd.dupont', cn: 'Daniel Dupont', sn: 'Dupont',
  mail: 'daniel.dupont@societe.local', userpassword: 'direction123',
})

// ---------- Handlers ----------

const server = ldap.createServer()

// Liaison : anonyme ou DN connu (une seule route « » = tous les DN)
server.bind('', (req, res, next) => {
  const dn = req.dn ? req.dn.toString() : ''
  if (!dn) { res.end(); return next() } // anonyme
  const entry = TREE.get(norm(dn))
  if (entry && entry.attrs.userpassword === req.credentials) {
    res.end()
    return next()
  }
  return next(new ldap.InvalidCredentialsError())
})

// Recherche : racine (root DSE) + arborescence complète
server.search('', (req, res, next) => {
  // ldapjs 3 : scope numérique (0=base, 1=one, 2=sub) — tolère aussi les chaînes
  const scope = typeof req.scope === 'string' ? req.scope : (['base', 'one', 'sub'][req.scope] ?? 'sub')
  if (process.env.LDAP_MOCK_DEBUG) console.log(`[mock] SEARCH base="${req.dn?.toString()}" scope=${req.scope}→${scope} filter=${req.filter?.toString()}`)
  const base = req.dn ? norm(req.dn.toString()) : ''
  if (!base) {
    res.send({ dn: '', attributes: { namingcontexts: [BASE], supportedldapversion: ['3'] } })
    res.end()
    return next()
  }
  for (const entry of TREE.values()) {
    const en = norm(entry.dn)
    let include = false
    if (en === base) {
      include = scope === 'base' || scope === 'sub'
    } else if (en.endsWith(',' + base)) {
      if (scope === 'sub') include = true
      else if (scope === 'one') include = !en.slice(0, en.length - base.length - 1).includes(',')
    }
    if (!include) continue
    if (req.filter && !req.filter.matches(entry.attrs)) continue
    const { userpassword, ...safe } = entry.attrs
    if (process.env.LDAP_MOCK_DEBUG) console.log(`[mock] envoi ${entry.dn}`)
    res.send({ dn: entry.dn, attributes: safe })
  }
  res.end()
  next()
})

server.listen(PORT, () => {
  console.log(`Serveur LDAP fictif en écoute sur ldap://127.0.0.1:${PORT} — ${BASE} (${TREE.size} entrées)`)
})

server.on('error', (e) => {
  console.error('Erreur serveur LDAP fictif:', e.message)
  process.exit(1)
})
