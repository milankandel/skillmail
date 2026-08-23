'use client'

import { useActionState, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { saveSkill, type ActionState } from '@/actions/workspace'
import type { SkillField } from '@/db/schema'

const TYPES: SkillField['type'][] = ['string', 'number', 'boolean', 'date', 'string[]']
const BLANK: SkillField = { key: '', type: 'string', description: '', required: false }

export type SkillDraft = {
  id?: string
  name: string
  persona: string
  instruction: string
  matchFrom: string | null
  matchSubject: string | null
  draftReply: boolean
  replyInstruction: string | null
  authoredFrom: string | null
  fields: SkillField[]
}

type Props = {
  skill?: SkillDraft
  /** Shown above the form when the spec came out of the composer. */
  notes?: string
  onDone?: () => void
}

export function SkillEditor({ skill, notes, onDone }: Props) {
  const [fields, setFields] = useState<SkillField[]>(skill?.fields?.length ? skill.fields : [{ ...BLANK }])
  const [wantsReply, setWantsReply] = useState(skill?.draftReply ?? false)
  const [state, submit, pending] = useActionState<ActionState, FormData>(async (prev, data) => {
    data.set('fields', JSON.stringify(fields))
    const result = await saveSkill(prev, data)
    if (result.ok) onDone?.()
    return result
  }, {})

  const patch = (i: number, next: Partial<SkillField>) =>
    setFields((f) => f.map((row, idx) => (idx === i ? { ...row, ...next } : row)))

  return (
    <form action={submit} className="card space-y-5 p-5">
      {skill?.id && <input type="hidden" name="id" value={skill.id} />}
      {skill?.authoredFrom && <input type="hidden" name="authoredFrom" value={skill.authoredFrom} />}

      {notes && (
        <p className="rounded-md border border-teal-900/50 bg-teal-950/25 px-3 py-2 text-sm text-teal-200">{notes}</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs text-gray-400">Name</span>
          <input name="name" required defaultValue={skill?.name} className="input-base" placeholder="Inbound quote request" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs text-gray-400">Only if sender contains</span>
            <input name="matchFrom" defaultValue={skill?.matchFrom ?? ''} className="input-base" placeholder="optional" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs text-gray-400">Only if subject contains</span>
            <input name="matchSubject" defaultValue={skill?.matchSubject ?? ''} className="input-base" placeholder="optional" />
          </label>
        </div>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-xs text-gray-400">Persona — who is reading this mail?</span>
        <textarea
          name="persona"
          required
          rows={3}
          defaultValue={skill?.persona}
          className="input-base"
          placeholder="You are a dispatch coordinator at a drayage carrier. You read inbound mail the way someone who has to quote it does…"
        />
        <span className="mt-1 block text-xs text-gray-600">
          Sets the judgement the model applies, not just its tone. Name the role and the business.
        </span>
      </label>

      <label className="block">
        <span className="mb-1.5 block text-xs text-gray-400">What counts — and what does not</span>
        <textarea
          name="instruction"
          required
          rows={3}
          defaultValue={skill?.instruction}
          className="input-base"
          placeholder="Extract a freight quote request… A newsletter, an invoice, or an internal thread is not a quote request — skip those."
        />
        <span className="mt-1 block text-xs text-gray-600">
          The second half earns its keep. Naming the near misses is what stops junk records.
        </span>
      </label>

      <div>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input type="checkbox" name="draftReply" checked={wantsReply} onChange={(e) => setWantsReply(e.target.checked)} />
          Also draft a reply in this persona’s voice
        </label>
        {wantsReply && (
          <textarea
            name="replyInstruction"
            rows={2}
            defaultValue={skill?.replyInstruction ?? ''}
            className="input-base mt-2"
            placeholder="Acknowledge the request, confirm the lane back to them, and say a quote follows within the business day. Never commit to a price."
          />
        )}
        <p className="mt-1 text-xs text-gray-600">
          The draft rides along in the webhook payload. Nothing is ever sent from your mailbox.
        </p>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs text-gray-400">Fields — this list is also your webhook payload contract</span>
          <button
            type="button"
            onClick={() => setFields((f) => [...f, { ...BLANK }])}
            className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
          >
            <Plus className="size-3" /> Add field
          </button>
        </div>

        <div className="space-y-2">
          {fields.map((f, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-edge bg-ink p-2 sm:grid-cols-[9rem_7rem_1fr_auto]">
              <input
                value={f.key}
                onChange={(e) => patch(i, { key: e.target.value })}
                className="input-base font-mono text-[13px]"
                placeholder="contactEmail"
              />
              <select value={f.type} onChange={(e) => patch(i, { type: e.target.value as SkillField['type'] })} className="input-base">
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <input
                value={f.description}
                onChange={(e) => patch(i, { description: e.target.value })}
                className="input-base"
                placeholder="Reply-to email address."
              />
              <div className="flex items-center gap-2 px-1">
                <label className="flex items-center gap-1.5 text-xs whitespace-nowrap text-gray-400">
                  <input type="checkbox" checked={f.required} onChange={(e) => patch(i, { required: e.target.checked })} />
                  required
                </label>
                <button
                  type="button"
                  onClick={() => setFields((rows) => rows.filter((_, idx) => idx !== i))}
                  className="text-gray-600 transition hover:text-rose-400"
                  aria-label="Remove field"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {state.error && <p className="text-sm text-rose-400">{state.error}</p>}
      {state.ok && <p className="text-sm text-brand">{state.ok}</p>}

      <div className="flex gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Saving…' : skill?.id ? 'Save changes' : 'Create skill'}
        </button>
        {onDone && (
          <button type="button" onClick={onDone} className="btn btn-ghost">
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
