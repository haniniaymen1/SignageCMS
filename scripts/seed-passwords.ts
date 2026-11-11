/**
 * Définit un mot de passe initial pour les comptes existants (idempotent :
 * seuls les comptes SANS mot de passe sont traités).
 * Exécution : bun scripts/seed-passwords.ts
 */
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/password'

const db = new PrismaClient()

const DEFAULTS: Record<string, string> = {
  admin: 'admin123',
  'marie.d': 'marie123',
  'paul.m': 'paul123',
  'sophie.b': 'sophie123',
  'lea.m': 'lea123',
}

async function main() {
  for (const [username, pwd] of Object.entries(DEFAULTS)) {
    const u = await db.user.findUnique({ where: { username } })
    if (!u) {
      console.log(`× compte absent : ${username}`)
      continue
    }
    if (u.password) {
      console.log(`• déjà protégé : ${username}`)
      continue
    }
    await db.user.update({ where: { id: u.id }, data: { password: hashPassword(pwd) } })
    console.log(`✓ mot de passe défini : ${username} / ${pwd}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
