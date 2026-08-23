import { eq } from 'drizzle-orm'
import { Inbox } from 'lucide-react'
import { db } from '@/db'
import { mailboxes } from '@/db/schema'
import { requireUser } from '@/lib/session'
import { isGmailConfigured } from '@/lib/gmail'
import { addDemoMailbox, disconnectMailbox } from '@/actions/workspace'
import { SyncButton } from '@/components/SyncButton'

export default async function MailboxesPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const user = await requireUser()
  const params = await searchParams
  const boxes = await db.select().from(mailboxes).where(eq(mailboxes.userId, user.id))
  const gmailReady = isGmailConfigured()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Mailboxes</h1>
        <p className="mt-1 text-sm text-gray-400">
          Gmail is requested read-only. Tokens are encrypted before storage and can be revoked from your Google account at any
          time.
        </p>
      </div>

      {params.error && (
        <p className="rounded-md border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">{params.error}</p>
      )}
      {params.connected && (
        <p className="rounded-md border border-teal-900/60 bg-teal-950/30 px-3 py-2 text-sm text-brand">
          Connected {params.connected}. Run a sync to pull the last two weeks.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        {gmailReady ? (
          <a href="/api/mailboxes/google/start" className="btn btn-primary">
            Connect Gmail
          </a>
        ) : (
          <span className="rounded-md border border-edge px-3 py-2 text-xs text-gray-500">
            Gmail connection is unavailable until GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set on this deployment.
          </span>
        )}
        <form action={addDemoMailbox}>
          <button className="btn btn-ghost">Add demo inbox</button>
        </form>
      </div>

      {boxes.length === 0 ? (
        <div className="card p-8 text-center text-sm text-gray-400">No mailboxes connected yet.</div>
      ) : (
        <ul className="space-y-3">
          {boxes.map((b) => (
            <li key={b.id} className="card flex flex-wrap items-center gap-4 p-4">
              <Inbox className="size-4 text-brand" />
              <div className="min-w-0">
                <p className="truncate text-sm text-white">{b.address}</p>
                <p className="text-xs text-gray-500">
                  {b.provider === 'demo' ? 'Sample inbox' : 'Gmail, read-only'}
                  {b.lastSyncedAt ? ` · last synced ${b.lastSyncedAt.toLocaleString()}` : ' · never synced'}
                </p>
              </div>
              {b.status === 'reauth_required' && (
                <span className="rounded bg-amber-950 px-2 py-0.5 text-[10px] tracking-wide text-amber-300 uppercase">
                  reconnect needed
                </span>
              )}
              <div className="ml-auto flex items-center gap-3">
                <SyncButton mailboxId={b.id} />
                <form action={disconnectMailbox}>
                  <input type="hidden" name="mailboxId" value={b.id} />
                  <button className="text-xs text-gray-500 transition hover:text-rose-400">Disconnect</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
