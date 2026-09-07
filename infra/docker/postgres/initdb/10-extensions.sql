-- Executed by docker-entrypoint-initdb.d against $POSTGRES_DB on first start only. Migrations
-- also create these extensions (with h3 guarded), so databases created later, e.g. the per-run
-- test databases, work without this file.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS h3;
CREATE EXTENSION IF NOT EXISTS h3_postgis;
