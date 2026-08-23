import Link from 'next/link'
import { ArrowRight, KeyRound, Mail, RefreshCcw, ShieldCheck, Webhook } from 'lucide-react'
import { currentUser } from '@/lib/session'

const SAMPLE = `POST /crm/leads
x-mailhook-signature: t=1756900412,v1=8f2c…
x-mailhook-idempotency-key: 4b1f…

{
  "type": "record.extracted",
  "skill": "Inbound quote request",
  "record": {
    "company": "Northwind Freight",
    "contactName": "Dana Whitfield",
    "contactEmail": "dana.whitfield@northwindfreight.com",
    "originCity": "Savannah",
    "destinationCity": "Atlanta",
    "containerNumbers": ["MSCU7241883", "TGHU4410927", "CAIU9930012"],
    "loadCount": 3,
    "targetRateUsd": 780,
    "respondBy": "2026-09-03"
  },
  "confidence": "high",
  "reasoning": "Three containers and a per-load budget are stated explicitly.",
  "source": {
    "from": "procurement@northwindfreight.com",
    "subject": "RFQ — 3 loads, Savannah to Atlanta, week of Sep 8",
    "receivedAt": "2026-08-22T14:11:04.000Z"
  }
}`

const STEPS = [
  {
    icon: Mail,
    title: 'Connect a mailbox',
    body: 'Read-only Gmail OAuth. MailHook never gains send, modify, or delete access, and refresh tokens are sealed with AES-256-GCM before they touch the database.',
  },
  {
    icon: KeyRound,
    title: 'Describe the record',
    body: 'Name the fields you want and say what each one means in plain English. That field list becomes both the model’s output schema and your webhook contract.',
  },
  {
    icon: Webhook,
    title: 'Point it at your CRM',
    body: 'Every extracted record is POSTed as a signed JSON payload. Non-2xx responses retry on an exponential backoff for an hour before they are marked failed.',
  },
]

const GUARANTEES = [
  { icon: ShieldCheck, title: 'Signed, verifiable payloads', body: 'HMAC-SHA256 over timestamp and body, with a five-minute replay window. Verification is ten lines on your side.' },
  { icon: RefreshCcw, title: 'Idempotent end to end', body: 'Messages key on provider id, extractions on message plus skill, deliveries carry an idempotency key. Re-running a sync duplicates nothing.' },
  { icon: KeyRound, title: 'Refuses to guess', body: 'The model reports whether the record was actually present and how confident it is. A newsletter comes back skipped, not invented.' },
]

export default async function Home() {
  const user = await currentUser()

  return (
    <main>
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="flex items-center gap-2 font-semibold text-white">
          <Webhook className="size-5 text-brand" />
          MailHook
        </span>
        <nav className="flex items-center gap-3 text-sm">
          {user ? (
            <Link href="/dashboard" className="btn btn-primary">
              Open dashboard
            </Link>
          ) : (
            <>
              <Link href="/login" className="btn btn-ghost">
                Sign in
              </Link>
              <Link href="/signup" className="btn btn-primary">
                Start free
              </Link>
            </>
          )}
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-6 pt-14 pb-20">
        <div className="grid items-start gap-12 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-edge bg-raised px-3 py-1 text-xs text-gray-400">
              <span className="size-1.5 rounded-full bg-brand" />
              Extraction runs on Claude
            </span>
            <h1 className="mt-5 text-4xl leading-[1.1] font-semibold tracking-tight text-white sm:text-5xl">
              Your inbox is already full of CRM records.
              <span className="block text-brand">Nobody is typing them in.</span>
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-gray-400">
              MailHook watches a mailbox, reads each message the way a coordinator would, and turns the ones that matter into
              structured records — then delivers them to your CRM as a signed webhook. Quote requests, past-due notices,
              shipment bookings, support escalations: you describe the shape once.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup" className="btn btn-primary">
                Start with a demo inbox <ArrowRight className="size-4" />
              </Link>
              <Link href="/login" className="btn btn-ghost">
                Sign in
              </Link>
            </div>
            <p className="mt-3 text-xs text-gray-600">
              New workspaces come preloaded with a sample inbox, so you can watch the pipeline run before connecting Gmail.
            </p>
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-edge px-4 py-2 text-[11px] tracking-wide text-gray-500 uppercase">
              What lands on your endpoint
            </div>
            <pre className="overflow-x-auto p-4 font-mono text-[11.5px] leading-relaxed text-gray-300">{SAMPLE}</pre>
          </div>
        </div>
      </section>

      <section className="border-y border-edge bg-surface/40">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-16 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.title}>
              <s.icon className="size-5 text-brand" />
              <h2 className="mt-3 text-[15px] font-medium text-white">
                <span className="mr-2 text-gray-600">{String(i + 1).padStart(2, '0')}</span>
                {s.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-gray-400">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-2xl font-semibold tracking-tight text-white">Built like something you would put in front of a customer</h2>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {GUARANTEES.map((g) => (
            <div key={g.title} className="card p-5">
              <g.icon className="size-5 text-brand" />
              <h3 className="mt-3 text-sm font-medium text-white">{g.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-gray-400">{g.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-edge">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-xs text-gray-600">
          <span>MailHook — built by Milan Kandel</span>
          <a href="https://github.com/milankandel" className="hover:text-brand" target="_blank" rel="noreferrer">
            github.com/milankandel
          </a>
        </div>
      </footer>
    </main>
  )
}
