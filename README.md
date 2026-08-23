# MailHook

Turn inbound email into structured CRM records.

Connect a mailbox, describe the record you want in plain English, and MailHook reads each
message with Claude, extracts the record, and POSTs it to your CRM as a signed webhook.

**Live demo:** _not deployed yet_ — see [Deploying](#deploying).

## Why it exists

Quote requests, past-due notices, booking requests and support escalations arrive as prose.
Somebody re-types them into a CRM. This does that step, and refuses to guess when the email
isn't the record it was asked for.

## How it works

```
Gmail (read-only)  →  message store  →  Claude tool-call extraction  →  signed webhook  →  your CRM
                                              │                              │
                                       present / confidence          HMAC-SHA256 + retry
```

1. **Connect a mailbox.** Three ways in:
   - **Gmail OAuth**, `gmail.readonly` scope only. Refresh tokens are sealed with AES-256-GCM
     before they reach Postgres, so a database dump is inert without `APP_SECRET`. First sync
     backfills a configurable window (default 30 days, paginated); every later sync replays
     Gmail's History API from a stored cursor — incremental, cheap, and exactly-once. A cursor
     that ages out of Gmail's ~7-day history window falls back to a bounded search automatically.
   - **A live inbound address** minted per user (`abc123@inbound.mailhook.dev`). Point any relay
     — Postmark, Mailgun, SendGrid inbound parse, a Cloudflare Email Worker — at
     `/api/inbound/{token}` and real mail anyone sends is parsed (native relay JSON, form posts,
     or raw RFC 822), stored, and run through every active skill immediately. No polling.
   - **A demo inbox** seeded on signup, so the pipeline is observable before granting anything.
2. **Define an extractor.** A name, a plain-English instruction, and a field list. That field
   list is compiled into the tool schema Claude must fill *and* the JSON contract your endpoint
   receives — they cannot drift apart.
3. **Point it at a destination.** Every successful extraction is POSTed with an
   `x-mailhook-signature` header. Non-2xx retries on exponential backoff across six attempts.

## Design decisions worth calling out

| Decision | Reason |
|---|---|
| Model reports `present` and `confidence` | A newsletter comes back `skipped`, not invented. A wrong CRM record costs more than a missing one. |
| Idempotent on natural keys | Messages key on `(mailbox, providerId)`, extractions on `(message, extractor)`, deliveries carry an idempotency key. Re-running a sync duplicates nothing. |
| SSRF guard on destinations | Operator-supplied URLs are DNS-resolved and rejected if they land on loopback, RFC1918, link-local, or unique-local addresses — otherwise the app would happily POST a payload to `169.254.169.254`. |
| Signature covers timestamp + body | Five-minute replay window, `timingSafeEqual` comparison. Verification is ten lines on the receiver. |
| Raw `fetch` instead of `googleapis` | Four endpoints are used; the SDK adds megabytes of discovery documents to a serverless bundle. |
| Demo mailbox on signup | The whole pipeline is observable before anyone grants access to a real inbox. |
| History API over re-search | After the first backfill, Gmail syncs replay the history feed from a cursor — new mail only, no re-listing of the mailbox. Query/window edits reset the cursor deliberately. |
| Inbound token = credential | The relay endpoint's path token is the only secret; unknown tokens return a flat 404, duplicate Message-Ids are absorbed without re-extracting or re-billing. |

## Stack

Next.js 16 (App Router, server actions) · TypeScript · Postgres via Drizzle + Neon serverless ·
Tailwind v4 · bcrypt + `jose` sessions

**LLM-agnostic:** extraction and skill authoring run through one structured-output adapter
([`src/lib/llm.ts`](src/lib/llm.ts)). Set any one of `ANTHROPIC_API_KEY` (Claude),
`GROQ_API_KEY` (gpt-oss-120b, free tier), `GEMINI_API_KEY` (Gemini 2.5 Flash, free tier), or
`OPENROUTER_API_KEY` (free models) — the same code serves them all. A per-account daily
extraction cap (`EXTRACTION_DAILY_CAP`, default 100/24h) keeps an open demo from draining the key.

## Local setup

```bash
cp .env.example .env.local   # fill DATABASE_URL, APP_SECRET, ANTHROPIC_API_KEY
npm install
npx drizzle-kit migrate
npm run dev
```

Gmail is optional locally — a new account is seeded with a demo inbox, one worked extractor,
and a paused destination, which is enough to exercise extraction end to end.

To connect real Gmail, create a Google Cloud OAuth client (Web application) and register
`${APP_URL}/api/mailboxes/google/callback` as an authorized redirect URI.

## Deploying

Vercel. Set every variable from `.env.example` in the project, run `npx drizzle-kit migrate`
against the production database once, and set `CRON_SECRET` so the retry drain at
`/api/cron/retries` (wired in `vercel.json`, every 10 minutes) can authenticate.

## Verifying a webhook

```js
import { createHmac, timingSafeEqual } from 'node:crypto'

export function verify(header, rawBody, secret) {
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')))
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')
  return timingSafeEqual(Buffer.from(expected), Buffer.from(v1))
}
```

## Status

Working: auth, Gmail OAuth, sync, extraction, signed delivery, retry/backoff, replay, demo inbox.
Not built: attachment parsing, per-destination extractor routing, team accounts, usage metering.
