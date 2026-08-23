'use client'

import { useState } from 'react'
import { ChevronDown, Copy } from 'lucide-react'
import { updateMailboxSettings } from '@/actions/workspace'

type Props = {
  mailboxId: string
  syncQuery: string
  backfillDays: number
  autoSync: boolean
}

export function MailboxSettings({ mailboxId, syncQuery, backfillDays, autoSync }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-3 border-t border-edge pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-xs text-gray-500 transition hover:text-white"
      >
        <ChevronDown className={`size-3 transition ${open ? 'rotate-180' : ''}`} />
        Sync settings
      </button>

      {open && (
        <form action={updateMailboxSettings} className="mt-3 grid gap-3 sm:grid-cols-[1fr_10rem_auto_auto]">
          <input type="hidden" name="mailboxId" value={mailboxId} />
          <label className="block">
            <span className="mb-1 block text-[11px] text-gray-500">Gmail search query</span>
            <input name="syncQuery" defaultValue={syncQuery} className="input-base font-mono text-[12px]" placeholder="in:inbox" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-gray-500">First-sync window (days)</span>
            <input name="backfillDays" type="number" min={1} max={30} defaultValue={backfillDays} className="input-base" />
          </label>
          <label className="flex items-end gap-2 pb-2 text-xs text-gray-400">
            <input type="checkbox" name="autoSync" defaultChecked={autoSync} />
            auto-sync
          </label>
          <div className="flex items-end">
            <button type="submit" className="btn btn-ghost">
              Save
            </button>
          </div>
          <p className="text-[11px] text-gray-600 sm:col-span-4">
            Changing the query or window restarts incremental sync from a fresh search. Each sync ingests at most 50 messages; the window caps at 30 days on this deployment.
          </p>
        </form>
      )}
    </div>
  )
}

export function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(address)
        setCopied(true)
        setTimeout(() => setCopied(false), 1400)
      }}
      className="inline-flex items-center gap-1 font-mono text-[12px] text-brand transition hover:text-teal-200"
      title="Copy address"
    >
      {address}
      <Copy className="size-3" />
      {copied && <span className="text-[10px] text-gray-400">copied</span>}
    </button>
  )
}
