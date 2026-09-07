# ADR 0002: TypeScript API on Postgres/PostGIS

**Status**: accepted · **Date**: 2026-09-07

## Context
The owner chose a custom API with Postgres over BaaS products. The choice between Node and Go remained open.

## Decision
Node 22 + TypeScript + Fastify 5, TypeBox schemas generating OpenAPI, Drizzle ORM, pg-boss for jobs. Postgres 16 with PostGIS; h3-pg is optional. H3 cells are stored as `bigint` with parents precomputed in app code.

## Rationale
`h3-js` v4 is the same library family as the prototype, so territory rules live in one shared TypeScript package tested against fixtures the Swift port also runs. Heavy geo work happens in PostGIS and bird verification in a Python worker, so Go's CPU advantage buys nothing at launch scale. One language for API, rules, replay tool and schema generation.

## Consequences
- The iOS API client is generated from OpenAPI; no hand-written client code.
- Jobs need only Postgres (pg-boss), no Redis.

## Alternatives
Go + h3-go + sqlc (better ingest throughput, cgo friction, second language); Hono or NestJS.
