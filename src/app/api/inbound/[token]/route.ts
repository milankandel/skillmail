import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { mailboxes, messages } from '@/db/schema'
import { parseRawMime, parseRelayPayload } from '@/lib/inbound'
import { runSkills } from '@/lib/pipeline'
import type { ParsedMessage } from '@/lib/gmail'

export const dynamic = 'force-dynamic'
/** Relays retry aggressively; refuse anything implausible for one email. */
const MAX_BYTES = 2_000_000

async function readMessage(request: NextRequest): Promise<ParsedMessage> {
  const contentType = request.headers.get('content-type') ?? ''
  const raw = await request.text()
  if (raw.length > MAX_BYTES) throw new Error('payload too large')
  if (!raw.trim()) throw new Error('empty payload')

  if (contentType.includes('application/json')) return parseRelayPayload(JSON.parse(raw))

  if (contentType.includes('application/x-www-form-urlencoded')) {
    return parseRelayPayload(Object.fromEntries(new URLSearchParams(raw)))
  }

  if (contentType.includes('multipart/form-data')) {
    const form = await new Response(raw, { headers: { 'content-type': contentType } }).formData()
    const flat: Record<string, unknown> = {}
    for (const [k, v] of form.entries()) if (typeof v === 'string') flat[k] = v
    return parseRelayPayload(flat)
  }

  // message/rfc822, text/plain, or a relay that sent no content type at all.
  return parseRawMime(raw)
}

/**
 * Push endpoint for relayed mail. The token in the path is the only
 * credential, so it is treated as a secret: unknown tokens get a flat 404 with
 * no hint about whether the mailbox exists.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params

  const [mailbox] = await db
    .select()
    .from(mailboxes)
    .where(and(eq(mailboxes.inboundToken, token), eq(mailboxes.provider, 'inbound')))
    .limit(1)
  if (!mailbox) return NextResponse.json({ error: 'not found' }, { status: 404 })

  let parsed: ParsedMessage
  try {
    parsed = await readMessage(request)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }

  const [stored] = await db
    .insert(messages)
    .values({
      userId: mailbox.userId,
      mailboxId: mailbox.id,
      providerId: parsed.providerId,
      fromAddress: parsed.fromAddress,
      fromName: parsed.fromName,
      subject: parsed.subject,
      snippet: parsed.snippet,
      body: parsed.body,
      receivedAt: parsed.receivedAt,
    })
    .onConflictDoNothing()
    .returning()

  // A relay redelivering the same Message-Id must not re-extract or re-bill.
  if (!stored) return NextResponse.json({ status: 'duplicate', messageId: parsed.providerId })

  await db.update(mailboxes).set({ lastSyncedAt: new Date() }).where(eq(mailboxes.id, mailbox.id))

  const summary = await runSkills(mailbox.userId, [stored])
  return NextResponse.json({ status: 'accepted', messageId: stored.id, ...summary })
}

export async function GET() {
  return NextResponse.json({ error: 'POST an email to this address' }, { status: 405 })
}
