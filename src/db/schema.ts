import { relations } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex('users_email_key').on(t.email)])

/** A connected mail account. Tokens are encrypted before they reach this table. */
export const mailboxes = pgTable('mailboxes', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').$type<'gmail' | 'demo' | 'inbound'>().notNull(),
  address: text('address').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  /** Gmail history cursor. Present once a full sync has completed. */
  historyId: text('history_id'),
  /** Gmail search expression bounding what this mailbox pulls. */
  syncQuery: text('sync_query').default('in:inbox').notNull(),
  /** How far back the first sync reaches. Later syncs are incremental. */
  backfillDays: integer('backfill_days').default(7).notNull(),
  /** Routing token for provider-relayed mail. Unique per inbound mailbox. */
  inboundToken: text('inbound_token'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  lastSyncError: text('last_sync_error'),
  autoSync: boolean('auto_sync').default(true).notNull(),
  status: text('status').$type<'active' | 'reauth_required'>().default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('mailboxes_user_address_key').on(t.userId, t.address),
  uniqueIndex('mailboxes_inbound_token_key').on(t.inboundToken),
])

/**
 * A skill is one job the operator has taught the mailbox: who it is acting as,
 * which messages it owns, what to pull out of them, and whether to draft a
 * reply. The field list is the contract — it becomes the model's output schema
 * and the CRM payload at the same time.
 */
export const skills = pgTable('skills', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** Who the model is acting as. Shapes judgement, not just tone. */
  persona: text('persona').notNull(),
  /** What record this skill is looking for, and what does not count. */
  instruction: text('instruction').notNull(),
  fields: jsonb('fields').$type<SkillField[]>().notNull(),
  /** Only run on messages matching these. Empty means every message. */
  matchFrom: text('match_from'),
  matchSubject: text('match_subject'),
  /** When set, the skill also drafts a reply in the persona's voice. */
  draftReply: boolean('draft_reply').default(false).notNull(),
  replyInstruction: text('reply_instruction'),
  /** The prompt the operator typed, kept so the skill can be re-authored. */
  authoredFrom: text('authored_from'),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export type SkillField = {
  key: string
  type: 'string' | 'number' | 'boolean' | 'date' | 'string[]'
  description: string
  required: boolean
}

/** Where the extracted record gets POSTed. */
export const destinations = pgTable('destinations', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  url: text('url').notNull(),
  /** Used to sign every request. Shown to the operator once, then masked. */
  secret: text('secret').notNull(),
  headers: jsonb('headers').$type<Record<string, string>>().default({}).notNull(),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mailboxId: uuid('mailbox_id').notNull().references(() => mailboxes.id, { onDelete: 'cascade' }),
  providerId: text('provider_id').notNull(),
  fromAddress: text('from_address').notNull(),
  fromName: text('from_name'),
  subject: text('subject').notNull(),
  snippet: text('snippet').notNull(),
  body: text('body').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('messages_mailbox_provider_key').on(t.mailboxId, t.providerId),
  index('messages_user_received_idx').on(t.userId, t.receivedAt),
])

export const extractions = pgTable('extractions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  skillId: uuid('skill_id').notNull().references(() => skills.id, { onDelete: 'cascade' }),
  status: text('status').$type<'ok' | 'skipped' | 'failed'>().notNull(),
  data: jsonb('data').$type<Record<string, unknown>>(),
  /** The model's own read on whether the email really contained this record. */
  confidence: text('confidence').$type<'high' | 'medium' | 'low'>(),
  reasoning: text('reasoning'),
  /** Draft reply in the skill's voice, when the skill asks for one. */
  replyDraft: text('reply_draft'),
  model: text('model'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex('extractions_message_skill_key').on(t.messageId, t.skillId)])

export const deliveries = pgTable('deliveries', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  extractionId: uuid('extraction_id').notNull().references(() => extractions.id, { onDelete: 'cascade' }),
  destinationId: uuid('destination_id').notNull().references(() => destinations.id, { onDelete: 'cascade' }),
  status: text('status').$type<'pending' | 'delivered' | 'failed'>().notNull(),
  attempts: integer('attempts').default(0).notNull(),
  responseStatus: integer('response_status'),
  responseBody: text('response_body'),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('deliveries_user_created_idx').on(t.userId, t.createdAt)])

export const usersRelations = relations(users, ({ many }) => ({
  mailboxes: many(mailboxes),
  skills: many(skills),
  destinations: many(destinations),
}))

export const messagesRelations = relations(messages, ({ one, many }) => ({
  mailbox: one(mailboxes, { fields: [messages.mailboxId], references: [mailboxes.id] }),
  extractions: many(extractions),
}))

export const extractionsRelations = relations(extractions, ({ one, many }) => ({
  message: one(messages, { fields: [extractions.messageId], references: [messages.id] }),
  skill: one(skills, { fields: [extractions.skillId], references: [skills.id] }),
  deliveries: many(deliveries),
}))

export const deliveriesRelations = relations(deliveries, ({ one }) => ({
  extraction: one(extractions, { fields: [deliveries.extractionId], references: [extractions.id] }),
  destination: one(destinations, { fields: [deliveries.destinationId], references: [destinations.id] }),
}))
