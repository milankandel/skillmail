import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { deliveries, destinations, extractions, skills, messages } from '@/db/schema'
import { requireUser } from '@/lib/session'
import { replayDelivery } from '@/actions/workspace'
import { MAX_ATTEMPTS } from '@/lib/webhook'

const TONE = {
  delivered: 'bg-teal-950 text-brand',
  pending: 'bg-amber-950 text-amber-300',
  failed: 'bg-rose-950 text-rose-300',
} as const

export default async function DeliveriesPage() {
  const user = await requireUser()

  const rows = await db
    .select({
      delivery: deliveries,
      destination: destinations,
      skill: skills,
      subject: messages.subject,
      from: messages.fromAddress,
    })
    .from(deliveries)
    .innerJoin(destinations, eq(deliveries.destinationId, destinations.id))
    .innerJoin(extractions, eq(deliveries.extractionId, extractions.id))
    .innerJoin(skills, eq(extractions.skillId, skills.id))
    .innerJoin(messages, eq(extractions.messageId, messages.id))
    .where(eq(deliveries.userId, user.id))
    .orderBy(desc(deliveries.createdAt))
    .limit(50)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Deliveries</h1>
        <p className="mt-1 text-sm text-gray-400">
          A non-2xx response retries on backoff up to {MAX_ATTEMPTS} attempts. Replay resets the counter and sends again
          immediately.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="card p-8 text-center text-sm text-gray-400">Nothing delivered yet.</div>
      ) : (
        <ul className="space-y-2">
          {rows.map(({ delivery, destination, skill, subject, from }) => (
            <li key={delivery.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] tracking-wide uppercase ${TONE[delivery.status]}`}>
                  {delivery.status}
                </span>
                <span className="text-sm text-white">{destination.name}</span>
                <span className="text-xs text-gray-500">
                  {skill.name} · attempt {delivery.attempts}/{MAX_ATTEMPTS}
                  {delivery.responseStatus ? ` · HTTP ${delivery.responseStatus}` : ''}
                </span>
                <form action={replayDelivery} className="ml-auto">
                  <input type="hidden" name="id" value={delivery.id} />
                  <button className="text-xs text-gray-400 transition hover:text-brand">Replay</button>
                </form>
              </div>
              <p className="mt-1.5 truncate text-xs text-gray-500">
                {subject} — from {from}
              </p>
              {delivery.responseBody && (
                <pre className="mt-2 overflow-x-auto rounded-md border border-edge bg-ink p-2.5 font-mono text-[11px] text-gray-400">
                  {delivery.responseBody.slice(0, 400)}
                </pre>
              )}
              {delivery.nextAttemptAt && delivery.status === 'pending' && (
                <p className="mt-1 text-xs text-gray-600">next attempt {delivery.nextAttemptAt.toLocaleString()}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
