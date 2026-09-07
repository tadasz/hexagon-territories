import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RULES } from '../src/index.js';

const DOC = fileURLToPath(new URL('../../../docs/territory-rules.md', import.meta.url));

/** Parse the "Constants summary" code block of docs/territory-rules.md into key -> value. */
function parseConstantsSummary(markdown: string): Record<string, string | number> {
  const start = markdown.indexOf('## Constants summary');
  if (start < 0) throw new Error(`${DOC}: no "## Constants summary" heading`);
  const block = /```\n([\s\S]*?)```/.exec(markdown.slice(start));
  if (!block?.[1]) throw new Error(`${DOC}: no code block under "Constants summary"`);
  const out: Record<string, string | number> = {};
  for (const rawLine of block[1].split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const m = /^([A-Z0-9_]+)\s*=\s*(.+)$/.exec(line);
    if (!m) throw new Error(`${DOC}: cannot parse constant line "${line}"`);
    const key = m[1]!;
    const value = m[2]!.split('#')[0]!.trim();
    out[key] = value.startsWith('"') ? (JSON.parse(value) as string) : Number(value);
  }
  return out;
}

describe('RULES mirrors docs/territory-rules.md', () => {
  const markdown = readFileSync(DOC, 'utf8');
  const documented = parseConstantsSummary(markdown);

  it('the constants summary is not empty', () => {
    expect(Object.keys(documented).length).toBeGreaterThanOrEqual(13);
  });

  for (const [key, value] of Object.entries(documented)) {
    it(`${key} = ${JSON.stringify(value)}`, () => {
      expect(RULES).toHaveProperty(key);
      expect(RULES[key as keyof typeof RULES]).toBe(value);
    });
  }

  it('walk-acceptance thresholds appear in the "Walk acceptance" table', () => {
    const table = markdown.slice(
      markdown.indexOf('## Walk acceptance'),
      markdown.indexOf('## Scoring at walk finish'),
    );
    expect(table).toContain(`horizontalAccuracy > ${RULES.MAX_SAMPLE_HACC_M} m`);
    expect(table).toContain(`speed > ${RULES.MAX_SAMPLE_SPEED_MPS} m/s`);
    expect(table).toContain(
      `> ${RULES.TELEPORT_SPEED_MPS} m/s between consecutive accepted samples`,
    );
    expect(table).toContain(`> ${RULES.MAX_WALK_MEDIAN_SPEED_MPS} m/s`);
    expect(table).toContain(
      `> ${RULES.MAX_WALK_DISTANCE_M / 1000} km or > ${RULES.MAX_WALK_DURATION_S / 3600} h`,
    );
    expect(table).toContain(`steps / distance < ${RULES.MIN_STEPS_PER_M}`);
    expect(table).toContain(`> ${RULES.NO_STEPS_MIN_DISTANCE_M} m`);
  });

  it('is frozen at the type level and has no extra documented keys', () => {
    const undocumented = [
      'MAX_SAMPLE_HACC_M',
      'MAX_SAMPLE_SPEED_MPS',
      'TELEPORT_SPEED_MPS',
      'MAX_WALK_MEDIAN_SPEED_MPS',
      'MAX_WALK_DISTANCE_M',
      'MAX_WALK_DURATION_S',
      'MIN_STEPS_PER_M',
      'NO_STEPS_MIN_DISTANCE_M',
    ];
    const extra = Object.keys(RULES).filter((k) => !(k in documented) && !undocumented.includes(k));
    expect(extra).toEqual([]);
  });
});
