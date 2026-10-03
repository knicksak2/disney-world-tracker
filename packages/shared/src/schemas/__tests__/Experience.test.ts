/**
 * Unit tests for the shared `experienceSchema`'s `land` field validation.
 *
 * `land` is the themed Land within a ThemePark/WaterPark, resolved during
 * Catalog_Sync and present only when persisted. Its schema declaration is
 * `land: z.string().max(200).nullable().optional()`, mirroring the
 * 200-character persistence cap. These tests cover the four handling cases
 * called out in the task:
 *   - `null`               → accepted (persisted null)
 *   - absent               → accepted (optional / pre-field fixtures)
 *   - a valid string       → accepted (persisted Land name)
 *   - a >200-char string   → rejected (exceeds the persistence length cap)
 *
 * Validates: Requirements 3.1, 3.2, 1.7
 */

import { describe, expect, it } from 'vitest';

import { experienceSchema } from '../Experience.js';

/**
 * A minimal, valid ExperienceDTO base (without `land`) so each case exercises
 * only the `land` field under test. The schema is `.strict()`, so every
 * required field must be present and no unknown key may be added.
 */
const BASE = {
  id: '11111111-1111-5111-8111-111111111111',
  name: 'Space Mountain',
  park: 'Magic Kingdom',
  category: 'Ride',
  description: 'An indoor roller coaster in the dark.',
  active: true,
} as const;

describe('experienceSchema — land validation', () => {
  it('accepts a null land (persisted null)', () => {
    const result = experienceSchema.safeParse({ ...BASE, land: null });
    expect(result.success).toBe(true);
  });

  it('accepts an absent land (optional field)', () => {
    const result = experienceSchema.safeParse(BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.land).toBeUndefined();
    }
  });

  it('accepts a valid land string', () => {
    const result = experienceSchema.safeParse({ ...BASE, land: 'Fantasyland' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.land).toBe('Fantasyland');
    }
  });

  it('accepts a land string exactly at the 200-character cap', () => {
    const land = 'a'.repeat(200);
    const result = experienceSchema.safeParse({ ...BASE, land });
    expect(result.success).toBe(true);
  });

  it('rejects a land string exceeding 200 characters', () => {
    const land = 'a'.repeat(201);
    const result = experienceSchema.safeParse({ ...BASE, land });
    expect(result.success).toBe(false);
  });

  it('rejects a non-string, non-null land value', () => {
    const result = experienceSchema.safeParse({ ...BASE, land: 42 });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// festivalTag validation (festival-booth-tagging R8.1, R8.2)
// ---------------------------------------------------------------------------

describe('experienceSchema — festivalTag validation', () => {
  it('accepts a valid festivalTag', () => {
    const result = experienceSchema.safeParse({
      ...BASE,
      festivalTag: { slug: 'food-and-wine', year: 2026 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.festivalTag).toEqual({ slug: 'food-and-wine', year: 2026 });
    }
  });

  it('accepts an absent festivalTag (optional field)', () => {
    const result = experienceSchema.safeParse(BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.festivalTag).toBeUndefined();
    }
  });

  it('accepts a null festivalTag (persisted null / untagged)', () => {
    const result = experienceSchema.safeParse({ ...BASE, festivalTag: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.festivalTag).toBeNull();
    }
  });

  it('rejects a festivalTag with an invalid (non-enum) slug', () => {
    const result = experienceSchema.safeParse({
      ...BASE,
      festivalTag: { slug: 'not-a-real-festival', year: 2026 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a festivalTag with a non-integer year', () => {
    const result = experienceSchema.safeParse({
      ...BASE,
      festivalTag: { slug: 'food-and-wine', year: 2026.5 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a festivalTag with an extra unknown field (strict object)', () => {
    const result = experienceSchema.safeParse({
      ...BASE,
      festivalTag: { slug: 'food-and-wine', year: 2026, extra: 'nope' },
    });
    expect(result.success).toBe(false);
  });
});
