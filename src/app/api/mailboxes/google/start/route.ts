import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { authorizeUrl, isGmailConfigured } from '@/lib/gmail'
import { currentUser } from '@/lib/session'

export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.redirect(new URL('/login', process.env.APP_URL ?? 'http://localhost:3000'))
  if (!isGmailConfigured()) {
    return NextResponse.redirect(
      new URL('/dashboard/mailboxes?error=Gmail+is+not+configured+on+this+deployment', process.env.APP_URL ?? 'http://localhost:3000'),
    )
  }

  // CSRF: the callback only proceeds if state round-trips this cookie.
  const state = randomBytes(16).toString('base64url')
  const jar = await cookies()
  jar.set('mh_oauth_state', state, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 600 })

  return NextResponse.redirect(authorizeUrl(state))
}
