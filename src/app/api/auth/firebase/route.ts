import { randomBytes } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { eq } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { db } from '@/db'
import { users } from '@/db/schema'
import { FIREBASE_PROJECT_ID } from '@/lib/firebase-client'
import { startSession } from '@/lib/session'
import { seedWorkspace } from '@/lib/workspace-seed'

/** Google's signing keys for Firebase ID tokens. jose caches and refreshes. */
const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
)

/**
 * Exchanges a Firebase ID token (from the client-side Google popup) for the
 * app's own session cookie. The token is verified against Google's public
 * keys — issuer, audience, and expiry — so a forged or replayed token from
 * another Firebase project is rejected before any database work happens.
 */
export async function POST(request: NextRequest) {
  let idToken: string
  try {
    const body = (await request.json()) as { idToken?: string }
    idToken = String(body.idToken ?? '')
  } catch {
    return NextResponse.json({ error: 'malformed request' }, { status: 400 })
  }
  if (!idToken) return NextResponse.json({ error: 'idToken is required' }, { status: 400 })

  let payload: { email?: string; email_verified?: boolean; name?: string; sub?: string }
  try {
    const verified = await jwtVerify(idToken, JWKS, {
      issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
      audience: FIREBASE_PROJECT_ID,
    })
    payload = verified.payload as typeof payload
  } catch {
    return NextResponse.json({ error: 'invalid token' }, { status: 401 })
  }

  const email = payload.email?.trim().toLowerCase()
  if (!email || !payload.email_verified) {
    // An unverified address could hijack a password account with the same email.
    return NextResponse.json({ error: 'a verified email address is required' }, { status: 403 })
  }

  let [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)

  if (!user) {
    // Google-only accounts still satisfy the NOT NULL password column with an
    // unguessable value; password login remains possible only via reset flows
    // that do not exist, i.e. never.
    const [created] = await db
      .insert(users)
      .values({
        email,
        name: payload.name || null,
        passwordHash: await bcrypt.hash(randomBytes(32).toString('base64url'), 10),
      })
      .returning({ id: users.id })
    user = created
    await seedWorkspace(user.id)
  }

  await startSession(user.id)
  return NextResponse.json({ ok: true })
}
