# ADR 0010: Hetzner for hosting and S3-compatible object storage

**Status**: accepted · **Date**: 2026-09-07

## Context
Media (bird clips ~50 KB, plant photos ~300 KB) — and a self-hosted PMTiles basemap, should we ever switch away from OpenFreeMap (ADR 0003 addendum) — need a bucket; storing them in Postgres or on the VPS disk would bloat backups and put media traffic through the API. Any S3-compatible bucket works.

## Decision
Run the API, worker, Postgres and Caddy with Docker Compose on a Hetzner VPS in Helsinki, and use Hetzner Object Storage (S3 API) for media and tiles through presigned URLs. MinIO stands in locally.

## Consequences
- One vendor and one invoice inside the EU.
- Cloudflare R2 (zero egress) remains an option if media traffic grows; the S3 abstraction makes the switch a configuration change.
