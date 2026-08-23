import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { skills } from '@/db/schema'
import { requireUser } from '@/lib/session'
import { SkillList } from '@/components/SkillList'

export default async function SkillsPage() {
  const user = await requireUser()
  const rows = await db.select().from(skills).where(eq(skills.userId, user.id)).orderBy(desc(skills.createdAt))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Skills</h1>
        <p className="mt-1 text-sm text-gray-400">
          A skill is one job you have taught the mailbox: the persona it reads as, which messages it owns, and exactly what to
          pull out. Describe it in a sentence and the spec is drafted for you — the field list becomes both the model’s
          output schema and your webhook contract, so renaming a field changes what your CRM receives.
        </p>
      </div>
      <SkillList rows={rows} />
    </div>
  )
}
