import { neon } from '@neondatabase/serverless'
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http'
import * as schema from './schema'

type Database = NeonHttpDatabase<typeof schema>

let instance: Database | null = null

/**
 * Built lazily. Evaluating the connection at module scope would fail the
 * production build, which imports every route module before any environment
 * variable is needed.
 */
function connect(): Database {
  if (instance) return instance
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  instance = drizzle(neon(url), { schema })
  return instance
}

export const db = new Proxy({} as Database, {
  get: (_target, property) => Reflect.get(connect(), property),
})

export { schema }
