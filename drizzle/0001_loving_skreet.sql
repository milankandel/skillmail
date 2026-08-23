ALTER TABLE "mailboxes" ADD COLUMN "history_id" text;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "sync_query" text DEFAULT 'in:inbox' NOT NULL;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "backfill_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "inbound_token" text;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "last_sync_error" text;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "auto_sync" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "mailboxes_inbound_token_key" ON "mailboxes" USING btree ("inbound_token");