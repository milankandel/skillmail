import assert from 'node:assert/strict'
import test from 'node:test'
import { parseRawMime, parseRelayPayload, newInboundToken, inboundAddress } from '../src/lib/inbound.ts'

test('raw MIME: plain text with folded headers', () => {
  const raw = [
    'From: "Dana Whitfield" <dana@northwindfreight.com>',
    'To: abc123@inbound.skillmail.dev',
    'Subject: RFQ — 3 loads,',
    ' Savannah to Atlanta',
    'Message-ID: <msg-1@northwind>',
    'Date: Fri, 21 Aug 2026 10:00:00 +0000',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'We have three loads out of Savannah. Budget $780 per load.',
  ].join('\r\n')

  const m = parseRawMime(raw)
  assert.equal(m.fromAddress, 'dana@northwindfreight.com')
  assert.equal(m.fromName, 'Dana Whitfield')
  assert.equal(m.subject, 'RFQ — 3 loads, Savannah to Atlanta')
  assert.equal(m.providerId, '<msg-1@northwind>')
  assert.match(m.body, /Budget \$780/)
})

test('raw MIME: multipart prefers text/plain over html', () => {
  const raw = [
    'From: ops@harborline.co',
    'Subject: Two reefers',
    'Content-Type: multipart/alternative; boundary="XYZ"',
    '',
    '--XYZ',
    'Content-Type: text/plain',
    '',
    'Two reefer containers, setpoint 34F.',
    '--XYZ',
    'Content-Type: text/html',
    '',
    '<p>Two <b>reefer</b> containers</p>',
    '--XYZ--',
  ].join('\r\n')

  const m = parseRawMime(raw)
  assert.match(m.body, /setpoint 34F/)
  assert.doesNotMatch(m.body, /<b>/)
})

test('raw MIME: quoted-printable decoding', () => {
  const raw = [
    'From: ap@cascade.com',
    'Subject: Invoice',
    'Content-Type: text/plain',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'Amount due =24=38=2C730 by =',
    'Friday',
  ].join('\r\n')

  const m = parseRawMime(raw)
  assert.match(m.body, /\$8,730 by Friday/)
})

test('raw MIME: html-only falls back to stripped text', () => {
  const raw = ['From: x@y.com', 'Subject: s', 'Content-Type: text/html', '', '<div>Hello <b>there</b></div>'].join('\r\n')
  assert.match(parseRawMime(raw).body, /Hello there/)
})

test('relay: postmark shape', () => {
  const m = parseRelayPayload({
    FromFull: { Email: 'Dana@Northwind.com', Name: 'Dana' },
    Subject: 'Quote please',
    TextBody: 'Three loads.',
    MessageID: 'pm-1',
    Date: '2026-08-21T10:00:00Z',
  })
  assert.equal(m.fromAddress, 'dana@northwind.com')
  assert.equal(m.providerId, 'pm-1')
  assert.equal(m.body, 'Three loads.')
})

test('relay: mailgun form shape', () => {
  const m = parseRelayPayload({
    from: 'Priya Raman <priya@harborline.co>',
    subject: 'Reefers',
    'body-plain': 'Two reefers to Riverside.',
    'Message-Id': '<mg-9@harborline>',
    timestamp: '1755772800',
  })
  assert.equal(m.fromAddress, 'priya@harborline.co')
  assert.equal(m.fromName, 'Priya Raman')
  assert.equal(m.providerId, '<mg-9@harborline>')
})

test('relay: generic curl shape', () => {
  const m = parseRelayPayload({ from: 'test@example.com', subject: 'Hi', body: 'A body.' })
  assert.equal(m.fromAddress, 'test@example.com')
  assert.equal(m.body, 'A body.')
})

test('relay: rejects a payload with no body', () => {
  assert.throws(() => parseRelayPayload({ from: 'x@y.com', subject: 'empty' }))
})

test('inbound tokens are lowercase alphanumeric and unique', () => {
  const a = newInboundToken()
  assert.match(a, /^[a-z0-9]{6,16}$/)
  assert.notEqual(a, newInboundToken())
  assert.match(inboundAddress(a), new RegExp(`^${a}@`))
})
