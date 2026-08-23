import Link from 'next/link'
import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { deliveries, destinations, extractions, skills, mailboxes, messages } from '@/db/schema'
import { requireUser } from '@/lib/session'

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
      {hint && <p className="mt-1 text-xs text-gray-600">{hint}</p>}
    </div>
  )
}

export default async function Overview() {
  const user = await requireUser()

  const [boxes, rules, targets, recent] = await Promise.all([
    db.select().from(mailboxes).where(eq(mailboxes.userId, user.id)),
    db.select().from(skills).where(eq(skills.userId, user.id)),
    db.select().from(destinations).where(eq(destinations.userId, user.id)),
    db
      .select({ extraction: extractions, message: messages, skill: skills })
      .from(extractions)
      .innerJoin(messages, eq(extractions.messageId, messages.id))
      .innerJoin(skills, eq(extractions.skillId, skills.id))
      .where(eq(extractions.userId, user.id))
      .orderBy(desc(extractions.createdAt))
      .limit(8),
  ])

  const sent = await db.select({ id: deliveries.id }).from(deliveries).where(eq(deliveries.userId, user.id))
  const activeTargets = targets.filter((t) => t.active).length

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-white">Overview</h1>
        <p className="mt-1 text-sm text-gray-400">
          {activeTargets === 0
            ? 'Extractions are running, but nothing is being delivered yet — activate a destination to start sending.'
            : `Records are flowing to ${activeTargets} active destination${activeTargets === 1 ? '' : 's'}.`}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Mailboxes" value={boxes.length} hint={boxes.map((b) => b.address).join(', ') || 'none connected'} />
        <Stat label="Skills" value={rules.filter((r) => r.active).length} hint={`${rules.length} total`} />
        <Stat label="Destinations" value={activeTargets} hint={`${targets.length} configured`} />
        <Stat label="Deliveries" value={sent.length} hint="all time" />
      </div>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-white">Latest extractions</h2>
          <Link href="/dashboard/deliveries" className="text-xs text-brand hover:underline">
            Delivery log →
          </Link>
        </div>

        {recent.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-sm text-gray-400">Nothing extracted yet.</p>
            <Link href="/dashboard/mailboxes" className="btn btn-primary mt-4">
              Run your first sync
            </Link>
          </div>
        ) : (
          <ul className="space-y-2">
            {recent.map(({ extraction, message, skill }) => (
              <li key={extraction.id} className="card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] tracking-wide uppercase ${
                      extraction.status === 'ok'
                        ? 'bg-teal-950 text-brand'
                        : extraction.status === 'skipped'
                          ? 'bg-gray-800 text-gray-400'
                          : 'bg-rose-950 text-rose-300'
                    }`}
                  >
                    {extraction.status}
                  </span>
                  <span className="text-sm text-white">{message.subject}</span>
                  <span className="text-xs text-gray-500">from {message.fromAddress}</span>
                  <span className="ml-auto text-xs text-gray-600">{skill.name}</span>
                </div>
                {extraction.reasoning && <p className="mt-1.5 text-xs text-gray-500">{extraction.reasoning}</p>}
                {extraction.data && (
                  <pre className="mt-2 overflow-x-auto rounded-md border border-edge bg-ink p-3 font-mono text-[11.5px] text-gray-300">
                    {JSON.stringify(extraction.data, null, 2)}
                  </pre>
                )}
                {extraction.error && <p className="mt-1.5 text-xs text-rose-400">{extraction.error}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
