import { describe, expect, it } from 'vitest';

import { PURGE_STAGES, nextStage } from '../purgePlan.js';

describe('purgePlan', () => {
  it('lists the five stages in order', () => {
    expect([...PURGE_STAGES]).toEqual(['photos', 'trips', 'anonymize', 'personal_data', 'finalize']);
  });

  it('maps the number of completed stages to the next stage', () => {
    expect(nextStage(0)).toBe('photos');
    expect(nextStage(1)).toBe('trips');
    expect(nextStage(2)).toBe('anonymize');
    expect(nextStage(3)).toBe('personal_data');
    expect(nextStage(4)).toBe('finalize');
  });

  it('has no successor after finalize and rejects out-of-range or non-integer input', () => {
    for (const bad of [5, 6, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(nextStage(bad), String(bad)).toBeNull();
    }
  });

  it('walks every stage exactly once from a fresh account', () => {
    const seen: string[] = [];
    for (let done = 0; nextStage(done) !== null; done++) seen.push(nextStage(done)!);
    expect(seen).toEqual([...PURGE_STAGES]);
  });
});
