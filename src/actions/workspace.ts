'use server'

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { deliveries, destinations, skills, mailboxes } from '@/db/schema'
import { newSecret } from '@/lib/crypto'
import { inboundAddress, newInboundToken } from '@/lib/inbound'
import { requireUser } from '@/lib/session'
import { assertPublicUrl } from '@/lib/webhook'
import { attemptDelivery, syncMailbox, type SyncSummary } from '@/lib/pipeline'
import { draftSkill, type DraftedSkill } from '@/lib/skill-author'

export type ActionState = { error?: string; ok?: string; summary?: SyncSummary }

function fail(e: unknown): ActionState {
  const message = e instanceof Error ? e.message : 'Something went wrong'
  return { error: message === 'UNAUTHENTICATED' ? 'Your session expired. Sign in again.' : message }
}

export async function runSync(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser()
    const summary = await syncMailbox(user.id, String(formData.get('mailboxId')))
    revalidatePath('/dashboard', 'layout')
    return {
      ok: `${summary.stored} new message${summary.stored === 1 ? '' : 's'} · ${summary.extracted} extracted · ${summary.skipped} skipped · ${summary.delivered} delivered`,
      summary,
    }
  } catch (e) {
    return fail(e)
  }
}

export async function disconnectMailbox(formData: FormData) {
  const user = await requireUser()
  await db
    .delete(mailboxes)
    .where(and(eq(mailboxes.id, String(formData.get('mailboxId'))), eq(mailboxes.userId, user.id)))
  revalidatePath('/dashboard/mailboxes')
}

export async function addDemoMailbox() {
  const user = await requireUser()
  await db
    .insert(mailboxes)
    .values({ userId: user.id, provider: 'demo', address: 'demo-inbox@mailhook.dev' })
    .onConflictDoNothing()
  revalidatePath('/dashboard/mailboxes')
}

/** Mints a live address anyone can send real mail to via the inbound relay. */
export async function addInboundMailbox() {
  const user = await requireUser()
  const token = newInboundToken()
  await db
    .insert(mailboxes)
    .values({ userId: user.id, provider: 'inbound', address: inboundAddress(token), inboundToken: token })
    .onConflictDoNothing()
  revalidatePath('/dashboard/mailboxes')
}

/** Per-mailbox sync controls: query, backfill window, auto-sync. */
export async function updateMailboxSettings(formData: FormData) {
  const user = await requireUser()
  const id = String(formData.get('mailboxId'))
  const backfill = Math.min(365, Math.max(1, Number(formData.get('backfillDays')) || 30))
  const query = String(formData.get('syncQuery') ?? 'in:inbox').trim() || 'in:inbox'
  await db
    .update(mailboxes)
    .set({
      syncQuery: query,
      backfillDays: backfill,
      autoSync: formData.get('autoSync') === 'on',
      // Query or window changes invalidate the incremental cursor: the next
      // sync must re-search, or newly-matching old mail would never appear.
      historyId: null,
    })
    .where(and(eq(mailboxes.id, id), eq(mailboxes.userId, user.id)))
  revalidatePath('/dashboard/mailboxes')
}

const fieldSchema = z.object({
  key: z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Field keys must be alphanumeric and start with a letter'),
  type: z.enum(['string', 'number', 'boolean', 'date', 'string[]']),
  description: z.string().trim().min(3, 'Describe what each field means — the model relies on it'),
  required: z.boolean(),
})

const skillSchema = z.object({
  name: z.string().trim().min(2, 'Give the skill a name'),
  persona: z.string().trim().min(20, 'Describe who the model is acting as — a sentence or two'),
  instruction: z.string().trim().min(15, 'Describe the record in a sentence or two'),
  matchFrom: z.string().trim().optional(),
  matchSubject: z.string().trim().optional(),
  draftReply: z.boolean(),
  replyInstruction: z.string().trim().optional(),
  authoredFrom: z.string().trim().optional(),
  fields: z.array(fieldSchema).min(1, 'Add at least one field'),
})

export async function saveSkill(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser()
    const parsed = skillSchema.safeParse({
      name: formData.get('name'),
      persona: formData.get('persona'),
      instruction: formData.get('instruction'),
      matchFrom: formData.get('matchFrom') || undefined,
      matchSubject: formData.get('matchSubject') || undefined,
      draftReply: formData.get('draftReply') === 'on',
      replyInstruction: formData.get('replyInstruction') || undefined,
      authoredFrom: formData.get('authoredFrom') || undefined,
      fields: JSON.parse(String(formData.get('fields') || '[]')),
    })
    if (!parsed.success) return { error: parsed.error.issues[0].message }

    const keys = parsed.data.fields.map((f) => f.key)
    if (new Set(keys).size !== keys.length) return { error: 'Field keys must be unique' }

    const id = formData.get('id')
    const values = {
      name: parsed.data.name,
      persona: parsed.data.persona,
      instruction: parsed.data.instruction,
      matchFrom: parsed.data.matchFrom || null,
      matchSubject: parsed.data.matchSubject || null,
      draftReply: parsed.data.draftReply,
      replyInstruction: parsed.data.draftReply ? parsed.data.replyInstruction || null : null,
      authoredFrom: parsed.data.authoredFrom || null,
      fields: parsed.data.fields,
    }

    if (id) {
      await db.update(skills).set(values).where(and(eq(skills.id, String(id)), eq(skills.userId, user.id)))
    } else {
      await db.insert(skills).values({ userId: user.id, ...values })
    }
    revalidatePath('/dashboard/skills')
    return { ok: id ? 'Skill updated' : 'Skill created' }
  } catch (e) {
    return fail(e)
  }
}

export type DraftState = ActionState & { draft?: DraftedSkill }

/** Turns the operator's sentence into an editable skill spec. Never saves. */
export async function draftSkillFromPrompt(_prev: DraftState, formData: FormData): Promise<DraftState> {
  try {
    await requireUser()
    const prompt = String(formData.get('prompt') ?? '').trim()
    if (prompt.length < 15) return { error: 'Describe the job in a sentence or two so there is something to work from' }
    return { draft: await draftSkill(prompt), ok: 'Draft ready — review every field before switching it on' }
  } catch (e) {
    return fail(e)
  }
}

export async function toggleSkill(formData: FormData) {
  const user = await requireUser()
  const id = String(formData.get('id'))
  const active = formData.get('active') === 'true'
  await db.update(skills).set({ active: !active }).where(and(eq(skills.id, id), eq(skills.userId, user.id)))
  revalidatePath('/dashboard/skills')
}

export async function deleteSkill(formData: FormData) {
  const user = await requireUser()
  await db.delete(skills).where(and(eq(skills.id, String(formData.get('id'))), eq(skills.userId, user.id)))
  revalidatePath('/dashboard/skills')
}

export async function saveDestination(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser()
    const name = String(formData.get('name') ?? '').trim()
    const url = String(formData.get('url') ?? '').trim()
    if (name.length < 2) return { error: 'Give the destination a name' }

    try {
      await assertPublicUrl(url)
    } catch (e) {
      return { error: (e as Error).message }
    }

    const id = formData.get('id')
    if (id) {
      await db
        .update(destinations)
        .set({ name, url })
        .where(and(eq(destinations.id, String(id)), eq(destinations.userId, user.id)))
    } else {
      await db.insert(destinations).values({ userId: user.id, name, url, secret: newSecret(), active: true })
    }
    revalidatePath('/dashboard/destinations')
    return { ok: id ? 'Destination updated' : 'Destination created' }
  } catch (e) {
    return fail(e)
  }
}

export async function toggleDestination(formData: FormData) {
  const user = await requireUser()
  const id = String(formData.get('id'))
  const active = formData.get('active') === 'true'
  await db.update(destinations).set({ active: !active }).where(and(eq(destinations.id, id), eq(destinations.userId, user.id)))
  revalidatePath('/dashboard/destinations')
}

export async function rotateSecret(formData: FormData) {
  const user = await requireUser()
  await db
    .update(destinations)
    .set({ secret: newSecret() })
    .where(and(eq(destinations.id, String(formData.get('id'))), eq(destinations.userId, user.id)))
  revalidatePath('/dashboard/destinations')
}

export async function deleteDestination(formData: FormData) {
  const user = await requireUser()
  await db.delete(destinations).where(and(eq(destinations.id, String(formData.get('id'))), eq(destinations.userId, user.id)))
  revalidatePath('/dashboard/destinations')
}

export async function replayDelivery(formData: FormData) {
  const user = await requireUser()
  const id = String(formData.get('id'))
  const [row] = await db
    .select({ id: deliveries.id })
    .from(deliveries)
    .where(and(eq(deliveries.id, id), eq(deliveries.userId, user.id)))
    .limit(1)
  if (!row) return
  await db.update(deliveries).set({ status: 'pending', attempts: 0 }).where(eq(deliveries.id, id))
  await attemptDelivery(id)
  revalidatePath('/dashboard/deliveries')
}
