import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * OAuth refresh tokens sit in Postgres indefinitely, so they are sealed with
 * AES-256-GCM before they get there. A leaked database dump is then inert
 * without APP_SECRET, which lives only in the runtime environment.
 */
function key(): Buffer {
  const secret = process.env.APP_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('APP_SECRET must be set to at least 32 characters')
  }
  return createHash('sha256').update(secret).digest()
}

export function seal(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.')
}

export function open(sealed: string): string {
  const [iv, tag, body] = sealed.split('.')
  if (!iv || !tag || !body) throw new Error('malformed ciphertext')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8')
}

export function newSecret(prefix = 'whsec'): string {
  return `${prefix}_${randomBytes(24).toString('base64url')}`
}
