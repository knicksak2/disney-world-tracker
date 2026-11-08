// Feature: hidden-mickeys, Property 15: Seed parse invariants

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { parseSeedEntries } from '../seedParse.js';
import {
  PARKS,
  MICKEY_ZONES,
  MICKEY_DIFFICULTIES,
  type Park,
  type MickeyZone,
  type MickeyDifficulty,
} from '@dwt/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('seedParse domain module', () => {
  const parkArb = fc.option(fc.constantFrom<Park>(...PARKS), { nil: null });
  const validEntryArb = fc.record({
    seedKey: fc.string({ minLength: 3, maxLength: 50 }).map((s) => s.replace(/[^a-zA-Z0-9-]/g, 'a')),
    upstreamEntityId: fc.string({ minLength: 5, maxLength: 30 }),
    experienceName: fc.string({ minLength: 3, maxLength: 50 }),
    park: parkArb,
    zone: fc.constantFrom<MickeyZone>(...MICKEY_ZONES),
    difficulty: fc.constantFrom<MickeyDifficulty>(...MICKEY_DIFFICULTIES),
    clue1: fc.string({ minLength: 10, maxLength: 140 }),
    clue2: fc.string({ minLength: 10, maxLength: 300 }),
    reveal: fc.string({ minLength: 10, maxLength: 500 }),
    photoUrl: fc.option(fc.string({ minLength: 10, maxLength: 200 }), { nil: undefined }),
  });

  // Feature: hidden-mickeys, Property 15: Seed parse invariants
  it('Property 15: preserves valid order, collapses duplicate keys to the first, and strips photoUrl from output', () => {
    fc.assert(
      fc.property(
        fc.array(validEntryArb, { minLength: 1, maxLength: 20 }),
        (entries) => {
          const result = parseSeedEntries(entries);
          expect(result.invalid).toHaveLength(0);

          // Every valid item must NOT have photoUrl property
          for (const v of result.valid) {
            expect('photoUrl' in v).toBe(false);
          }

          // Valid items are unique by seedKey
          const seenKeys = new Set<string>();
          for (const v of result.valid) {
            expect(seenKeys.has(v.seedKey)).toBe(false);
            seenKeys.add(v.seedKey);
          }

          // Distinct seedKey count in entries equals valid.length
          const distinctKeys = new Set(entries.map((e) => e.seedKey));
          expect(result.valid.length).toBe(distinctKeys.size);

          // Sum of valid and duplicates equals input length
          expect(result.valid.length + result.duplicates.length).toBe(entries.length);

          // The order of valid items matches their first appearance in entries
          let lastSeenIndex = -1;
          for (const v of result.valid) {
            const firstIdx = entries.findIndex((e) => e.seedKey === v.seedKey);
            expect(firstIdx).toBeGreaterThan(lastSeenIndex);
            lastSeenIndex = firstIdx;
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: hidden-mickeys, Property 15: Seed parse invariants
  it('Property 15: rejects unknown fields, non-string photoUrl, or photoUrl > 2048 chars', () => {
    const baseValid = {
      seedKey: 'valid-seed-key',
      upstreamEntityId: '12345;entityType=Attraction',
      experienceName: 'Haunted Mansion',
      park: 'Magic Kingdom' as Park,
      zone: 'queue' as MickeyZone,
      difficulty: 'medium' as MickeyDifficulty,
      clue1: 'Clean clue 1 text',
      clue2: 'Clean clue 2 text with more info',
      reveal: 'Clean reveal text for the test',
    };

    // Unknown field rejected
    const unknownFieldResult = parseSeedEntries([{ ...baseValid, unexpectedField: 'bad' }]);
    expect(unknownFieldResult.valid).toHaveLength(0);
    expect(unknownFieldResult.invalid).toHaveLength(1);
    expect(unknownFieldResult.invalid[0]?.reason).toContain('unexpectedField');

    // Non-string photoUrl rejected
    const nonStringPhotoResult = parseSeedEntries([{ ...baseValid, photoUrl: 12345 }]);
    expect(nonStringPhotoResult.valid).toHaveLength(0);
    expect(nonStringPhotoResult.invalid).toHaveLength(1);

    // PhotoUrl > 2048 characters rejected
    const longPhotoResult = parseSeedEntries([{ ...baseValid, photoUrl: 'https://x.com/' + 'a'.repeat(2045) }]);
    expect(longPhotoResult.valid).toHaveLength(0);
    expect(longPhotoResult.invalid).toHaveLength(1);
    expect(longPhotoResult.invalid[0]?.reason).toContain('photoUrl');
  });

  it('parses the real apps/api/data/hidden-mickeys.seed.json and accepts all entries without field errors', () => {
    const seedFilePath = path.resolve(__dirname, '../../../../../data/hidden-mickeys.seed.json');
    expect(fs.existsSync(seedFilePath)).toBe(true);

    const content = fs.readFileSync(seedFilePath, 'utf-8');
    const rawData = JSON.parse(content);
    expect(Array.isArray(rawData)).toBe(true);

    const result = parseSeedEntries(rawData);
    expect(result.invalid).toEqual([]);
    expect(result.valid.length).toBeGreaterThan(0);
  });
});
