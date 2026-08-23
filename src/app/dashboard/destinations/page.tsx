import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { destinations } from '@/db/schema'
import { requireUser } from '@/lib/session'
import { deleteDestination, rotateSecret, toggleDestination } from '@/actions/workspace'
import { DestinationForm } from '@/components/DestinationForm'
import { SecretReveal } from '@/components/SecretReveal'

const VERIFY = `import { createHmac, timingSafeEqual } from 'node:crypto'

export function verify(header, rawBody, secret) {
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')))
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false
  const expected = createHmac('sha256', secret).update(\`\${t}.\${rawBody}\`).digest('hex')
  return timingSafeEqual(Buffer.from(expected), Buffer.from(v1))
}`

export default async function DestinationsPage() {
  const user = await requireUser()
  const rows = await db
    .select()
    .from(destinations)
    .where(eq(destinations.userId, user.id))
    .orderBy(desc(destinations.createdAt))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Destinations</h1>
        <p className="mt-1 text-sm text-gray-400">
          Every active destination receives every successful extraction. URLs must be https and may not resolve to a private
          address.
        </p>
      </div>

      <DestinationForm />

      {rows.length === 0 ? (
        <div className="card p-8 text-center text-sm text-gray-400">No destinations yet.</div>
      ) : (
        <ul className="space-y-3">
          {rows.map((d) => (
            <li key={d.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium text-white">{d.name}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] tracking-wide uppercase ${
                    d.active ? 'bg-teal-950 text-brand' : 'bg-gray-800 text-gray-400'
                  }`}
                >
                  {d.active ? 'active' : 'paused'}
                </span>
                <div className="ml-auto flex items-center gap-3 text-xs">
                  <form action={toggleDestination}>
                    <input type="hidden" name="id" value={d.id} />
                    <input type="hidden" name="active" value={String(d.active)} />
                    <button className="text-gray-400 hover:text-white">{d.active ? 'Pause' : 'Activate'}</button>
                  </form>
                  <form action={rotateSecret}>
                    <input type="hidden" name="id" value={d.id} />
                    <button className="text-gray-400 hover:text-white">Rotate secret</button>
                  </form>
                  <form action={deleteDestination}>
                    <input type="hidden" name="id" value={d.id} />
                    <button className="text-gray-500 hover:text-rose-400">Delete</button>
                  </form>
                </div>
              </div>
              <p className="mt-1 font-mono text-[12px] break-all text-gray-400">{d.url}</p>
              <div className="mt-2">
                <SecretReveal secret={d.secret} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium text-white">Verifying a payload on your side</h2>
        <pre className="card overflow-x-auto p-4 font-mono text-[11.5px] leading-relaxed text-gray-300">{VERIFY}</pre>
      </section>
    </div>
  )
}
