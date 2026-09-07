import { describe, expect, it } from 'vitest';
import {
  describeDisplayNameRule,
  trimDisplayName,
  validateDisplayName,
} from '../../src/modules/me/display-name.js';

/** The shared vector of data-model.md §2.7 (also run by the Swift `DisplayNameValidatorTests`). */
const VECTOR: Array<[string, ReturnType<typeof validateDisplayName>]> = [
  ['Ąžuolas', { ok: true, value: 'Ąžuolas' }],
  ['  Tadas  ', { ok: true, value: 'Tadas' }],
  ['A', { ok: false, rule: 'tooShort' }],
  ['   ', { ok: false, rule: 'tooShort' }],
  ['abcdefghijklmnopqrstuvwxyz', { ok: false, rule: 'tooLong' }],
  ['ž'.repeat(24), { ok: true, value: 'ž'.repeat(24) }],
  ['ž'.repeat(25), { ok: false, rule: 'tooLong' }],
  ['Ta\nDas', { ok: false, rule: 'controlCharacter' }],
  ['🦉 Owl', { ok: true, value: '🦉 Owl' }],
];

describe('display name rule (data-model.md §2.7)', () => {
  it.each(VECTOR)('%j', (input, expected) => {
    expect(validateDisplayName(input)).toEqual(expected);
  });

  it('rejects tabs, carriage returns and other C0/C1 controls', () => {
    expect(validateDisplayName('Ta\tDas')).toEqual({ ok: false, rule: 'controlCharacter' });
    expect(validateDisplayName('Ta\rDas')).toEqual({ ok: false, rule: 'controlCharacter' });
    expect(validateDisplayName('TaDas')).toEqual({ ok: false, rule: 'controlCharacter' });
    expect(validateDisplayName('TaDas')).toEqual({ ok: false, rule: 'controlCharacter' });
  });

  it('trims Unicode white space including NBSP and NEL', () => {
    expect(trimDisplayName('  Tadas　')).toBe('Tadas');
    expect(validateDisplayName(' Ta')).toEqual({ ok: true, value: 'Ta' });
  });

  it('counts Unicode scalars, not UTF-16 units', () => {
    expect(validateDisplayName('🦉'.repeat(24))).toEqual({ ok: true, value: '🦉'.repeat(24) });
    expect(validateDisplayName('🦉'.repeat(25))).toEqual({ ok: false, rule: 'tooLong' });
  });

  it('describes every rule for the error message', () => {
    expect(describeDisplayNameRule('tooShort')).toMatch(/at least 2/);
    expect(describeDisplayNameRule('tooLong')).toMatch(/at most 24/);
    expect(describeDisplayNameRule('controlCharacter')).toMatch(/control/);
  });
});
