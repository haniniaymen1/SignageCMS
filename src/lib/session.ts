/**
 * Session signée HMAC-SHA256 (Web Crypto uniquement — compatible Node et Edge).
 * Format du cookie : base64url(payload).signature_hex
 */

export const SESSION_COOKIE = 'cms_session'
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 jours
export const SESSION_MAX_AGE = SESSION_TTL_MS / 1000

export interface SessionPayload {
  uid: string
  role: string
  iat: number // epoch ms — émission (révocation serveur via tokenValidAfter)
  exp: number // epoch ms
}

function b64urlEncode(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): string {
  s = s.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  return atob(s)
}

async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = b64urlEncode(JSON.stringify(payload))
  const sig = await hmac(body, secret)
  return `${body}.${sig}`
}

export async function verifySession(token: string | undefined | null, secret: string): Promise<SessionPayload | null> {
  if (!token) return null
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = await hmac(body, secret)
  if (sig.length !== expected.length) return null
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i)
  if (diff !== 0) return null
  try {
    const payload = JSON.parse(b64urlDecode(body)) as SessionPayload
    if (!payload?.uid || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}
