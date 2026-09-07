# syntax=docker/dockerfile:1
# Postgres 16 + PostGIS 3.4 + h3-pg, image tag nature-postgres:16-3.4-h3 (plan.md "Package and
# Target Names"). h3-pg is OPTIONAL for the schema (H3 cells are bigint with precomputed parents,
# docs/architecture.md §6); it is installed so PostGIS cross-checks and MVT experiments can use it.
#
# Validation note: this file could not be built in the authoring container (Docker daemon not
# running). It was validated by review against: the postgis/postgis:16-3.4 image (Debian bookworm,
# PGDG apt repository preconfigured, so postgresql-server-dev-16 resolves), Debian bookworm's
# pgxnclient 1.3.2 package, and the PGXN h3 distribution (4.2.3 provides extensions h3 and
# h3_postgis; it builds the H3 C core with CMake, fetching it with git at build time). CI job `api`
# in .github/workflows/api.yml builds this image on every pull request and runs the smoke query
#   select h3_get_resolution(h3_lat_lng_to_cell(point(23.9,54.9), 9))  -- expected: 9
# so a broken build is caught there (Stream E / first CI run).
FROM postgis/postgis:16-3.4

ARG H3_PG_VERSION=4.2.3

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      cmake \
      git \
      pgxnclient \
      postgresql-server-dev-16; \
    pgxn install "h3=${H3_PG_VERSION}"; \
    apt-get purge -y --auto-remove \
      build-essential \
      cmake \
      git \
      pgxnclient \
      postgresql-server-dev-16; \
    rm -rf /var/lib/apt/lists/* /tmp/* /root/.cache /root/.pgxn

# Runs once when the data directory is initialised (after the PostGIS image's own 10_postgis.sh).
COPY initdb/10-extensions.sql /docker-entrypoint-initdb.d/10-extensions.sql
