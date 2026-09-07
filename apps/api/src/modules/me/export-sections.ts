import { Type, type Static } from '@sinclair/typebox';
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { factions, refreshTokens, users } from '../../db/schema/index.js';
import { addDays } from '../../lib/time.js';
import { DateTime, Nullable, StringEnum } from '../../schemas/common.js';
import { USER_ROLES } from './schemas.js';

export const EXPORT_VERSION = 1;

export interface ExportSectionDeps {
  db: Db;
  /** For derived fields such as a refresh token's issue time. */
  refreshTtlDays: number;
}

/**
 * One section of the export bundle (data-model.md §4, research.md R8). Sections are emitted in
 * registration order; later features append `walks`, `captures`, `collection`, `points`,
 * `devices` here without touching the job.
 */
export interface ExportSection {
  name: string;
  run(deps: ExportSectionDeps, userId: string): Promise<unknown>;
}

const AccountSectionSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    appleUserId: Type.String(),
    email: Nullable(Type.String()),
    displayName: Type.String(),
    factionId: Nullable(Type.Integer()),
    factionChangedAt: Nullable(DateTime()),
    xp: Type.Integer(),
    level: Type.Integer(),
    role: StringEnum(USER_ROLES),
    createdAt: DateTime(),
    lastSeenAt: Nullable(DateTime()),
    deletedAt: Nullable(DateTime()),
  },
  { additionalProperties: false },
);

const FactionRefSchema = Type.Object(
  { id: Type.Integer(), slug: Type.String(), name: Type.String() },
  { additionalProperties: false },
);

const SessionSchema = Type.Object(
  {
    issuedAt: DateTime(),
    expiresAt: DateTime(),
    revokedAt: Nullable(DateTime()),
  },
  { additionalProperties: false },
);

/** Shape of the bundle produced by feature 002 (later features add properties). */
export const ExportBundleSchema = Type.Object(
  {
    exportVersion: Type.Literal(EXPORT_VERSION),
    generatedAt: DateTime(),
    account: AccountSectionSchema,
    factions: Type.Array(FactionRefSchema),
    sessions: Type.Array(SessionSchema),
  },
  { additionalProperties: true },
);

export type ExportBundle = Static<typeof ExportBundleSchema>;

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

export const accountSection: ExportSection = {
  name: 'account',
  async run({ db }, userId) {
    const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!row) throw new Error('account not found');
    return {
      id: row.id,
      appleUserId: row.appleSub,
      email: row.email,
      displayName: row.displayName,
      factionId: row.factionId,
      factionChangedAt: iso(row.factionChangedAt),
      xp: row.xp,
      level: row.level,
      role: row.role,
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: iso(row.lastSeenAt),
      deletedAt: iso(row.deletedAt),
    };
  },
};

export const factionsSection: ExportSection = {
  name: 'factions',
  async run({ db }) {
    const rows = await db
      .select({ id: factions.id, slug: factions.slug, name: factions.name })
      .from(factions)
      .orderBy(factions.sort, factions.id);
    return rows;
  },
};

/** Refresh-token metadata only, never the tokens or their hashes. */
export const sessionsSection: ExportSection = {
  name: 'sessions',
  async run({ db, refreshTtlDays }, userId) {
    const rows = await db
      .select({ expiresAt: refreshTokens.expiresAt, revokedAt: refreshTokens.revokedAt })
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, userId))
      .orderBy(desc(refreshTokens.expiresAt));
    return rows.map((row) => ({
      // refresh_tokens has no issued_at column; expiry minus the configured lifetime is exact
      // for tokens issued under the current REFRESH_TTL_DAYS.
      issuedAt: addDays(row.expiresAt, -refreshTtlDays).toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      revokedAt: iso(row.revokedAt),
    }));
  },
};

export const EXPORT_SECTIONS: readonly ExportSection[] = [
  accountSection,
  factionsSection,
  sessionsSection,
];

export function validateExportSections(sections: readonly ExportSection[] = EXPORT_SECTIONS): void {
  const names = new Set<string>();
  for (const section of sections) {
    if (!/^[a-z][a-zA-Z0-9]*$/.test(section.name)) {
      throw new Error(`export section name "${section.name}" must be camelCase`);
    }
    if (names.has(section.name)) throw new Error(`duplicate export section "${section.name}"`);
    if (section.name === 'exportVersion' || section.name === 'generatedAt') {
      throw new Error(`export section "${section.name}" collides with a bundle field`);
    }
    names.add(section.name);
  }
}

/** Builds the bundle of data-model.md §4 by running every section in order. */
export async function buildExportBundle(
  deps: ExportSectionDeps,
  userId: string,
  generatedAt: Date,
  sections: readonly ExportSection[] = EXPORT_SECTIONS,
): Promise<Record<string, unknown>> {
  validateExportSections(sections);
  const bundle: Record<string, unknown> = {
    exportVersion: EXPORT_VERSION,
    generatedAt: generatedAt.toISOString(),
  };
  for (const section of sections) {
    bundle[section.name] = await section.run(deps, userId);
  }
  return bundle;
}
