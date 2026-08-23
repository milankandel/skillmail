import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { extractors } from '@/db/schema'
import { requireUser } from '@/lib/session'
import { ExtractorList } from '@/components/ExtractorList'

export default async function ExtractorsPage() {
  const user = await requireUser()
  const rows = await db.select().from(extractors).where(eq(extractors.userId, user.id)).orderBy(desc(extractors.createdAt))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Extractors</h1>
        <p className="mt-1 text-sm text-gray-400">
          Each extractor is one record type. The field list becomes the schema the model must fill and the JSON your CRM
          receives, so renaming a field here changes your webhook contract.
        </p>
      </div>
      <ExtractorList rows={rows} />
    </div>
  )
}
