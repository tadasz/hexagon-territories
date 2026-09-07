// Barrel for the full docs/architecture.md §6 schema (specs/001-repo-foundations/data-model.md §4).
// drizzle.config.ts points here; `drizzle-orm/node-postgres` receives it as the query schema.
export * from './enums.js';
export * from './factions.js';
export * from './users.js';
export * from './exports.js';
export * from './walks.js';
export * from './hexes.js';
export * from './species.js';
export * from './captures.js';
export * from './game.js';
export * from './ops.js';
