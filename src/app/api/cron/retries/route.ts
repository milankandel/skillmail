import { NextResponse, type NextRequest } from 'next/server'
import { drainRetries } from '@/lib/pipeline'

export const dynamic = 'force-dynamic'

/**
 * Drains delivery backoff. Vercel Cron sends the CRON_SECRET as a bearer
 * token; without a configured secret the route refuses rather than exposing
 * an unauthenticated worker.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const result = await drainRetries()
  return NextResponse.json(result)
}
