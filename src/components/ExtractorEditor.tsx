'use client'

import { useActionState, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { saveExtractor, type ActionState } from '@/actions/workspace'
import type { ExtractorField } from '@/db/schema'

const TYPES: ExtractorField['type'][] = ['string', 'number', 'boolean', 'date', 'string[]']

const BLANK: ExtractorField = { key: '', type: 'string', description: '', required: false }

type Props = {
  extractor?: {
    id: string
    name: string
    instruction: string
    matchFrom: string | null
    matchSubject: string | null
    fields: ExtractorField[]
  }
  onDone?: () => void
}

export function ExtractorEditor({ extractor, onDone }: Props) {
  const [fields, setFields] = useState<ExtractorField[]>(extractor?.fields ?? [{ ...BLANK }])
  const [state, submit, pending] = useActionState<ActionState, FormData>(async (prev, data) => {
    data.set('fields', JSON.stringify(fields))
    const result = await saveExtractor(prev, data)
    if (result.ok) onDone?.()
    return result
  }, {})

  const patch = (i: number, next: Partial<ExtractorField>) =>
    setFields((f) => f.map((row, idx) => (idx === i ? { ...row, ...next } : row)))

  return (
    <form action={submit} className="card space-y-5 p-5">
      {extractor && <input type="hidden" name="id" value={extractor.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs text-gray-400">Name</span>
          <input name="name" required defaultValue={extractor?.name} className="input-base" placeholder="Inbound quote request" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs text-gray-400">Only if sender contains</span>
            <input name="matchFrom" defaultValue={extractor?.matchFrom ?? ''} className="input-base" placeholder="optional" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs text-gray-400">Only if subject contains</span>
            <input name="matchSubject" defaultValue={extractor?.matchSubject ?? ''} className="input-base" placeholder="optional" />
          </label>
        </div>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-xs text-gray-400">What record is this?</span>
        <textarea
          name="instruction"
          required
          rows={3}
          defaultValue={extractor?.instruction}
          className="input-base"
          placeholder="Extract a freight quote request: who is asking, what they need moved, where from and to, and what they are willing to pay."
        />
        <span className="mt-1 block text-xs text-gray-600">
          Written straight into the model’s tool description. Be specific about what does and does not count.
        </span>
      </label>

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
              <select value={f.type} onChange={(e) => patch(i, { type: e.target.value as ExtractorField['type'] })} className="input-base">
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
          {pending ? 'Saving…' : extractor ? 'Save changes' : 'Create extractor'}
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
