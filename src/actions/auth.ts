'use server'

import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { db } from '@/db'
import { users } from '@/db/schema'
import { seedWorkspace } from '@/lib/workspace-seed'
import { endSession, startSession } from '@/lib/session'

export type FormState = { error?: string }

const credentials = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().trim().max(80).optional(),
})

export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = credentials.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { email, password, name } = parsed.data
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  if (existing) return { error: 'An account with that email already exists' }

  const [user] = await db
    .insert(users)
    .values({ email, name: name || null, passwordHash: await bcrypt.hash(password, 12) })
    .returning({ id: users.id })

  await seedWorkspace(user.id)
  await startSession(user.id)
  redirect('/dashboard')
}

export async function logIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = credentials.omit({ name: true }).safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: 'Enter your email and password' }

  const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email)).limit(1)
  // Compare regardless, so a missing account and a wrong password take the
  // same amount of time and cannot be told apart.
  const ok = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin')
  if (!user || !ok) return { error: 'Email or password is incorrect' }

  await startSession(user.id)
  redirect('/dashboard')
}

export async function logOut() {
  await endSession()
  redirect('/')
}
