CREATE TABLE "hex_reckoning_history" (
	"h3_r9" bigint NOT NULL,
	"week_id" text NOT NULL,
	"owner_faction_id" smallint,
	"flipped" boolean NOT NULL,
	"from_faction" smallint,
	"to_faction" smallint,
	"captain_user_id" uuid,
	"captain_before_user_id" uuid,
	"strengths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"had_contributions" boolean DEFAULT false NOT NULL,
	"reckoned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hex_reckoning_history_pkey" PRIMARY KEY("h3_r9","week_id")
);
--> statement-breakpoint
CREATE TABLE "reckoning_consistency" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"parents_checked" integer NOT NULL,
	"drifted" integer NOT NULL,
	"repaired" integer DEFAULT 0 NOT NULL,
	"sample" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leaderboard_snapshots" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reckonings" ADD COLUMN "stage" text DEFAULT 'walks' NOT NULL;--> statement-breakpoint
ALTER TABLE "reckonings" ADD COLUMN "cursor_h3_r9" bigint;--> statement-breakpoint
ALTER TABLE "reckonings" ADD COLUMN "batches" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reckonings" ADD COLUMN "parent_flips" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reckonings" ADD COLUMN "walks_autofinished" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reckonings" ADD COLUMN "push_queued" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reckonings" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "reckonings" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "hex_reckoning_history" ADD CONSTRAINT "hex_reckoning_history_owner_faction_id_factions_id_fk" FOREIGN KEY ("owner_faction_id") REFERENCES "public"."factions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hex_reckoning_history" ADD CONSTRAINT "hex_reckoning_history_captain_user_id_users_id_fk" FOREIGN KEY ("captain_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hex_reckoning_history" ADD CONSTRAINT "hex_reckoning_history_captain_before_user_id_users_id_fk" FOREIGN KEY ("captain_before_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hex_reckoning_history_week_idx" ON "hex_reckoning_history" USING btree ("week_id");--> statement-breakpoint
CREATE INDEX "hex_reckoning_history_captain_before_idx" ON "hex_reckoning_history" USING btree ("week_id","captain_before_user_id") WHERE flipped;--> statement-breakpoint
CREATE INDEX "hex_state_last_reckoned_idx" ON "hex_state" USING btree ("last_reckoned_week");--> statement-breakpoint
CREATE UNIQUE INDEX "points_ledger_hex_flip_unique" ON "points_ledger" USING btree ("user_id","ref_id") WHERE kind = 'hex_flip';