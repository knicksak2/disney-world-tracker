import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { photoKeys } from '../objectKeys.js';

describe('objectKeys properties', () => {
  // Feature: photo-uploads, Property 12: Object keys are derived only from the photo id
  it('Property 12: photoKeys returns four pairwise-distinct keys with disjoint upload and serving prefixes for any UUID, and throws for non-UUID', () => {
    fc.assert(
      fc.property(fc.uuid(), (id) => {
        const keys = photoKeys(id);

        const uploadFullRegex = new RegExp(`^u/${id}/full\\.jpg$`);
        const uploadThumbRegex = new RegExp(`^u/${id}/thumb\\.jpg$`);
        const fullRegex = new RegExp(`^p/${id}/full\\.jpg$`);
        const thumbRegex = new RegExp(`^p/${id}/thumb\\.jpg$`);

        expect(keys.uploadFull).toMatch(uploadFullRegex);
        expect(keys.uploadThumb).toMatch(uploadThumbRegex);
        expect(keys.full).toMatch(fullRegex);
        expect(keys.thumb).toMatch(thumbRegex);

        const allKeys = [keys.uploadFull, keys.uploadThumb, keys.full, keys.thumb];
        const uniqueKeys = new Set(allKeys);
        expect(uniqueKeys.size).toBe(4);

        // Disjoint sets: upload keys start with u/, serving keys start with p/
        expect(keys.uploadFull.startsWith('u/')).toBe(true);
        expect(keys.uploadThumb.startsWith('u/')).toBe(true);
        expect(keys.full.startsWith('p/')).toBe(true);
        expect(keys.thumb.startsWith('p/')).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('throws TypeError for non-UUID strings', () => {
    const invalidIds = [
      '',
      'not-a-uuid',
      '12345',
      '../escape',
      'u/photo/full.jpg',
      '123e4567-e89b-12d3-a456-42661417400', // too short
      '123e4567-e89b-12d3-a456-4266141740000', // too long
    ];
    for (const invalid of invalidIds) {
      expect(() => photoKeys(invalid)).toThrow(TypeError);
    }
  });
});
