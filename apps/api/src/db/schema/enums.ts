import { pgEnum } from 'drizzle-orm/pg-core';

// The seven enums of specs/001-repo-foundations/data-model.md §4.1 plus `export_status`
// (specs/002-auth-and-factions/data-model.md §1.1).

export const kingdomEnum = pgEnum('kingdom', ['bird', 'plant']);

export const captureStatusEnum = pgEnum('capture_status', [
  'created',
  'uploaded',
  'verifying',
  'verified',
  'needs_user_confirm',
  'rejected',
  'failed',
]);

export const ledgerKindEnum = pgEnum('ledger_kind', [
  'walk_distance',
  'capture_bird',
  'capture_plant',
  'first_species',
  'hex_flip',
  'streak',
  'bonus',
  'adjustment',
]);

export const userRoleEnum = pgEnum('user_role', ['player', 'tester', 'admin']);

export const walkStatusEnum = pgEnum('walk_status', ['active', 'finished', 'flagged', 'abandoned']);

export const candidateSourceEnum = pgEnum('candidate_source', ['device', 'cloud']);

export const reckoningStatusEnum = pgEnum('reckoning_status', ['running', 'done', 'failed']);

/** Lifecycle of an `account_exports` row (feature 002). */
export const exportStatusEnum = pgEnum('export_status', ['pending', 'ready', 'failed']);
