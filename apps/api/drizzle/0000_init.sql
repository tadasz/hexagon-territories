-- Hand-edited after `drizzle-kit generate --name init` (specs/001-repo-foundations/data-model.md §4.7):
--   1. extension header: PostGIS is required; h3-pg (h3, h3_postgis) is optional and guarded so the
--      schema never depends on it (docs/architecture.md §6);
--   2. `location_samples` is `PARTITION BY RANGE (ts)` with pk (walk_id, seq, ts) — Drizzle Kit cannot
--      express partitioning; partitions are created by 0001_partitions.sql;
--   3. custom column types (geography, bytea) unquoted — Drizzle Kit quotes unknown type names.
-- Later `drizzle-kit generate` runs diff against meta/0000_snapshot.json, not this file, so these
-- edits are never overwritten.
CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS h3;
  CREATE EXTENSION IF NOT EXISTS h3_postgis;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'h3-pg not available (%), continuing without it', SQLERRM;
END $$;--> statement-breakpoint
CREATE TYPE "public"."candidate_source" AS ENUM('device', 'cloud');--> statement-breakpoint
CREATE TYPE "public"."capture_status" AS ENUM('created', 'uploaded', 'verifying', 'verified', 'needs_user_confirm', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."kingdom" AS ENUM('bird', 'plant');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('walk_distance', 'capture_bird', 'capture_plant', 'first_species', 'hex_flip', 'streak', 'bonus', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."reckoning_status" AS ENUM('running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('player', 'tester', 'admin');--> statement-breakpoint
CREATE TYPE "public"."walk_status" AS ENUM('active', 'finished', 'flagged', 'abandoned');--> statement-breakpoint
CREATE TABLE "factions" (
	"id" smallint PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"emoji" text NOT NULL,
	"color_light" text NOT NULL,
	"color_dark" text NOT NULL,
	"sort" smallint NOT NULL,
	CONSTRAINT "factions_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"apns_token" text,
	"app_version" text,
	"os_version" text,
	"model" text,
	"attested" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_apns_token_unique" UNIQUE("apns_token")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" bytea NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"device_id" uuid,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"apple_sub" text NOT NULL,
	"email" text,
	"display_name" text NOT NULL,
	"faction_id" smallint,
	"faction_changed_at" timestamp with time zone,
	"xp" integer DEFAULT 0 NOT NULL,
	"level" smallint DEFAULT 1 NOT NULL,
	"role" "user_role" DEFAULT 'player' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_apple_sub_unique" UNIQUE("apple_sub")
);
--> statement-breakpoint
CREATE TABLE "location_samples" (
	"walk_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"h_acc" real NOT NULL,
	"speed" real,
	"course" real,
	"alt" real,
	"accepted" boolean DEFAULT true NOT NULL,
	"reject_reason" text,
	CONSTRAINT "location_samples_pkey" PRIMARY KEY("walk_id","seq","ts")
) PARTITION BY RANGE ("ts");
--> statement-breakpoint
CREATE TABLE "walk_hex_meters" (
	"walk_id" uuid NOT NULL,
	"h3_r9" bigint NOT NULL,
	"meters" real NOT NULL,
	CONSTRAINT "walk_hex_meters_pkey" PRIMARY KEY("walk_id","h3_r9")
);
--> statement-breakpoint
CREATE TABLE "walk_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_walk_id" uuid NOT NULL,
	"faction_id" smallint,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"status" "walk_status" DEFAULT 'active' NOT NULL,
	"week_id" text,
	"distance_m" real,
	"duration_s" integer,
	"steps" integer,
	"path" geography(LineString,4326),
	"path_simplified" geography(LineString,4326),
	"sample_count" integer DEFAULT 0 NOT NULL,
	"hex_count" integer DEFAULT 0 NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"device_id" uuid,
	CONSTRAINT "walk_sessions_user_client_walk_unique" UNIQUE("user_id","client_walk_id")
);
--> statement-breakpoint
CREATE TABLE "hex_faction_strength" (
	"h3_r9" bigint NOT NULL,
	"faction_id" smallint NOT NULL,
	"strength" real DEFAULT 0 NOT NULL,
	"last_reckoned_week" text,
	CONSTRAINT "hex_faction_strength_pkey" PRIMARY KEY("h3_r9","faction_id")
);
--> statement-breakpoint
CREATE TABLE "hex_ownership_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"h3_r9" bigint NOT NULL,
	"week_id" text NOT NULL,
	"from_faction" smallint,
	"to_faction" smallint,
	"cause" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hex_parent_state" (
	"h3" bigint PRIMARY KEY NOT NULL,
	"res" smallint NOT NULL,
	"geom" geometry(Polygon,4326) NOT NULL,
	"owner_faction_id" smallint,
	"child_owner_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"claimed_children" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hex_state" (
	"h3_r9" bigint PRIMARY KEY NOT NULL,
	"h3_r8" bigint NOT NULL,
	"h3_r7" bigint NOT NULL,
	"h3_r6" bigint NOT NULL,
	"h3_r5" bigint NOT NULL,
	"geom" geometry(Polygon,4326) NOT NULL,
	"owner_faction_id" smallint,
	"owner_since_week" text,
	"captain_user_id" uuid,
	"last_reckoned_week" text,
	"last_activity_week" text,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hex_week_contribution" (
	"h3_r9" bigint NOT NULL,
	"week_id" text NOT NULL,
	"faction_id" smallint NOT NULL,
	"user_id" uuid NOT NULL,
	"meters" real DEFAULT 0 NOT NULL,
	"capped_meters" real DEFAULT 0 NOT NULL,
	"capture_bonus_m" real DEFAULT 0 NOT NULL,
	"walks" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hex_week_contribution_pkey" PRIMARY KEY("h3_r9","week_id","faction_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "reckonings" (
	"week_id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"hexes_processed" integer DEFAULT 0 NOT NULL,
	"flips" integer DEFAULT 0 NOT NULL,
	"status" "reckoning_status" DEFAULT 'running' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "species" (
	"id" serial PRIMARY KEY NOT NULL,
	"kingdom" "kingdom" NOT NULL,
	"scientific_name" text NOT NULL,
	"common_name_en" text,
	"common_name_lt" text,
	"family" text,
	"gbif_key" integer,
	"birdnet_label" text,
	"plantnet_id" text,
	"rarity_tier" smallint DEFAULT 1 NOT NULL,
	"image_url" text,
	"image_license" text,
	"image_attribution" text,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "species_scientific_name_unique" UNIQUE("scientific_name"),
	CONSTRAINT "species_gbif_key_unique" UNIQUE("gbif_key"),
	CONSTRAINT "species_birdnet_label_unique" UNIQUE("birdnet_label")
);
--> statement-breakpoint
CREATE TABLE "species_region" (
	"species_id" integer NOT NULL,
	"region_code" text NOT NULL,
	CONSTRAINT "species_region_pkey" PRIMARY KEY("species_id","region_code")
);
--> statement-breakpoint
CREATE TABLE "species_season" (
	"species_id" integer NOT NULL,
	"week" smallint NOT NULL,
	"present" boolean NOT NULL,
	CONSTRAINT "species_season_pkey" PRIMARY KEY("species_id","week"),
	CONSTRAINT "species_season_week_check" CHECK ("species_season"."week" between 1 and 53)
);
--> statement-breakpoint
CREATE TABLE "capture_candidates" (
	"capture_id" uuid NOT NULL,
	"source" "candidate_source" NOT NULL,
	"rank" smallint NOT NULL,
	"species_id" integer,
	"raw_label" text NOT NULL,
	"confidence" real NOT NULL,
	CONSTRAINT "capture_candidates_pkey" PRIMARY KEY("capture_id","source","rank")
);
--> statement-breakpoint
CREATE TABLE "captures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_capture_id" uuid NOT NULL,
	"walk_id" uuid,
	"kind" "kingdom" NOT NULL,
	"faction_id" smallint,
	"h3_r9" bigint NOT NULL,
	"week_id" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"media_key" text,
	"media_type" text,
	"media_bytes" integer,
	"device_model_version" text,
	"device_species_id" integer,
	"device_confidence" real,
	"cloud_provider" text,
	"cloud_model_version" text,
	"cloud_species_id" integer,
	"cloud_confidence" real,
	"cloud_raw" jsonb,
	"final_species_id" integer,
	"status" "capture_status" DEFAULT 'created' NOT NULL,
	"bonus_m" real DEFAULT 0 NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "captures_user_client_capture_unique" UNIQUE("user_id","client_capture_id")
);
--> statement-breakpoint
CREATE TABLE "user_species" (
	"user_id" uuid NOT NULL,
	"species_id" integer NOT NULL,
	"first_capture_id" uuid,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"capture_count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "user_species_pkey" PRIMARY KEY("user_id","species_id")
);
--> statement-breakpoint
CREATE TABLE "faction_stats_weekly" (
	"week_id" text NOT NULL,
	"faction_id" smallint NOT NULL,
	"hexes_owned_r9" integer DEFAULT 0 NOT NULL,
	"hexes_owned_r7" integer DEFAULT 0 NOT NULL,
	"meters" real DEFAULT 0 NOT NULL,
	"active_users" integer DEFAULT 0 NOT NULL,
	"captures" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "faction_stats_weekly_pkey" PRIMARY KEY("week_id","faction_id")
);
--> statement-breakpoint
CREATE TABLE "leaderboard_snapshots" (
	"week_id" text NOT NULL,
	"scope" text NOT NULL,
	"scope_id" text DEFAULT '' NOT NULL,
	"rank" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"meters" real DEFAULT 0 NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leaderboard_snapshots_pkey" PRIMARY KEY("week_id","scope","scope_id","rank")
);
--> statement-breakpoint
CREATE TABLE "points_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"faction_id" smallint,
	"kind" "ledger_kind" NOT NULL,
	"points" integer NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"h3_r9" bigint,
	"week_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "streaks" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"current_days" integer DEFAULT 0 NOT NULL,
	"longest_days" integer DEFAULT 0 NOT NULL,
	"last_active_date" date,
	"tz" text DEFAULT 'UTC' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anti_cheat_flags" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"walk_id" uuid,
	"capture_id" uuid,
	"code" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_samples" ADD CONSTRAINT "location_samples_walk_id_walk_sessions_id_fk" FOREIGN KEY ("walk_id") REFERENCES "public"."walk_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walk_hex_meters" ADD CONSTRAINT "walk_hex_meters_walk_id_walk_sessions_id_fk" FOREIGN KEY ("walk_id") REFERENCES "public"."walk_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walk_sessions" ADD CONSTRAINT "walk_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walk_sessions" ADD CONSTRAINT "walk_sessions_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walk_sessions" ADD CONSTRAINT "walk_sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hex_faction_strength" ADD CONSTRAINT "hex_faction_strength_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hex_parent_state" ADD CONSTRAINT "hex_parent_state_owner_faction_id_factions_id_fk" FOREIGN KEY ("owner_faction_id") REFERENCES "public"."factions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hex_state" ADD CONSTRAINT "hex_state_owner_faction_id_factions_id_fk" FOREIGN KEY ("owner_faction_id") REFERENCES "public"."factions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hex_state" ADD CONSTRAINT "hex_state_captain_user_id_users_id_fk" FOREIGN KEY ("captain_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hex_week_contribution" ADD CONSTRAINT "hex_week_contribution_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hex_week_contribution" ADD CONSTRAINT "hex_week_contribution_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "species_region" ADD CONSTRAINT "species_region_species_id_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."species"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "species_season" ADD CONSTRAINT "species_season_species_id_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."species"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_candidates" ADD CONSTRAINT "capture_candidates_capture_id_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_candidates" ADD CONSTRAINT "capture_candidates_species_id_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."species"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_walk_id_walk_sessions_id_fk" FOREIGN KEY ("walk_id") REFERENCES "public"."walk_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_device_species_id_species_id_fk" FOREIGN KEY ("device_species_id") REFERENCES "public"."species"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_cloud_species_id_species_id_fk" FOREIGN KEY ("cloud_species_id") REFERENCES "public"."species"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_final_species_id_species_id_fk" FOREIGN KEY ("final_species_id") REFERENCES "public"."species"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_species" ADD CONSTRAINT "user_species_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_species" ADD CONSTRAINT "user_species_species_id_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."species"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_species" ADD CONSTRAINT "user_species_first_capture_id_captures_id_fk" FOREIGN KEY ("first_capture_id") REFERENCES "public"."captures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faction_stats_weekly" ADD CONSTRAINT "faction_stats_weekly_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_snapshots" ADD CONSTRAINT "leaderboard_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streaks" ADD CONSTRAINT "streaks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anti_cheat_flags" ADD CONSTRAINT "anti_cheat_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anti_cheat_flags" ADD CONSTRAINT "anti_cheat_flags_walk_id_walk_sessions_id_fk" FOREIGN KEY ("walk_id") REFERENCES "public"."walk_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anti_cheat_flags" ADD CONSTRAINT "anti_cheat_flags_capture_id_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devices_user_id_idx" ON "devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_faction_id_idx" ON "users" USING btree ("faction_id");--> statement-breakpoint
CREATE INDEX "users_deleted_at_idx" ON "users" USING btree ("deleted_at") WHERE deleted_at is not null;--> statement-breakpoint
CREATE INDEX "location_samples_ts_idx" ON "location_samples" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "walk_hex_meters_h3_r9_idx" ON "walk_hex_meters" USING btree ("h3_r9");--> statement-breakpoint
CREATE INDEX "walk_sessions_user_started_idx" ON "walk_sessions" USING btree ("user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "walk_sessions_path_simplified_gist" ON "walk_sessions" USING gist ("path_simplified");--> statement-breakpoint
CREATE INDEX "walk_sessions_active_user_idx" ON "walk_sessions" USING btree ("user_id") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "walk_sessions_week_id_idx" ON "walk_sessions" USING btree ("week_id");--> statement-breakpoint
CREATE INDEX "hex_ownership_events_h3_at_idx" ON "hex_ownership_events" USING btree ("h3_r9","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "hex_ownership_events_week_id_idx" ON "hex_ownership_events" USING btree ("week_id");--> statement-breakpoint
CREATE INDEX "hex_parent_state_res_idx" ON "hex_parent_state" USING btree ("res");--> statement-breakpoint
CREATE INDEX "hex_parent_state_geom_gist" ON "hex_parent_state" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "hex_parent_state_owner_faction_id_idx" ON "hex_parent_state" USING btree ("owner_faction_id");--> statement-breakpoint
CREATE INDEX "hex_state_h3_r8_idx" ON "hex_state" USING btree ("h3_r8");--> statement-breakpoint
CREATE INDEX "hex_state_h3_r7_idx" ON "hex_state" USING btree ("h3_r7");--> statement-breakpoint
CREATE INDEX "hex_state_h3_r6_idx" ON "hex_state" USING btree ("h3_r6");--> statement-breakpoint
CREATE INDEX "hex_state_h3_r5_idx" ON "hex_state" USING btree ("h3_r5");--> statement-breakpoint
CREATE INDEX "hex_state_geom_gist" ON "hex_state" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "hex_state_owner_faction_id_idx" ON "hex_state" USING btree ("owner_faction_id");--> statement-breakpoint
CREATE INDEX "hex_week_contribution_week_h3_idx" ON "hex_week_contribution" USING btree ("week_id","h3_r9");--> statement-breakpoint
CREATE INDEX "hex_week_contribution_user_week_idx" ON "hex_week_contribution" USING btree ("user_id","week_id");--> statement-breakpoint
CREATE INDEX "species_kingdom_idx" ON "species" USING btree ("kingdom");--> statement-breakpoint
CREATE INDEX "species_region_region_species_idx" ON "species_region" USING btree ("region_code","species_id");--> statement-breakpoint
CREATE INDEX "captures_user_created_idx" ON "captures" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "captures_h3_r9_idx" ON "captures" USING btree ("h3_r9");--> statement-breakpoint
CREATE INDEX "captures_verification_queue_idx" ON "captures" USING btree ("status","created_at") WHERE status in ('uploaded', 'verifying');--> statement-breakpoint
CREATE INDEX "leaderboard_snapshots_user_week_idx" ON "leaderboard_snapshots" USING btree ("user_id","week_id");--> statement-breakpoint
CREATE INDEX "points_ledger_user_created_idx" ON "points_ledger" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "points_ledger_week_faction_idx" ON "points_ledger" USING btree ("week_id","faction_id");--> statement-breakpoint
CREATE INDEX "points_ledger_h3_r9_idx" ON "points_ledger" USING btree ("h3_r9");--> statement-breakpoint
CREATE INDEX "anti_cheat_flags_user_id_idx" ON "anti_cheat_flags" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "anti_cheat_flags_open_idx" ON "anti_cheat_flags" USING btree ("created_at") WHERE resolved_at is null;