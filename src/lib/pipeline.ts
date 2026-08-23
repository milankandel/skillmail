import { and, asc, eq, inArray, isNotNull, lte } from 'drizzle-orm'
import { db } from '@/db'
import { deliveries, destinations, extractions, extractors, mailboxes, messages } from '@/db/schema'
import { open, seal } from './crypto'
import { DEMO_MESSAGES } from './demo-mailbox'
import { extract } from './extract'
import * as gmail from './gmail'
import { MAX_ATTEMPTS, deliver, nextAttemptAt } from './webhook'

export type SyncSummary = {
  fetched: number
  stored: number
  extracted: number
  skipped: number
  delivered: number
  failed: number
}

/** Refreshes the access token in place when it is within a minute of expiry. */
async function usableAccessToken(mailbox: typeof mailboxes.$inferSelect): Promise<string> {
  const fresh = mailbox.expiresAt && mailbox.expiresAt.getTime() - Date.now() > 60_000
  if (fresh && mailbox.accessToken) return open(mailbox.accessToken)

  if (!mailbox.refreshToken) {
    await db.update(mailboxes).set({ status: 'reauth_required' }).where(eq(mailboxes.id, mailbox.id))
    throw new Error('mailbox has no refresh token; reconnect it')
  }

  try {
    const tokens = await gmail.refresh(open(mailbox.refreshToken))
    await db
      .update(mailboxes)
      .set({ accessToken: seal(tokens.accessToken), expiresAt: tokens.expiresAt, status: 'active' })
      .where(eq(mailboxes.id, mailbox.id))
    return tokens.accessToken
  } catch (e) {
    await db.update(mailboxes).set({ status: 'reauth_required' }).where(eq(mailboxes.id, mailbox.id))
    throw e
  }
}

async function fetchNew(mailbox: typeof mailboxes.$inferSelect) {
  if (mailbox.provider === 'demo') return DEMO_MESSAGES

  const accessToken = await usableAccessToken(mailbox)
  const ids = await gmail.listMessageIds(accessToken, { query: 'in:inbox newer_than:14d', max: 25 })
  if (!ids.length) return []

  const known = await db
    .select({ providerId: messages.providerId })
    .from(messages)
    .where(and(eq(messages.mailboxId, mailbox.id), inArray(messages.providerId, ids)))
  const seen = new Set(known.map((k) => k.providerId))

  const wanted = ids.filter((id) => !seen.has(id))
  return Promise.all(wanted.map((id) => gmail.getMessage(accessToken, id)))
}

function matches(extractor: typeof extractors.$inferSelect, message: { fromAddress: string; subject: string }) {
  if (extractor.matchFrom && !message.fromAddress.toLowerCase().includes(extractor.matchFrom.toLowerCase())) return false
  if (extractor.matchSubject && !message.subject.toLowerCase().includes(extractor.matchSubject.toLowerCase())) return false
  return true
}

/**
 * Fetch → store → extract → deliver, for one mailbox. Every stage is
 * idempotent on its natural key so a re-run costs nothing and duplicates
 * nothing.
 */
export async function syncMailbox(userId: string, mailboxId: string): Promise<SyncSummary> {
  const summary: SyncSummary = { fetched: 0, stored: 0, extracted: 0, skipped: 0, delivered: 0, failed: 0 }

  const [mailbox] = await db
    .select()
    .from(mailboxes)
    .where(and(eq(mailboxes.id, mailboxId), eq(mailboxes.userId, userId)))
    .limit(1)
  if (!mailbox) throw new Error('mailbox not found')

  const incoming = await fetchNew(mailbox)
  summary.fetched = incoming.length

  const stored = incoming.length
    ? await db
        .insert(messages)
        .values(
          incoming.map((m) => ({
            userId,
            mailboxId: mailbox.id,
            providerId: m.providerId,
            fromAddress: m.fromAddress,
            fromName: m.fromName,
            subject: m.subject,
            snippet: m.snippet,
            body: m.body,
            receivedAt: m.receivedAt,
          })),
        )
        .onConflictDoNothing()
        .returning()
    : []
  summary.stored = stored.length

  await db.update(mailboxes).set({ lastSyncedAt: new Date() }).where(eq(mailboxes.id, mailbox.id))

  const [rules, targets] = await Promise.all([
    db.select().from(extractors).where(and(eq(extractors.userId, userId), eq(extractors.active, true))),
    db.select().from(destinations).where(and(eq(destinations.userId, userId), eq(destinations.active, true))),
  ])
  if (!rules.length) return summary

  for (const message of stored) {
    for (const rule of rules) {
      if (!matches(rule, message)) continue

      let row: typeof extractions.$inferInsert
      try {
        const result = await extract({
          instruction: rule.instruction,
          fields: rule.fields,
          message,
        })
        row = {
          userId,
          messageId: message.id,
          extractorId: rule.id,
          status: result.status,
          data: result.data,
          confidence: result.confidence,
          reasoning: result.reasoning,
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        }
      } catch (e) {
        row = { userId, messageId: message.id, extractorId: rule.id, status: 'failed', error: (e as Error).message }
      }

      const [saved] = await db.insert(extractions).values(row).onConflictDoNothing().returning()
      if (!saved) continue
      if (saved.status === 'skipped') summary.skipped++
      if (saved.status !== 'ok') continue
      summary.extracted++

      for (const target of targets) {
        const [pending] = await db
          .insert(deliveries)
          .values({ userId, extractionId: saved.id, destinationId: target.id, status: 'pending' })
          .returning()
        if (await attemptDelivery(pending.id)) summary.delivered++
        else summary.failed++
      }
    }
  }

  return summary
}

export function payloadFor(input: {
  extractor: typeof extractors.$inferSelect
  message: typeof messages.$inferSelect
  extraction: typeof extractions.$inferSelect
}) {
  return {
    type: 'record.extracted',
    extractor: input.extractor.name,
    record: input.extraction.data,
    confidence: input.extraction.confidence,
    reasoning: input.extraction.reasoning,
    source: {
      messageId: input.message.id,
      from: input.message.fromAddress,
      fromName: input.message.fromName,
      subject: input.message.subject,
      receivedAt: input.message.receivedAt.toISOString(),
    },
    extractedAt: input.extraction.createdAt.toISOString(),
  }
}

/** Runs one delivery attempt and records the outcome. Returns success. */
export async function attemptDelivery(deliveryId: string): Promise<boolean> {
  const [row] = await db
    .select({ delivery: deliveries, destination: destinations, extraction: extractions })
    .from(deliveries)
    .innerJoin(destinations, eq(deliveries.destinationId, destinations.id))
    .innerJoin(extractions, eq(deliveries.extractionId, extractions.id))
    .where(eq(deliveries.id, deliveryId))
    .limit(1)
  if (!row) throw new Error('delivery not found')

  const [message] = await db.select().from(messages).where(eq(messages.id, row.extraction.messageId)).limit(1)
  const [extractor] = await db.select().from(extractors).where(eq(extractors.id, row.extraction.extractorId)).limit(1)

  const attempt = await deliver({
    url: row.destination.url,
    secret: row.destination.secret,
    headers: row.destination.headers,
    idempotencyKey: row.delivery.id,
    payload: payloadFor({ extractor, message, extraction: row.extraction }),
  })

  const attempts = row.delivery.attempts + 1
  const retryAt = attempt.ok ? null : nextAttemptAt(attempts)

  await db
    .update(deliveries)
    .set({
      attempts,
      status: attempt.ok ? 'delivered' : retryAt ? 'pending' : 'failed',
      responseStatus: attempt.status,
      responseBody: attempt.error ?? attempt.body,
      nextAttemptAt: retryAt,
      deliveredAt: attempt.ok ? new Date() : null,
    })
    .where(eq(deliveries.id, deliveryId))

  return attempt.ok
}

/** Drains everything whose backoff has elapsed. Called by the cron route. */
export async function drainRetries(limit = 25): Promise<{ retried: number; delivered: number }> {
  const due = await db
    .select({ id: deliveries.id })
    .from(deliveries)
    .where(and(eq(deliveries.status, 'pending'), isNotNull(deliveries.nextAttemptAt), lte(deliveries.nextAttemptAt, new Date())))
    .orderBy(asc(deliveries.nextAttemptAt))
    .limit(limit)

  let delivered = 0
  for (const d of due) {
    if (await attemptDelivery(d.id)) delivered++
  }
  return { retried: due.length, delivered }
}

export { MAX_ATTEMPTS }
