import assert from 'node:assert/strict'
import test from 'node:test'

process.env.APP_SECRET = 'a'.repeat(48)
const { newSecret, open, seal } = await import('../src/lib/crypto.ts')

test('sealed tokens round-trip', () => {
  const token = '1//0gRefreshTokenExampleValue'
  assert.equal(open(seal(token)), token)
})

test('ciphertext differs across calls for the same plaintext', () => {
  assert.notEqual(seal('same'), seal('same'))
})

test('tampering with the ciphertext fails the auth tag', () => {
  const sealed = seal('secret-value')
  const [iv, tag, body] = sealed.split('.')
  const flipped = body.slice(0, -1) + (body.at(-1) === 'A' ? 'B' : 'A')
  assert.throws(() => open([iv, tag, flipped].join('.')))
})

test('generated secrets are prefixed and unique', () => {
  const a = newSecret()
  assert.match(a, /^whsec_[A-Za-z0-9_-]{32}$/)
  assert.notEqual(a, newSecret())
})
