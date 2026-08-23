import { desc, eq } from 'drizzle-orm'
import { Inbox, Mail, Send } from 'lucide-react'
import { db } from '@/db'
import { mailboxes } from '@/db/schema'
import { requireUser } from '@/lib/session'
import { isGmailConfigured } from '@/lib/gmail'
import { activeProvider } from '@/lib/llm'
import { addDemoMailbox, addInboundMailbox, disconnectMailbox } from '@/actions/workspace'
import { SyncButton } from '@/components/SyncButton'
import { CopyAddress, MailboxSettings } from '@/components/MailboxSettings'

const PROVIDER = {
  gmail: { icon: Mail, label: 'Gmail, read-only' },
  demo: { icon: Inbox, label: 'Sample inbox' },
  inbound: { icon: Send, label: 'Live inbound address' },
} as const

export default async function MailboxesPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const user = await requireUser()
  const params = await searchParams
  const boxes = await db.select().from(mailboxes).where(eq(mailboxes.userId, user.id)).orderBy(desc(mailboxes.createdAt))
  const gmailReady = isGmailConfigured()
  const provider = activeProvider()
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Mailboxes</h1>
        <p className="mt-1 text-sm text-gray-400">
          Three ways in: connect Gmail (read-only, tokens encrypted at rest), mint a live inbound address anyone can email,
          or use the sample inbox to watch the pipeline run.
        </p>
      </div>

      {params.error && (
        <p className="rounded-md border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">{params.error}</p>
      )}
      {!provider && (
        <p className="rounded-md border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-300">
          No LLM key is configured on this deployment — messages will store but extraction will fail until one of
          ANTHROPIC_API_KEY, GROQ_API_KEY, GEMINI_API_KEY, or OPENROUTER_API_KEY is set.
        </p>
      )}

      {params.connected && (
        <p className="rounded-md border border-teal-900/60 bg-teal-950/30 px-3 py-2 text-sm text-brand">
          Connected {params.connected}. Run a sync to pull your backfill window.
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
        <form action={addInboundMailbox}>
          <button className="btn btn-ghost">Mint inbound address</button>
        </form>
        <form action={addDemoMailbox}>
          <button className="btn btn-ghost">Add demo inbox</button>
        </form>
      </div>

      {boxes.length === 0 ? (
        <div className="card p-8 text-center text-sm text-gray-400">No mailboxes connected yet.</div>
      ) : (
        <ul className="space-y-3">
          {boxes.map((b) => {
            const meta = PROVIDER[b.provider]
            return (
              <li key={b.id} className="card p-4">
                <div className="flex flex-wrap items-center gap-4">
                  <meta.icon className="size-4 text-brand" />
                  <div className="min-w-0">
                    {b.provider === 'inbound' ? (
                      <CopyAddress address={b.address} />
                    ) : (
                      <p className="truncate text-sm text-white">{b.address}</p>
                    )}
                    <p className="text-xs text-gray-500">
                      {meta.label}
                      {b.lastSyncedAt ? ` · last activity ${b.lastSyncedAt.toLocaleString()}` : ' · nothing received yet'}
                    </p>
                  </div>
                  {b.status === 'reauth_required' && (
                    <span className="rounded bg-amber-950 px-2 py-0.5 text-[10px] tracking-wide text-amber-300 uppercase">
                      reconnect needed
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-3">
                    {b.provider !== 'inbound' && <SyncButton mailboxId={b.id} />}
                    <form action={disconnectMailbox}>
                      <input type="hidden" name="mailboxId" value={b.id} />
                      <button className="text-xs text-gray-500 transition hover:text-rose-400">Disconnect</button>
                    </form>
                  </div>
                </div>

                {b.lastSyncError && (
                  <p className="mt-2 rounded-md border border-rose-900/50 bg-rose-950/30 px-2.5 py-1.5 text-xs text-rose-300">
                    last sync failed: {b.lastSyncError}
                  </p>
                )}

                {b.provider === 'gmail' && (
                  <MailboxSettings mailboxId={b.id} syncQuery={b.syncQuery} backfillDays={b.backfillDays} autoSync={b.autoSync} />
                )}

                {b.provider === 'inbound' && (
                  <div className="mt-3 space-y-1 border-t border-edge pt-3 text-xs text-gray-500">
                    <p>
                      Wire your relay (Postmark, Mailgun, SendGrid inbound parse, or a Cloudflare Email Worker) to POST
                      received mail to:
                    </p>
                    <p className="font-mono text-[11.5px] break-all text-gray-400">
                      {appUrl}/api/inbound/{b.inboundToken}
                    </p>
                    <p>
                      Accepts the relays’ native JSON, form posts, or raw RFC 822. Each accepted message runs every active
                      skill immediately — no polling. Duplicate Message-Ids are absorbed.
                    </p>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
