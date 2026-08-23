'use client'

import { useState } from 'react'
import { SkillComposer } from './SkillComposer'
import { SkillEditor, type SkillDraft } from './SkillEditor'
import { deleteSkill, toggleSkill } from '@/actions/workspace'
import type { DraftedSkill } from '@/lib/skill-author'

export type SkillRow = SkillDraft & { id: string; active: boolean }

type Pending = { draft: SkillDraft; notes: string } | null

export function SkillList({ rows }: { rows: SkillRow[] }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending>(null)

  const accept = (drafted: DraftedSkill, prompt: string) =>
    setPending({
      notes: drafted.notes,
      draft: {
        name: drafted.name,
        persona: drafted.persona,
        instruction: drafted.instruction,
        matchFrom: drafted.matchFrom,
        matchSubject: drafted.matchSubject,
        draftReply: drafted.draftReply,
        replyInstruction: drafted.replyInstruction,
        authoredFrom: prompt,
        fields: drafted.fields,
      },
    })

  return (
    <div className="space-y-4">
      {pending ? (
        <SkillEditor key={pending.draft.name} skill={pending.draft} notes={pending.notes} onDone={() => setPending(null)} />
      ) : (
        <SkillComposer onDraft={accept} />
      )}

      {rows.map((row) =>
        editing === row.id ? (
          <SkillEditor key={row.id} skill={row} onDone={() => setEditing(null)} />
        ) : (
          <div key={row.id} className="card p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-white">{row.name}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] tracking-wide uppercase ${
                  row.active ? 'bg-teal-950 text-brand' : 'bg-gray-800 text-gray-400'
                }`}
              >
                {row.active ? 'active' : 'paused'}
              </span>
              {row.draftReply && (
                <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] tracking-wide text-gray-300 uppercase">
                  drafts replies
                </span>
              )}
              {(row.matchFrom || row.matchSubject) && (
                <span className="font-mono text-[11px] text-gray-500">
                  {row.matchFrom && `from~${row.matchFrom}`} {row.matchSubject && `subject~${row.matchSubject}`}
                </span>
              )}
              <div className="ml-auto flex items-center gap-3 text-xs">
                <button onClick={() => setEditing(row.id)} className="text-gray-400 hover:text-white">
                  Edit
                </button>
                <form action={toggleSkill}>
                  <input type="hidden" name="id" value={row.id} />
                  <input type="hidden" name="active" value={String(row.active)} />
                  <button className="text-gray-400 hover:text-white">{row.active ? 'Pause' : 'Resume'}</button>
                </form>
                <form action={deleteSkill}>
                  <input type="hidden" name="id" value={row.id} />
                  <button className="text-gray-500 hover:text-rose-400">Delete</button>
                </form>
              </div>
            </div>

            <p className="mt-2 text-xs leading-relaxed text-gray-500 italic">{row.persona}</p>
            <p className="mt-2 text-sm text-gray-400">{row.instruction}</p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {row.fields.map((f) => (
                <span key={f.key} className="rounded border border-edge px-1.5 py-0.5 font-mono text-[11px] text-gray-400">
                  {f.key}
                  <span className="text-gray-600">:{f.type}</span>
                  {f.required && <span className="text-amber-500">*</span>}
                </span>
              ))}
            </div>
          </div>
        ),
      )}
    </div>
  )
}
