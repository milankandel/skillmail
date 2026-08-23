'use client'

import { useState } from 'react'
import { ExtractorEditor } from './ExtractorEditor'
import { deleteExtractor, toggleExtractor } from '@/actions/workspace'
import type { ExtractorField } from '@/db/schema'

export type ExtractorRow = {
  id: string
  name: string
  instruction: string
  matchFrom: string | null
  matchSubject: string | null
  fields: ExtractorField[]
  active: boolean
}

export function ExtractorList({ rows }: { rows: ExtractorRow[] }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  return (
    <div className="space-y-4">
      {creating ? (
        <ExtractorEditor onDone={() => setCreating(false)} />
      ) : (
        <button onClick={() => setCreating(true)} className="btn btn-primary">
          New extractor
        </button>
      )}

      {rows.map((row) =>
        editing === row.id ? (
          <ExtractorEditor key={row.id} extractor={row} onDone={() => setEditing(null)} />
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
              {(row.matchFrom || row.matchSubject) && (
                <span className="font-mono text-[11px] text-gray-500">
                  {row.matchFrom && `from~${row.matchFrom}`} {row.matchSubject && `subject~${row.matchSubject}`}
                </span>
              )}
              <div className="ml-auto flex items-center gap-3 text-xs">
                <button onClick={() => setEditing(row.id)} className="text-gray-400 hover:text-white">
                  Edit
                </button>
                <form action={toggleExtractor}>
                  <input type="hidden" name="id" value={row.id} />
                  <input type="hidden" name="active" value={String(row.active)} />
                  <button className="text-gray-400 hover:text-white">{row.active ? 'Pause' : 'Resume'}</button>
                </form>
                <form action={deleteExtractor}>
                  <input type="hidden" name="id" value={row.id} />
                  <button className="text-gray-500 hover:text-rose-400">Delete</button>
                </form>
              </div>
            </div>
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
