ALTER TABLE "walk_hex_meters" ADD COLUMN "capped_meters" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "walk_sessions" ADD COLUMN "finish_reason" text;--> statement-breakpoint
ALTER TABLE "walk_sessions" ADD COLUMN "device_info" jsonb;--> statement-breakpoint
ALTER TABLE "walk_sessions" ADD COLUMN "xp_awarded" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "walk_sessions" ADD COLUMN "scored" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "walk_sessions_active_started_idx" ON "walk_sessions" USING btree ("started_at") WHERE status = 'active';