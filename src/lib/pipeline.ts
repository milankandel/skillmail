import { and, asc, count, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm'
import { db } from '@/db'
import { deliveries, destinations, extractions, mailboxes, messages, skills } from '@/db/schema'
import { open, seal } from './crypto'
import { DEMO_MESSAGES } from './demo-mailbox'
import { extract } from './extract'
import * as gmail from './gmail'
import type { ParsedMessage } from './gmail'
import { MAX_ATTEMPTS, deliver, nextAttemptAt } from './webhook'

/**
 * Hard per-sync message ceiling. This deployment is a public demo on a
 * free-tier LLM key — nobody's full inbox should ever flow through it.
 */
const SYNC_MAX = Number(process.env.SYNC_MAX_MESSAGES ?? 50)

export type SyncSummary = {
  fetched: number
  stored: number
  extracted: number
  skipped: number
  delivered: number
  failed: number
  /** True when the mailbox held more than one sync could cover. */
  truncated: boolean
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

/**
 * Chooses the cheapest correct strategy: replay Gmail's history feed when a
 * cursor exists, otherwise a bounded search over the backfill window. Returns
 * the messages plus the cursor to persist.
 */
async function fetchNew(
  mailbox: typeof mailboxes.$inferSelect,
): Promise<{ messages: ParsedMessage[]; historyId: string | null; truncated: boolean }> {
  if (mailbox.provider !== 'gmail') return { messages: [], historyId: null, truncated: false }

  const accessToken = await usableAccessToken(mailbox)

  let candidateIds: string[] = []
  let truncated = false
  let cursor: string | null = null

  if (mailbox.historyId) {
    const history = await gmail.listHistorySince(accessToken, mailbox.historyId)
    if (history.expired) {
      // Cursor aged out of Gmail's ~7-day history window; fall back to search.
      const search = await gmail.listMessageIds(accessToken, { query: `${mailbox.syncQuery} newer_than:7d`, max: SYNC_MAX })
      candidateIds = search.ids
      truncated = search.truncated
      cursor = await gmail.currentHistoryId(accessToken)
    } else {
      candidateIds = history.ids
      cursor = history.historyId ?? mailbox.historyId
    }
  } else {
    const search = await gmail.listMessageIds(accessToken, {
      query: `${mailbox.syncQuery} newer_than:${mailbox.backfillDays}d`,
      max: SYNC_MAX,
    })
    candidateIds = search.ids
    truncated = search.truncated
    cursor = await gmail.currentHistoryId(accessToken)
  }

  if (!candidateIds.length) return { messages: [], historyId: cursor, truncated }

  // Gmail ids are stable, so anything already stored is skipped before the
  // expensive per-message fetch rather than after it.
  const known = new Set<string>()
  for (let i = 0; i < candidateIds.length; i += 200) {
    const slice = candidateIds.slice(i, i + 200)
    const rows = await db
      .select({ providerId: messages.providerId })
      .from(messages)
      .where(and(eq(messages.mailboxId, mailbox.id), inArray(messages.providerId, slice)))
    for (const r of rows) known.add(r.providerId)
  }

  const wanted = candidateIds.filter((id) => !known.has(id))
  const fetched: ParsedMessage[] = []

  // Bounded concurrency: Gmail rate-limits hard, and a 500-wide Promise.all
  // reliably trips it.
  for (let i = 0; i < wanted.length; i += 8) {
    const batch = await Promise.allSettled(wanted.slice(i, i + 8).map((id) => gmail.getMessage(accessToken, id)))
    for (const result of batch) {
      if (result.status === 'fulfilled') fetched.push(result.value)
    }
  }

  return { messages: fetched, historyId: cursor, truncated }
}

function matches(skill: typeof skills.$inferSelect, message: { fromAddress: string; subject: string }) {
  if (skill.matchFrom && !message.fromAddress.toLowerCase().includes(skill.matchFrom.toLowerCase())) return false
  if (skill.matchSubject && !message.subject.toLowerCase().includes(skill.matchSubject.toLowerCase())) return false
  return true
}

/**
 * Fetch → store → extract → deliver, for one mailbox. Every stage is
 * idempotent on its natural key so a re-run costs nothing and duplicates
 * nothing.
 */
export async function syncMailbox(userId: string, mailboxId: string): Promise<SyncSummary> {
  const summary: SyncSummary = { fetched: 0, stored: 0, extracted: 0, skipped: 0, delivered: 0, failed: 0, truncated: false }

  const [mailbox] = await db
    .select()
    .from(mailboxes)
    .where(and(eq(mailboxes.id, mailboxId), eq(mailboxes.userId, userId)))
    .limit(1)
  if (!mailbox) throw new Error('mailbox not found')

  let incoming: ParsedMessage[]
  let cursor: string | null = null
  let truncated = false

  if (mailbox.provider === 'demo') {
    incoming = DEMO_MESSAGES
  } else if (mailbox.provider === 'inbound') {
    // Inbound mail is pushed by the relay, never pulled. A sync re-runs
    // skills over anything already received.
    incoming = []
  } else {
    const result = await fetchNew(mailbox)
    incoming = result.messages
    cursor = result.historyId
    truncated = result.truncated
  }

  summary.fetched = incoming.length
  summary.truncated = truncated

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

  await db
    .update(mailboxes)
    .set({ lastSyncedAt: new Date(), lastSyncError: null, ...(cursor ? { historyId: cursor } : {}) })
    .where(eq(mailboxes.id, mailbox.id))

  Object.assign(summary, await runSkills(userId, stored, summary))
  return summary
}

/**
 * Applies every active skill to a batch of stored messages and ships the
 * results. Shared by the pull path (sync) and the push path (inbound relay),
 * so both behave identically.
 */
export async function runSkills(
  userId: string,
  batch: (typeof messages.$inferSelect)[],
  into?: SyncSummary,
): Promise<SyncSummary> {
  const summary: SyncSummary = into ?? {
    fetched: batch.length,
    stored: batch.length,
    extracted: 0,
    skipped: 0,
    delivered: 0,
    failed: 0,
    truncated: false,
  }

  const [rules, targets] = await Promise.all([
    db.select().from(skills).where(and(eq(skills.userId, userId), eq(skills.active, true))),
    db.select().from(destinations).where(and(eq(destinations.userId, userId), eq(destinations.active, true))),
  ])
  if (!rules.length) return summary

  // Public-demo guard: each account gets a bounded number of LLM calls per
  // day, so an open signup page cannot drain the deployment's key.
  const cap = Number(process.env.EXTRACTION_DAILY_CAP ?? 100)
  const since = new Date(Date.now() - 86_400_000)
  const [{ used }] = await db
    .select({ used: count() })
    .from(extractions)
    .where(and(eq(extractions.userId, userId), gte(extractions.createdAt, since)))
  let budget = Math.max(0, cap - used)

  for (const message of batch) {
    for (const rule of rules) {
      if (!matches(rule, message)) continue

      let row: typeof extractions.$inferInsert
      if (budget <= 0) {
        row = {
          userId,
          messageId: message.id,
          skillId: rule.id,
          status: 'failed',
          error: `daily extraction cap reached (${cap}/day) — try again tomorrow`,
        }
        const [capped] = await db.insert(extractions).values(row).onConflictDoNothing().returning()
        if (capped) summary.failed++
        continue
      }
      budget--
      try {
        const result = await extract({
          persona: rule.persona,
          instruction: rule.instruction,
          fields: rule.fields,
          draftReply: rule.draftReply,
          replyInstruction: rule.replyInstruction,
          message,
        })
        row = {
          userId,
          messageId: message.id,
          skillId: rule.id,
          status: result.status,
          data: result.data,
          confidence: result.confidence,
          reasoning: result.reasoning,
          replyDraft: result.replyDraft,
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        }
      } catch (e) {
        row = { userId, messageId: message.id, skillId: rule.id, status: 'failed', error: (e as Error).message }
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
  skill: typeof skills.$inferSelect
  message: typeof messages.$inferSelect
  extraction: typeof extractions.$inferSelect
}) {
  return {
    type: 'record.extracted',
    skill: input.skill.name,
    record: input.extraction.data,
    confidence: input.extraction.confidence,
    reasoning: input.extraction.reasoning,
    ...(input.extraction.replyDraft ? { replyDraft: input.extraction.replyDraft } : {}),
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
  const [skill] = await db.select().from(skills).where(eq(skills.id, row.extraction.skillId)).limit(1)

  const attempt = await deliver({
    url: row.destination.url,
    secret: row.destination.secret,
    headers: row.destination.headers,
    idempotencyKey: row.delivery.id,
    payload: payloadFor({ skill, message, extraction: row.extraction }),
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

/**
 * Cron entry: syncs every gmail mailbox that opted into auto-sync. Errors are
 * recorded on the mailbox rather than thrown, so one broken connection cannot
 * stall the rest of the fleet.
 */
export async function autoSyncMailboxes(limit = 10): Promise<{ synced: number; failed: number }> {
  const due = await db
    .select({ id: mailboxes.id, userId: mailboxes.userId })
    .from(mailboxes)
    .where(and(eq(mailboxes.provider, 'gmail'), eq(mailboxes.autoSync, true), eq(mailboxes.status, 'active')))
    .limit(limit)

  let synced = 0
  let failed = 0
  for (const box of due) {
    try {
      await syncMailbox(box.userId, box.id)
      synced++
    } catch (e) {
      failed++
      await db.update(mailboxes).set({ lastSyncError: (e as Error).message }).where(eq(mailboxes.id, box.id))
    }
  }
  return { synced, failed }
}

export { MAX_ATTEMPTS }
