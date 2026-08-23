'use server'

import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { db } from '@/db'
import { destinations, extractors, mailboxes, users } from '@/db/schema'
import { newSecret } from '@/lib/crypto'
import { endSession, startSession } from '@/lib/session'

export type FormState = { error?: string }

const credentials = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().trim().max(80).optional(),
})

/**
 * A fresh account gets a demo mailbox, one worked example of an extractor, and
 * a request-bin destination, so the first sync produces something to look at
 * without the operator configuring anything first.
 */
async function seedWorkspace(userId: string) {
  await db.insert(mailboxes).values({ userId, provider: 'demo', address: 'demo-inbox@mailhook.dev' })
  await db.insert(extractors).values({
    userId,
    name: 'Inbound quote request',
    instruction:
      'Extract a freight quote request: who is asking, what they need moved, where from and to, and what they are willing to pay.',
    fields: [
      { key: 'company', type: 'string', description: 'The requesting company name.', required: true },
      { key: 'contactName', type: 'string', description: 'Full name of the person asking.', required: false },
      { key: 'contactEmail', type: 'string', description: 'Reply-to email address.', required: true },
      { key: 'originCity', type: 'string', description: 'City or port the freight moves from.', required: true },
      { key: 'destinationCity', type: 'string', description: 'City the freight moves to.', required: true },
      { key: 'containerNumbers', type: 'string[]', description: 'Every container or equipment number listed.', required: false },
      { key: 'loadCount', type: 'number', description: 'How many loads or containers in total.', required: false },
      { key: 'targetRateUsd', type: 'number', description: 'Rate per load the sender named, in USD.', required: false },
      { key: 'respondBy', type: 'date', description: 'Date the sender needs an answer by.', required: false },
    ],
    active: true,
  })
  await db.insert(destinations).values({
    userId,
    name: 'Sandbox endpoint',
    url: 'https://webhook.site/replace-me',
    secret: newSecret(),
    active: false,
  })
}

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
