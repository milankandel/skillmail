'use client'

import { useActionState } from 'react'
import { Sparkles } from 'lucide-react'
import { draftSkillFromPrompt, type DraftState } from '@/actions/workspace'
import type { DraftedSkill } from '@/lib/skill-author'

const EXAMPLES = [
  'Pull freight quote requests out of my inbox — who is asking, the lane, the equipment, and what they want to pay.',
  'Watch for past-due invoice notices from vendors and log the invoice number, amount, and how many days late it is.',
  'Catch inbound job applications, capture the role, years of experience, and a link to their portfolio, and draft a warm holding reply.',
]

export function SkillComposer({ onDraft }: { onDraft: (draft: DraftedSkill, prompt: string) => void }) {
  const [state, submit, pending] = useActionState<DraftState, FormData>(async (prev, data) => {
    const result = await draftSkillFromPrompt(prev, data)
    if (result.draft) onDraft(result.draft, String(data.get('prompt') ?? ''))
    return result
  }, {})

  return (
    <form action={submit} className="card space-y-3 p-5">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-brand" />
        <h2 className="text-sm font-medium text-white">Describe the job</h2>
      </div>
      <p className="text-sm text-gray-400">
        Say what you want done with your mail, in your own words. You get back a full spec — persona, matching rules, and
        every field — which you then edit. Nothing is saved until you say so.
      </p>

      <textarea
        name="prompt"
        rows={3}
        required
        className="input-base"
        placeholder="Watch for inbound quote requests and pull out the lane, equipment, and target rate."
      />

      <div className="flex flex-wrap gap-1.5">
        {EXAMPLES.map((e) => (
          <button
            key={e}
            type="button"
            onClick={(event) => {
              const form = event.currentTarget.closest('form')
              const field = form?.querySelector<HTMLTextAreaElement>('textarea[name="prompt"]')
              if (field) field.value = e
            }}
            className="rounded-full border border-edge px-2.5 py-1 text-[11px] text-gray-500 transition hover:border-brand/50 hover:text-brand"
          >
            {e.slice(0, 46)}…
          </button>
        ))}
      </div>

      {state.error && <p className="text-sm text-rose-400">{state.error}</p>}

      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? 'Designing the skill…' : 'Draft this skill'}
      </button>
    </form>
  )
}
