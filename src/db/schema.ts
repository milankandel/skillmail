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
  provider: text('provider').$type<'gmail' | 'demo'>().notNull(),
  address: text('address').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  status: text('status').$type<'active' | 'reauth_required'>().default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex('mailboxes_user_address_key').on(t.userId, t.address)])

/** What to pull out of a message, and which messages to bother with. */
export const extractors = pgTable('extractors', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  instruction: text('instruction').notNull(),
  /** JSON Schema the model must fill. Doubles as the CRM payload contract. */
  fields: jsonb('fields').$type<ExtractorField[]>().notNull(),
  /** Only run on messages matching these. Empty means every message. */
  matchFrom: text('match_from'),
  matchSubject: text('match_subject'),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export type ExtractorField = {
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
  extractorId: uuid('extractor_id').notNull().references(() => extractors.id, { onDelete: 'cascade' }),
  status: text('status').$type<'ok' | 'skipped' | 'failed'>().notNull(),
  data: jsonb('data').$type<Record<string, unknown>>(),
  /** The model's own read on whether the email really contained this record. */
  confidence: text('confidence').$type<'high' | 'medium' | 'low'>(),
  reasoning: text('reasoning'),
  model: text('model'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex('extractions_message_extractor_key').on(t.messageId, t.extractorId)])

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
  extractors: many(extractors),
  destinations: many(destinations),
}))

export const messagesRelations = relations(messages, ({ one, many }) => ({
  mailbox: one(mailboxes, { fields: [messages.mailboxId], references: [mailboxes.id] }),
  extractions: many(extractions),
}))

export const extractionsRelations = relations(extractions, ({ one, many }) => ({
  message: one(messages, { fields: [extractions.messageId], references: [messages.id] }),
  extractor: one(extractors, { fields: [extractions.extractorId], references: [extractors.id] }),
  deliveries: many(deliveries),
}))

export const deliveriesRelations = relations(deliveries, ({ one }) => ({
  extraction: one(extractions, { fields: [deliveries.extractionId], references: [extractions.id] }),
  destination: one(destinations, { fields: [deliveries.destinationId], references: [destinations.id] }),
}))
