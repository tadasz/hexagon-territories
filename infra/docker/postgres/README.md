# nature-postgres image

Postgres 16 + PostGIS 3.4 + [h3-pg](https://github.com/zachasme/h3-pg) (from PGXN), used by
`infra/docker-compose.yml`, `make dev`/`make test`, the API integration tests (Testcontainers picks
this tag when it exists locally) and the `api` job of `.github/workflows/api.yml`.

```bash
docker build -t nature-postgres:16-3.4-h3 infra/docker/postgres
docker run --rm -d --name pg -e POSTGRES_USER=nature -e POSTGRES_PASSWORD=nature -e POSTGRES_DB=nature -p 5432:5432 nature-postgres:16-3.4-h3
docker exec pg psql -U nature -d nature -tA -c "select h3_get_resolution(h3_lat_lng_to_cell(point(23.9,54.9), 9))"   # 9
docker exec pg psql -U nature -d nature -tA -c "select postgis_version()"
```

- `H3_PG_VERSION` build arg pins the PGXN release (default `4.2.3`).
- `initdb/10-extensions.sql` enables `postgis`, `h3` and `h3_postgis` in `$POSTGRES_DB` on first
  start. The API migrations enable them again (h3 guarded), so the schema never depends on h3-pg.
- Not published to a registry yet; CI builds it in-job with a GitHub Actions layer cache
  (`plan.md` deviations). Publishing to GHCR is a follow-up.
