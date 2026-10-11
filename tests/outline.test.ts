import { describe, expect, it } from 'vitest';
import { parseFiveLines } from '../src/shared/outline.js';

describe('five-line outline', () => {
  it('reads labelled lines, continuations and scene references', () => {
    const lines = parseFiveLines(
      'Setup: two riders leave at dawn (S01–S02)\nDesire: see the quiet side of Evia\nConflict: the strap works loose (S04)\nit takes 40 minutes\n\nChange: a stranger lends a strap\nResult: unknown until the trip',
    )!;
    expect(lines.map((l) => l.label)).toEqual(['Setup', 'Desire', 'Conflict', 'Change', 'Result']);
    expect(lines[0].scenes).toEqual([1, 2]);
    expect(lines[2].text).toBe('the strap works loose (S04) it takes 40 minutes');
    expect(lines[2].scenes).toEqual([4]);
    expect(lines[4].text).toBe('unknown until the trip');
  });

  it('accepts numbered lines and common aliases', () => {
    const lines = parseFiveLines('1. Situation — packing\n2) Want: to leave early\n3. Obstacle: rain')!;
    expect(lines.slice(0, 3).map((l) => l.text)).toEqual(['packing', 'to leave early', 'rain']);
    expect(lines[3].text).toBe('');
  });

  it('ignores free-form outlines and the empty starter', () => {
    expect(parseFiveLines('We ride to the mountains and see what happens.')).toBeNull();
    expect(parseFiveLines('Setup:\nDesire:\nConflict:\nChange:\nResult:\n')).toBeNull();
  });
});
