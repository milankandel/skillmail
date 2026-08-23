'use client'

import { useActionState } from 'react'
import { RefreshCcw } from 'lucide-react'
import { runSync, type ActionState } from '@/actions/workspace'

export function SyncButton({ mailboxId }: { mailboxId: string }) {
  const [state, submit, pending] = useActionState<ActionState, FormData>(runSync, {})

  return (
    <form action={submit} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="mailboxId" value={mailboxId} />
      <button type="submit" disabled={pending} className="btn btn-ghost">
        <RefreshCcw className={`size-3.5 ${pending ? 'animate-spin' : ''}`} />
        {pending ? 'Syncing…' : 'Sync now'}
      </button>
      {state.ok && <span className="text-xs text-brand">{state.ok}</span>}
      {state.error && <span className="text-xs text-rose-400">{state.error}</span>}
    </form>
  )
}
