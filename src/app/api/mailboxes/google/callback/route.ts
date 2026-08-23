import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/db'
import { mailboxes } from '@/db/schema'
import { seal } from '@/lib/crypto'
import { exchangeCode, profileAddress } from '@/lib/gmail'
import { currentUser } from '@/lib/session'

const base = () => process.env.APP_URL ?? 'http://localhost:3000'
const back = (params: string) => NextResponse.redirect(new URL(`/dashboard/mailboxes?${params}`, base()))

export async function GET(request: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.redirect(new URL('/login', base()))

  const url = new URL(request.url)
  const error = url.searchParams.get('error')
  if (error) return back(`error=${encodeURIComponent(`Google returned: ${error}`)}`)

  const jar = await cookies()
  const expected = jar.get('mh_oauth_state')?.value
  jar.delete('mh_oauth_state')
  if (!expected || url.searchParams.get('state') !== expected) {
    return back('error=Authorization+state+did+not+match.+Try+again.')
  }

  const code = url.searchParams.get('code')
  if (!code) return back('error=Google+did+not+return+an+authorization+code')

  try {
    const tokens = await exchangeCode(code)
    const address = await profileAddress(tokens.accessToken)

    await db
      .insert(mailboxes)
      .values({
        userId: user.id,
        provider: 'gmail',
        address,
        accessToken: seal(tokens.accessToken),
        refreshToken: tokens.refreshToken ? seal(tokens.refreshToken) : null,
        expiresAt: tokens.expiresAt,
        status: 'active',
      })
      .onConflictDoUpdate({
        target: [mailboxes.userId, mailboxes.address],
        set: {
          accessToken: seal(tokens.accessToken),
          ...(tokens.refreshToken ? { refreshToken: seal(tokens.refreshToken) } : {}),
          expiresAt: tokens.expiresAt,
          status: 'active' as const,
        },
      })

    return back(`connected=${encodeURIComponent(address)}`)
  } catch (e) {
    return back(`error=${encodeURIComponent((e as Error).message)}`)
  }
}
