'use client'

import { useActionState } from 'react'
import { saveDestination, type ActionState } from '@/actions/workspace'

export function DestinationForm() {
  const [state, submit, pending] = useActionState<ActionState, FormData>(saveDestination, {})

  return (
    <form action={submit} className="card grid gap-3 p-4 sm:grid-cols-[1fr_2fr_auto]">
      <input name="name" required className="input-base" placeholder="HubSpot inbound" />
      <input name="url" required type="url" className="input-base" placeholder="https://api.yourcrm.com/hooks/mailhook" />
      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? 'Saving…' : 'Add destination'}
      </button>
      {state.error && <p className="text-sm text-rose-400 sm:col-span-3">{state.error}</p>}
      {state.ok && <p className="text-sm text-brand sm:col-span-3">{state.ok}</p>}
    </form>
  )
}
