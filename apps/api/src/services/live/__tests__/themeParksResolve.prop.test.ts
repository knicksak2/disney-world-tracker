// Feature: disney-source-resilience, Property 12: ThemeParks entity resolution
/**
 * Property-based tests for the ThemeParks.wiki entity resolver.
 *
 * Validates: Requirements 11.2, 13.4
 *
 * The Live_Service joins catalog Experiences to ThemeParks.wiki live data by a
 * single narrow correspondence: the Experience's `Enterprise_Id` equals the
 * ThemeParks.wiki entity's `External_Id` (`externalId`). Design Property 12
 * pins down the matching discipline of {@link resolveThemeParksEntity}:
 *
 *   1. When at least one entity has `externalId === enterpriseId` (and
 *      `enterpriseId` is non-empty) the resolver returns the FIRST such entity
 *      in iteration order.
 *   2. When no entity has `externalId === enterpriseId` the resolver returns
 *      `null` — even if some entity's `id` or another key equals
 *      `enterpriseId` (it never falls back to another key).
 *   3. An empty `enterpriseId` (`''`) resolves to `null` regardless of the
 *      dataset (absent/empty keys never match).
 *   4. Any non-null result always satisfies `externalId === enterpriseId`.
 *
 * Generators deliberately manufacture collisions on OTHER fields (an entity's
 * `id`/`name` set equal to the target) and entities with missing/empty
 * `externalId` to prove the resolver matches on `externalId` and nothing else.
 * Each `fc.assert` runs with `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  resolveThemeParksEntity,
  type ResolvableThemeParksEntity,
} from '../resolveEntity.js';

const NUM_RUNS = 100;

/** An entity plus an optional `name` key to prove non-`externalId` keys never match. */
interface TestEntity extends ResolvableThemeParksEntity {
  readonly name?: string;
}

/** Non-empty key arbitrary; kept small so collisions occur across a dataset. */
const key = fc.string({ minLength: 1, maxLength: 6 });

/**
 * Build an entity arbitrary parameterised by the target `enterpriseId`.
 *
 * Each entity independently decides whether its `externalId` matches the
 * target, differs from it, or is absent/empty; and whether its OTHER keys
 * (`id`, `name`) coincidentally equal the target. This mixes matching,
 * non-matching, key-less, and decoy entities into every generated dataset.
 */
function entityArb(enterpriseId: string): fc.Arbitrary<TestEntity> {
  const externalIdArb = fc.oneof(
    fc.constant<string | undefined>(enterpriseId), // matches the target
    fc.constant<string | undefined>(undefined), // absent key
    fc.constant<string | undefined>(''), // empty key
    key.filter((k) => k !== enterpriseId), // deliberately differs
  );

  // `id`/`name` are sometimes set equal to the target to prove they are ignored.
  const idArb = fc.oneof(fc.constant(enterpriseId || 'x'), key);
  const nameArb = fc.oneof(
    fc.constant<string | undefined>(enterpriseId),
    fc.constant<string | undefined>(undefined),
    key,
  );

  // Build the entity via `.map` so optional keys are OMITTED (not set to
  // `undefined`) when absent, honoring `exactOptionalPropertyTypes`. This keeps
  // the same mix as `requiredKeys: ['id']`: `id` is always present while
  // `externalId`/`name` may be present (matching/differing/empty) or absent.
  return fc
    .record({ id: idArb, externalId: externalIdArb, name: nameArb })
    .map(({ id, externalId, name }): TestEntity => ({
      id,
      ...(externalId !== undefined ? { externalId } : {}),
      ...(name !== undefined ? { name } : {}),
    }));
}

/** A non-empty `enterpriseId` paired with an arbitrary candidate dataset. */
const nonEmptyCase = key.chain((enterpriseId) =>
  fc
    .array(entityArb(enterpriseId), { maxLength: 12 })
    .map((entities) => ({ enterpriseId, entities })),
);

describe('resolveThemeParksEntity (Property 12: ThemeParks entity resolution)', () => {
  it('returns the FIRST entity whose externalId equals a non-empty enterpriseId (Assertion 1)', () => {
    fc.assert(
      fc.property(nonEmptyCase, ({ enterpriseId, entities }) => {
        const expected =
          entities.find((e) => e.externalId === enterpriseId) ?? null;
        // Only exercise this assertion when a match exists in the dataset.
        fc.pre(expected !== null);

        const result = resolveThemeParksEntity(enterpriseId, entities);
        // First match in iteration order — identity, not just field equality.
        expect(result).toBe(expected);
        expect(result?.externalId).toBe(enterpriseId);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns null when no externalId matches, even if id/name coincide (Assertion 2)', () => {
    fc.assert(
      fc.property(nonEmptyCase, ({ enterpriseId, entities }) => {
        // Drop every genuine externalId match so only decoy collisions remain.
        const withoutMatch = entities.filter(
          (e) => e.externalId !== enterpriseId,
        );

        const result = resolveThemeParksEntity(enterpriseId, withoutMatch);
        expect(result).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns null for an empty enterpriseId regardless of dataset (Assertion 3)', () => {
    fc.assert(
      fc.property(
        // Datasets built around a non-empty target still get probed with '',
        // and we also inject entities whose externalId is '' to prove an empty
        // key never matches an empty target.
        fc.array(entityArb(''), { maxLength: 12 }),
        (entities) => {
          const result = resolveThemeParksEntity('', entities);
          expect(result).toBeNull();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('any non-null result always has externalId === enterpriseId (Assertion 4)', () => {
    fc.assert(
      fc.property(nonEmptyCase, ({ enterpriseId, entities }) => {
        const result = resolveThemeParksEntity(enterpriseId, entities);
        if (result !== null) {
          expect(result.externalId).toBe(enterpriseId);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
