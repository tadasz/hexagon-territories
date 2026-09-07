-- Custom migration (specs/001-repo-foundations/data-model.md §4.7): range partitions for
-- location_samples. Raw GPS samples are kept 30 days (Constitution IV); monthly partitions let the
-- purge job drop whole months. `ensure_location_samples_partition(month)` is idempotent and is
-- called for the current and the next month here; the purge job (feature 003) calls it forward.
CREATE TABLE IF NOT EXISTS "location_samples_default" PARTITION OF "location_samples" DEFAULT;--> statement-breakpoint
CREATE OR REPLACE FUNCTION ensure_location_samples_partition(month date) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  start_date date := date_trunc('month', month)::date;
  end_date   date := (date_trunc('month', month) + interval '1 month')::date;
  partition_name text := format('location_samples_y%sm%s', to_char(start_date, 'YYYY'), to_char(start_date, 'MM'));
BEGIN
  IF to_regclass(partition_name) IS NULL THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF location_samples FOR VALUES FROM (%L) TO (%L)',
      partition_name,
      start_date::timestamp AT TIME ZONE 'UTC',
      end_date::timestamp AT TIME ZONE 'UTC'
    );
  END IF;
END
$$;--> statement-breakpoint
SELECT ensure_location_samples_partition((date_trunc('month', now() AT TIME ZONE 'UTC'))::date);--> statement-breakpoint
SELECT ensure_location_samples_partition((date_trunc('month', now() AT TIME ZONE 'UTC') + interval '1 month')::date);
