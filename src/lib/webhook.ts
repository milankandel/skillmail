import { createHmac, timingSafeEqual } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export type DeliveryAttempt = {
  ok: boolean
  status: number | null
  body: string
  error?: string
}

/** Attempt n waits this long. Six attempts spans a bit over an hour. */
const BACKOFF_SECONDS = [0, 30, 120, 600, 1800, 3600]
export const MAX_ATTEMPTS = BACKOFF_SECONDS.length

export function nextAttemptAt(attempts: number): Date | null {
  if (attempts >= MAX_ATTEMPTS) return null
  return new Date(Date.now() + BACKOFF_SECONDS[attempts] * 1000)
}

export function sign(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

/** Exposed so the docs page can show receivers exactly how to verify. */
export function verify(secret: string, header: string, body: string, toleranceSeconds = 300): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]))
  const t = Number(parts.t)
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false
  const expected = Buffer.from(sign(secret, t, body))
  const actual = Buffer.from(parts.v1 ?? '')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

const BLOCKED_V4 = [
  /^127\./, /^10\./, /^192\.168\./, /^169\.254\./, /^0\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
]

/**
 * Destination URLs are operator-supplied, so the app would otherwise happily
 * POST to 169.254.169.254 and hand a cloud metadata token to whoever asked.
 */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Destination must be a valid absolute URL')
  }
  if (url.protocol !== 'https:') throw new Error('Destination must use https')

  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new Error('Destination may not point at a private host')
  }

  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address)
  for (const address of addresses) {
    if (BLOCKED_V4.some((re) => re.test(address)) || address === '::1' || address.startsWith('fc') || address.startsWith('fd')) {
      throw new Error('Destination resolves to a private address')
    }
  }
  return url
}

export async function deliver(input: {
  url: string
  secret: string
  headers: Record<string, string>
  idempotencyKey: string
  payload: unknown
}): Promise<DeliveryAttempt> {
  const body = JSON.stringify(input.payload)
  const timestamp = Math.floor(Date.now() / 1000)

  try {
    await assertPublicUrl(input.url)
  } catch (e) {
    return { ok: false, status: null, body: '', error: (e as Error).message }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)

  try {
    const res = await fetch(input.url, {
      method: 'POST',
      signal: controller.signal,
      redirect: 'error',
      headers: {
        ...input.headers,
        'content-type': 'application/json',
        'user-agent': 'MailHook/1.0',
        'x-mailhook-signature': `t=${timestamp},v1=${sign(input.secret, timestamp, body)}`,
        'x-mailhook-idempotency-key': input.idempotencyKey,
      },
      body,
    })
    const text = (await res.text()).slice(0, 2000)
    return { ok: res.ok, status: res.status, body: text }
  } catch (e) {
    return { ok: false, status: null, body: '', error: (e as Error).name === 'AbortError' ? 'timed out after 10s' : (e as Error).message }
  } finally {
    clearTimeout(timer)
  }
}
