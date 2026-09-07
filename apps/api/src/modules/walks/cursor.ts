import { AppError, ERROR_CODES } from '../../errors.js';

/**
 * Opaque history cursor (research.md R12): base64url of `${startedAt ISO}|${walkId}` of the last
 * returned row. Malformed → 400 VALIDATION_FAILED with `details.field = 'cursor'`.
 */
export interface WalkCursor {
  startedAt: Date;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(cursor: WalkCursor): string {
  return Buffer.from(`${cursor.startedAt.toISOString()}|${cursor.id}`, 'utf8').toString(
    'base64url',
  );
}

export function decodeCursor(encoded: string): WalkCursor {
  const invalid = () =>
    new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Malformed cursor', { field: 'cursor' });
  if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length > 200) throw invalid();
  const text = Buffer.from(encoded, 'base64url').toString('utf8');
  const separator = text.indexOf('|');
  if (separator <= 0) throw invalid();
  const iso = text.slice(0, separator);
  const id = text.slice(separator + 1);
  const startedAt = new Date(iso);
  if (Number.isNaN(startedAt.getTime()) || startedAt.toISOString() !== iso || !UUID.test(id)) {
    throw invalid();
  }
  return { startedAt, id: id.toLowerCase() };
}
