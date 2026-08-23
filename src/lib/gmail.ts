/**
 * A thin Gmail REST client. The googleapis package pulls in a multi-megabyte
 * discovery bundle for the four endpoints this app actually calls, so these
 * are plain fetches instead.
 */

const OAUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN = 'https://oauth2.googleapis.com/token'
const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

/** Read-only. The app never needs send, modify, or delete. */
export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

export type Tokens = {
  accessToken: string
  refreshToken?: string
  expiresAt: Date
}

export type ParsedMessage = {
  providerId: string
  fromAddress: string
  fromName: string | null
  subject: string
  snippet: string
  body: string
  receivedAt: Date
}

function credentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = `${process.env.APP_URL ?? 'http://localhost:3000'}/api/mailboxes/google/callback`
  if (!clientId || !clientSecret) throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set')
  return { clientId, clientSecret, redirectUri }
}

export function isGmailConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}

export function authorizeUrl(state: string): string {
  const { clientId, redirectUri } = credentials()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    include_granted_scopes: 'true',
    // Without this Google withholds the refresh token on re-consent, and the
    // connection silently dies an hour later.
    prompt: 'consent',
    state,
  })
  return `${OAUTH}?${params}`
}

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
  const json = (await res.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    error_description?: string
    error?: string
  }
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description ?? json.error ?? `token exchange failed (${res.status})`)
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + (json.expires_in ?? 3600) * 1000),
  }
}

export async function exchangeCode(code: string): Promise<Tokens> {
  const { clientId, clientSecret, redirectUri } = credentials()
  return tokenRequest({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })
}

export async function refresh(refreshToken: string): Promise<Tokens> {
  const { clientId, clientSecret } = credentials()
  return tokenRequest({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  })
}

export async function profileAddress(accessToken: string): Promise<string> {
  const res = await fetch(`${API}/profile`, { headers: { authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new Error(`gmail profile failed (${res.status})`)
  const json = (await res.json()) as { emailAddress: string }
  return json.emailAddress
}

export async function listMessageIds(accessToken: string, opts: { query?: string; max?: number } = {}): Promise<string[]> {
  const params = new URLSearchParams({ maxResults: String(opts.max ?? 25) })
  if (opts.query) params.set('q', opts.query)
  const res = await fetch(`${API}/messages?${params}`, { headers: { authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new Error(`gmail list failed (${res.status})`)
  const json = (await res.json()) as { messages?: { id: string }[] }
  return (json.messages ?? []).map((m) => m.id)
}

type GmailPart = {
  mimeType?: string
  body?: { data?: string; size?: number }
  parts?: GmailPart[]
}

function decode(data?: string): string {
  if (!data) return ''
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

/** Depth-first walk preferring text/plain, falling back to de-tagged HTML. */
function extractBody(part: GmailPart): string {
  if (part.mimeType === 'text/plain' && part.body?.data) return decode(part.body.data)
  for (const child of part.parts ?? []) {
    const found = extractBody(child)
    if (found) return found
  }
  if (part.mimeType === 'text/html' && part.body?.data) {
    return decode(part.body.data)
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }
  return ''
}

export async function getMessage(accessToken: string, id: string): Promise<ParsedMessage> {
  const res = await fetch(`${API}/messages/${id}?format=full`, { headers: { authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new Error(`gmail get failed (${res.status})`)
  const json = (await res.json()) as {
    id: string
    snippet?: string
    internalDate?: string
    payload?: GmailPart & { headers?: { name: string; value: string }[] }
  }

  const headers = new Map((json.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]))
  const rawFrom = headers.get('from') ?? 'unknown@unknown'
  const match = rawFrom.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/)

  return {
    providerId: json.id,
    fromName: match ? match[1].trim() || null : null,
    fromAddress: (match ? match[2] : rawFrom).trim().toLowerCase(),
    subject: headers.get('subject') ?? '(no subject)',
    snippet: json.snippet ?? '',
    body: (extractBody(json.payload ?? {}) || json.snippet || '').slice(0, 20_000),
    receivedAt: new Date(Number(json.internalDate ?? Date.now())),
  }
}
