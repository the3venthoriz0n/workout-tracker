// Seals a user's own AI key for storage: AES-256-GCM under a key derived from BETTER_AUTH_SECRET, so a
// database dump alone does not reveal it. Rotating the secret makes stored keys unreadable (they read as
// "no key" and the user pastes theirs again). Output is `v1.<iv>.<tag>.<ciphertext>`, each part base64url.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

const derive = (secret: string): Buffer => Buffer.from(hkdfSync('sha256', secret, 'workout-tracker', 'user-ai-key-v1', 32))
const b64 = (b: Buffer) => b.toString('base64url')

export function sealKey(secret: string, plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', derive(secret), iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', b64(iv), b64(cipher.getAuthTag()), b64(body)].join('.')
}

/** The key, or null when the text is not something this secret sealed. */
export function openKey(secret: string, sealed: string): string | null {
  try {
    const [v, iv, tag, body] = sealed.split('.')
    if (v !== 'v1' || !iv || !tag || !body) return null
    const d = createDecipheriv('aes-256-gcm', derive(secret), Buffer.from(iv, 'base64url'))
    d.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8')
  } catch {
    return null
  }
}
