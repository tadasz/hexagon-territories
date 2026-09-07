/**
 * Display-name rule shared with `apps/ios/Packages/Core/.../DisplayNameValidator.swift`
 * (specs/002-auth-and-factions/data-model.md §2.7): trim Unicode white space, reject any control
 * character (Unicode category Cc, which includes `\n`, `\r`, `\t`), count Unicode scalars and
 * accept 2–24. Both suites run the same test vector.
 */

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 24;

export type DisplayNameRule = 'tooShort' | 'tooLong' | 'controlCharacter';

export type DisplayNameResult = { ok: true; value: string } | { ok: false; rule: DisplayNameRule };

// `\s` covers Unicode White_Space except U+0085 (NEL), which is added explicitly.
const EDGE_WHITESPACE = /^[\s\u0085]+|[\s\u0085]+$/gu;
const CONTROL = /\p{Cc}/u;

export function trimDisplayName(input: string): string {
  return input.replace(EDGE_WHITESPACE, '');
}

export function validateDisplayName(input: string): DisplayNameResult {
  const value = trimDisplayName(input);
  if (CONTROL.test(value)) return { ok: false, rule: 'controlCharacter' };
  const length = [...value].length;
  if (length < DISPLAY_NAME_MIN) return { ok: false, rule: 'tooShort' };
  if (length > DISPLAY_NAME_MAX) return { ok: false, rule: 'tooLong' };
  return { ok: true, value };
}

export function describeDisplayNameRule(rule: DisplayNameRule): string {
  switch (rule) {
    case 'tooShort':
      return `Display name must be at least ${DISPLAY_NAME_MIN} characters after trimming`;
    case 'tooLong':
      return `Display name must be at most ${DISPLAY_NAME_MAX} characters`;
    case 'controlCharacter':
      return 'Display name must not contain line breaks or control characters';
  }
}
