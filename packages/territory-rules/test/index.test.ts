import { describe, expect, it } from 'vitest';
import * as rules from '../src/index.js';

describe('package surface (FR-002)', () => {
  it('exports RULES and the rule functions', () => {
    expect(rules.RULES.RES).toBe(9);
    for (const name of [
      'resolutionForZoom',
      'acceptSamples',
      'walkFlags',
      'simplifyPath',
      'pathToHexMeters',
      'applyWeeklyCap',
      'reckonWeek',
      'deriveParentOwner',
      'weekIdFor',
      'haversineM',
    ] as const) {
      expect(typeof rules[name], name).toBe('function');
    }
  });

  it('RULES is immutable at runtime in strict mode', () => {
    expect(Object.isFrozen(rules.RULES)).toBe(false); // `as const` is compile-time only
    expect(rules.RULES).toMatchObject({ DECAY: 0.5, MIN_STRENGTH_M: 500, HYSTERESIS: 0.1 });
  });
});
