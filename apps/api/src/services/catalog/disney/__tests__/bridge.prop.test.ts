// Feature: disney-facilities-catalog-source, Property 11: Internal ids are a deterministic one-to-one derivation, bridged for continuity
/**
 * Property-based tests for the identity Bridge_Map (design.md → "9. Identity
 * Bridge_Map").
 *
 * NOTE: This file is shared. Each property owns a distinct top-level
 * `describe` block and its own `// Feature: ...` tag line — append new
 * properties, never clobber existing ones.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { v5 as uuidv5, validate as uuidValidate } from 'uuid';

import { assignInternalId, INTERNAL_ID_NAMESPACE } from '../bridge.js';
import { internalId } from '../../internalId.js';

const NUM_RUNS = 100;

/**
 * A realistic `Enterprise_Id` (`{numericId};entityType={Type}`) mixed with
 * fully-arbitrary non-empty strings, so the derivation is exercised across
 * both the shaped ids the system actually assigns and the broader input space
 * UUIDv5 must tolerate. Experiences and Resorts share this single assignment
 * path, so no per-type generator is needed (R6.6).
 */
const entityTypeArb = fc.constantFrom(
  'Attraction',
  'Entertainment',
  'Restaurant',
  'resort',
  'tour',
  'recreation-activity',
);

const enterpriseIdArb: fc.Arbitrary<string> = fc.oneof(
  fc
    .tuple(fc.integer({ min: 1, max: 99_999_999 }), entityTypeArb)
    .map(([n, t]) => `${n};entityType=${t}`),
  fc.string({ minLength: 1, maxLength: 40 }),
);

/**
 * A previously derived Internal_Id (the value a Bridge_Map entry maps to). Real
 * bridged values are UUIDs derived from the retired ThemeParks.wiki entity ids;
 * `fc.uuid()` models that shape without coupling to any specific upstream id.
 */
const bridgedIdArb: fc.Arbitrary<string> = fc.uuid();

/** A Bridge_Map: Enterprise_Id -> previously derived Internal_Id. */
const bridgeMapArb: fc.Arbitrary<ReadonlyMap<string, string>> = fc
  .array(fc.tuple(enterpriseIdArb, bridgedIdArb), { maxLength: 12 })
  .map((entries) => new Map(entries));

describe('bridge — Property 11: deterministic one-to-one derivation, bridged for continuity', () => {
  it('derives a valid UUIDv5 over the fixed namespace for any Enterprise_Id (R10.1, R10.4, R6.6)', () => {
    fc.assert(
      fc.property(enterpriseIdArb, (enterpriseId) => {
        const derived = internalId(enterpriseId);
        // Reuses the single canonical namespace — assignment (unbridged) and
        // the shared `internalId` derive identically.
        expect(derived).toBe(uuidv5(enterpriseId, INTERNAL_ID_NAMESPACE));
        expect(assignInternalId(enterpriseId, new Map())).toBe(derived);
        expect(uuidValidate(derived)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is deterministic: the same Enterprise_Id always derives the same Internal_Id (R10.1)', () => {
    fc.assert(
      fc.property(enterpriseIdArb, (enterpriseId) => {
        expect(internalId(enterpriseId)).toBe(internalId(enterpriseId));
        const empty = new Map<string, string>();
        expect(assignInternalId(enterpriseId, empty)).toBe(
          assignInternalId(enterpriseId, empty),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is one-to-one: equal ids share a derivation, distinct ids derive distinctly (R10.1)', () => {
    fc.assert(
      fc.property(enterpriseIdArb, enterpriseIdArb, (a, b) => {
        if (a === b) {
          expect(internalId(a)).toBe(internalId(b));
        } else {
          expect(internalId(a)).not.toBe(internalId(b));
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns the bridged Internal_Id verbatim when the Enterprise_Id is in the Bridge_Map (R10.3, R10.5)', () => {
    // Every id present in the map must resolve to its bridged value — the id
    // its Completions, Ratings, and Notes already reference — regardless of
    // what the fresh UUIDv5 derivation would produce.
    fc.assert(
      fc.property(bridgeMapArb, (bridge) => {
        for (const [enterpriseId, bridgedId] of bridge) {
          expect(assignInternalId(enterpriseId, bridge)).toBe(bridgedId);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('preserves continuity: a bridged assignment yields the prior id, not the fresh derivation, when they differ (R10.3, R10.5)', () => {
    fc.assert(
      fc.property(enterpriseIdArb, bridgedIdArb, (enterpriseId, bridgedId) => {
        const bridge = new Map<string, string>([[enterpriseId, bridgedId]]);
        const assigned = assignInternalId(enterpriseId, bridge);
        expect(assigned).toBe(bridgedId);
        if (bridgedId !== internalId(enterpriseId)) {
          expect(assigned).not.toBe(internalId(enterpriseId));
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('falls back to the fresh UUIDv5 derivation when the Enterprise_Id is absent from the Bridge_Map (R10.4)', () => {
    fc.assert(
      fc.property(bridgeMapArb, enterpriseIdArb, (bridge, enterpriseId) => {
        // Ensure the id is genuinely unbridged.
        const unbridged = new Map(bridge);
        unbridged.delete(enterpriseId);
        expect(assignInternalId(enterpriseId, unbridged)).toBe(internalId(enterpriseId));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// Feature: disney-facilities-catalog-source, Property 12: The Bridge_Map maps each Enterprise_Id to the prior ThemeParks-derived id
import { buildBridgeEntries, type BridgeSourceEntity } from '../bridge.js';

/**
 * A ThemeParks.wiki entity id — the id from which the prior Internal_Id was
 * derived (`internalId(entity.id)`). Modeled as a UUID mixed with arbitrary
 * non-empty strings so the derivation is exercised across both realistic and
 * broader ids.
 */
const themeParksEntityIdArbP12: fc.Arbitrary<string> = fc.oneof(
  fc.uuid(),
  fc.string({ minLength: 1, maxLength: 40 }),
);

/**
 * An `externalId` value as it may appear on a ThemeParks.wiki entity: a
 * non-empty `Enterprise_Id`, `undefined` (field absent), or a whitespace-only
 * string. The latter two carry no continuity signal and must be skipped.
 */
const externalIdSlotArbP12: fc.Arbitrary<string | undefined> = fc.oneof(
  { weight: 3, arbitrary: enterpriseIdArb },
  { weight: 1, arbitrary: fc.constant<string | undefined>(undefined) },
  {
    weight: 1,
    arbitrary: fc.constantFrom<string | undefined>('', ' ', '   ', '\t', '\n'),
  },
);

const bridgeSourceEntityArbP12: fc.Arbitrary<BridgeSourceEntity> = fc
  .tuple(themeParksEntityIdArbP12, externalIdSlotArbP12)
  .map(([id, externalId]) =>
    externalId === undefined ? { id } : { id, externalId },
  );

const entitiesArbP12: fc.Arbitrary<readonly BridgeSourceEntity[]> = fc.array(
  bridgeSourceEntityArbP12,
  { maxLength: 20 },
);

/** True when an `externalId` slot carries a real, non-empty `Enterprise_Id`. */
const hasEnterpriseIdP12 = (entity: BridgeSourceEntity): boolean =>
  entity.externalId !== undefined && entity.externalId.trim().length > 0;

describe('bridge — Property 12: Bridge_Map maps each Enterprise_Id to the prior ThemeParks-derived id', () => {
  it('maps each entity Enterprise_Id to the internal id derived from that entity (R10.2)', () => {
    fc.assert(
      fc.property(entitiesArbP12, (entities) => {
        const entries = buildBridgeEntries(entities);
        const byEnterpriseId = new Map(
          entries.map((e) => [e.enterpriseId, e.internalId]),
        );

        // Every entity carrying a non-empty Enterprise_Id has a mapping to the
        // internal id previously derived from that ThemeParks.wiki entity id.
        // First-wins on duplicate Enterprise_Ids, so the expected value is the
        // derivation of the *first* entity claiming that Enterprise_Id.
        const firstOwner = new Map<string, string>();
        for (const entity of entities) {
          if (!hasEnterpriseIdP12(entity)) {
            continue;
          }
          const enterpriseId = entity.externalId as string;
          if (!firstOwner.has(enterpriseId)) {
            firstOwner.set(enterpriseId, internalId(entity.id));
          }
        }

        for (const [enterpriseId, expectedInternalId] of firstOwner) {
          expect(byEnterpriseId.get(enterpriseId)).toBe(expectedInternalId);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('skips entities lacking a non-empty Enterprise_Id (R10.2)', () => {
    fc.assert(
      fc.property(entitiesArbP12, (entities) => {
        const entries = buildBridgeEntries(entities);
        const produced = new Set(entries.map((e) => e.enterpriseId));

        // No produced entry has an empty/whitespace enterpriseId, and every
        // entity without a real Enterprise_Id contributes nothing beyond what
        // a differently-keyed entity might.
        for (const entry of entries) {
          expect(entry.enterpriseId.trim().length).toBeGreaterThan(0);
        }

        // An entity that lacks an Enterprise_Id never introduces a new key on
        // its own account: every produced key traces back to some entity that
        // *does* carry that Enterprise_Id.
        for (const enterpriseId of produced) {
          const owner = entities.find(
            (e) => hasEnterpriseIdP12(e) && e.externalId === enterpriseId,
          );
          expect(owner).toBeDefined();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('de-duplicates on Enterprise_Id first-wins, keeping the entry set a function of Enterprise_Id (R10.2)', () => {
    fc.assert(
      fc.property(entitiesArbP12, (entities) => {
        const entries = buildBridgeEntries(entities);

        // Every Enterprise_Id appears at most once.
        const enterpriseIds = entries.map((e) => e.enterpriseId);
        expect(new Set(enterpriseIds).size).toBe(enterpriseIds.length);

        // First-wins: the surviving mapping for a repeated Enterprise_Id is the
        // derivation of the first entity that claimed it.
        for (const entry of entries) {
          const firstOwner = entities.find(
            (e) => hasEnterpriseIdP12(e) && e.externalId === entry.enterpriseId,
          );
          expect(firstOwner).toBeDefined();
          expect(entry.internalId).toBe(
            internalId((firstOwner as BridgeSourceEntity).id),
          );
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
