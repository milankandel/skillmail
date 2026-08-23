import assert from 'node:assert/strict'
import test from 'node:test'
import { assertPublicUrl, nextAttemptAt, sign, verify, MAX_ATTEMPTS } from '../src/lib/webhook.ts'

const SECRET = 'whsec_test_abcdefghijklmnop'

test('signature round-trips', () => {
  const body = JSON.stringify({ type: 'record.extracted', record: { company: 'Northwind' } })
  const t = Math.floor(Date.now() / 1000)
  assert.equal(verify(SECRET, `t=${t},v1=${sign(SECRET, t, body)}`, body), true)
})

test('signature rejects a tampered body', () => {
  const t = Math.floor(Date.now() / 1000)
  const header = `t=${t},v1=${sign(SECRET, t, '{"amount":100}')}`
  assert.equal(verify(SECRET, header, '{"amount":10000}'), false)
})

test('signature rejects the wrong secret', () => {
  const body = '{"a":1}'
  const t = Math.floor(Date.now() / 1000)
  assert.equal(verify('whsec_someone_else', `t=${t},v1=${sign(SECRET, t, body)}`, body), false)
})

test('signature rejects a replay outside the tolerance window', () => {
  const body = '{"a":1}'
  const t = Math.floor(Date.now() / 1000) - 900
  assert.equal(verify(SECRET, `t=${t},v1=${sign(SECRET, t, body)}`, body), false)
})

test('backoff lengthens then gives up', async () => {
  const first = nextAttemptAt(1)!.getTime() - Date.now()
  const later = nextAttemptAt(4)!.getTime() - Date.now()
  assert.ok(later > first)
  assert.equal(nextAttemptAt(MAX_ATTEMPTS), null)
})

test('destination guard rejects private and non-https targets', async () => {
  const bad = [
    'http://api.example.com/hook',
    'https://localhost/hook',
    'https://127.0.0.1/hook',
    'https://169.254.169.254/latest/meta-data',
    'https://10.0.0.5/hook',
    'https://192.168.1.10/hook',
    'https://172.16.4.4/hook',
    'not-a-url',
  ]
  for (const url of bad) {
    await assert.rejects(assertPublicUrl(url), undefined, `expected ${url} to be rejected`)
  }
})

test('destination guard accepts a public https endpoint', async () => {
  const url = await assertPublicUrl('https://example.com/hooks/mailhook')
  assert.equal(url.hostname, 'example.com')
})
