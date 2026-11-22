import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'

/**
 * Hachage de mot de passe avec scrypt (crypto intégré Node — aucune dépendance externe).
 * Format stocké en base : scrypt:<salt hex>:<hash hex>
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `scrypt:${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false
  const [scheme, salt, hash] = stored.split(':')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  try {
    const test = scryptSync(password, salt, 64)
    const orig = Buffer.from(hash, 'hex')
    return test.length === orig.length && timingSafeEqual(test, orig)
  } catch {
    return false
  }
}
