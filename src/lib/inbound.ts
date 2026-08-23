import { randomBytes } from 'node:crypto'
import type { ParsedMessage } from './gmail'

export function newInboundToken(): string {
  // Lowercase and short enough to sit in front of an @ without looking absurd.
  return randomBytes(9).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function inboundAddress(token: string): string {
  return `${token}@${process.env.INBOUND_DOMAIN ?? 'inbound.skillmail.dev'}`
}

function splitAddress(raw: string): { address: string; name: string | null } {
  const match = raw.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/)
  return match
    ? { name: match[1].trim() || null, address: match[2].trim().toLowerCase() }
    : { name: null, address: raw.trim().toLowerCase() }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function decodeQuotedPrintable(input: string): string {
  return input
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}

/**
 * Enough MIME to read a delivered message. Full RFC 5322 handling belongs in a
 * library, but relays hand over well-formed mail and this covers the shapes
 * that actually arrive: single-part text, single-part HTML, and multipart with
 * a text alternative.
 */
export function parseRawMime(raw: string): ParsedMessage {
  const split = raw.indexOf('\r\n\r\n') >= 0 ? raw.indexOf('\r\n\r\n') : raw.indexOf('\n\n')
  const headerBlock = split >= 0 ? raw.slice(0, split) : raw
  let body = split >= 0 ? raw.slice(split).replace(/^(\r?\n){1,2}/, '') : ''

  const headers = new Map<string, string>()
  // Unfold continuation lines before splitting on the first colon.
  for (const line of headerBlock.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const at = line.indexOf(':')
    if (at > 0) headers.set(line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim())
  }

  const contentType = headers.get('content-type') ?? 'text/plain'
  const boundary = contentType.match(/boundary="?([^";]+)"?/i)?.[1]

  if (boundary) {
    const parts = body.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`))
    const plain = parts.find((p) => /content-type:\s*text\/plain/i.test(p))
    const html = parts.find((p) => /content-type:\s*text\/html/i.test(p))
    const chosen = plain ?? html
    if (chosen) {
      const inner = chosen.indexOf('\r\n\r\n') >= 0 ? chosen.indexOf('\r\n\r\n') : chosen.indexOf('\n\n')
      let text = inner >= 0 ? chosen.slice(inner).replace(/^(\r?\n){1,2}/, '') : chosen
      if (/content-transfer-encoding:\s*quoted-printable/i.test(chosen)) text = decodeQuotedPrintable(text)
      if (/content-transfer-encoding:\s*base64/i.test(chosen)) {
        text = Buffer.from(text.replace(/\s/g, ''), 'base64').toString('utf8')
      }
      body = plain ? text : stripHtml(text)
    }
  } else {
    if (/quoted-printable/i.test(headers.get('content-transfer-encoding') ?? '')) body = decodeQuotedPrintable(body)
    if (/base64/i.test(headers.get('content-transfer-encoding') ?? '')) {
      body = Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8')
    }
    if (/text\/html/i.test(contentType)) body = stripHtml(body)
  }

  const from = splitAddress(headers.get('from') ?? 'unknown@unknown')
  const date = headers.get('date')
  const received = date ? new Date(date) : new Date()

  return {
    providerId: headers.get('message-id') ?? `inbound-${Date.now()}-${randomBytes(4).toString('hex')}`,
    fromAddress: from.address,
    fromName: from.name,
    subject: headers.get('subject') ?? '(no subject)',
    snippet: body.slice(0, 200).replace(/\s+/g, ' ').trim(),
    body: body.slice(0, 20_000),
    receivedAt: Number.isNaN(received.getTime()) ? new Date() : received,
  }
}

type Relayed = Record<string, unknown>

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * Normalises the payload shapes of the common inbound relays. Each sends the
 * same email under different key names; rather than lock the product to one
 * vendor, every shape maps onto the same internal message.
 */
export function parseRelayPayload(payload: Relayed): ParsedMessage {
  // Postmark
  if ('FromFull' in payload || 'TextBody' in payload) {
    const fromFull = (payload.FromFull ?? {}) as { Email?: string; Name?: string }
    const body = str(payload.TextBody) || stripHtml(str(payload.HtmlBody))
    return {
      providerId: str(payload.MessageID) || `inbound-${Date.now()}`,
      fromAddress: (fromFull.Email || str(payload.From)).toLowerCase(),
      fromName: fromFull.Name || null,
      subject: str(payload.Subject) || '(no subject)',
      snippet: body.slice(0, 200).replace(/\s+/g, ' ').trim(),
      body: body.slice(0, 20_000),
      receivedAt: payload.Date ? new Date(str(payload.Date)) : new Date(),
    }
  }

  // Mailgun and SendGrid both use lowercase keys; SendGrid may include `email`
  // carrying the full raw MIME, which is the richest source when present.
  if (typeof payload.email === 'string' && payload.email.includes('\n')) return parseRawMime(payload.email)

  if ('body-plain' in payload || 'stripped-text' in payload || 'text' in payload) {
    const from = splitAddress(str(payload.from) || str(payload.sender))
    const body = str(payload['stripped-text']) || str(payload['body-plain']) || str(payload.text) || stripHtml(str(payload.html))
    return {
      providerId: str(payload['Message-Id']) || str(payload.messageId) || `inbound-${Date.now()}`,
      fromAddress: from.address,
      fromName: from.name,
      subject: str(payload.subject) || '(no subject)',
      snippet: body.slice(0, 200).replace(/\s+/g, ' ').trim(),
      body: body.slice(0, 20_000),
      receivedAt: payload.timestamp ? new Date(Number(payload.timestamp) * 1000) : new Date(),
    }
  }

  // Generic: whatever a Cloudflare Worker or a curl test chooses to send.
  const from = splitAddress(str(payload.from) || 'unknown@unknown')
  const body = str(payload.body) || str(payload.text) || stripHtml(str(payload.html))
  if (!body) throw new Error('payload carried no readable body')

  return {
    providerId: str(payload.messageId) || `inbound-${Date.now()}-${randomBytes(4).toString('hex')}`,
    fromAddress: from.address,
    fromName: from.name,
    subject: str(payload.subject) || '(no subject)',
    snippet: body.slice(0, 200).replace(/\s+/g, ' ').trim(),
    body: body.slice(0, 20_000),
    receivedAt: new Date(),
  }
}
