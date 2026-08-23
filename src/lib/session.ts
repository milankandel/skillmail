import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'
import { cache } from 'react'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schema'

const COOKIE = 'sm_session'
const MAX_AGE = 60 * 60 * 24 * 30

function secret(): Uint8Array {
  const s = process.env.APP_SECRET
  if (!s) throw new Error('APP_SECRET is not set')
  return new TextEncoder().encode(s)
}

export async function startSession(userId: string): Promise<void> {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret())

  const jar = await cookies()
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE,
  })
}

export async function endSession(): Promise<void> {
  const jar = await cookies()
  jar.delete(COOKIE)
}

export const currentUser = cache(async () => {
  const jar = await cookies()
  const token = jar.get(COOKIE)?.value
  if (!token) return null

  try {
    const { payload } = await jwtVerify(token, secret())
    const id = String(payload.sub)
    const [user] = await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, id))
      .limit(1)
    return user ?? null
  } catch {
    return null
  }
})

export async function requireUser() {
  const user = await currentUser()
  if (!user) throw new Error('UNAUTHENTICATED')
  return user
}
