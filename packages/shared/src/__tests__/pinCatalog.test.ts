/**
 * Structural invariants for the Series 1 pin catalog.
 *
 * These guard the transcription against the mistakes the old catalogue made:
 * duplicate ids, an id whose prefix disagrees with its tier, a criteria that
 * references a set the registry doesn't define, an orphaned set, or a pin that
 * fails the shared `pinSchema`. Deliberately asserts the exact roster size so a
 * pin silently added or dropped fails the gate.
 *
 * Validates: Requirements 1, 7, 13, 19
 */

import { describe, expect, it } from 'vitest';

import { PIN_TIERS } from '../enums.js';
import type { PinCriteria } from '../dto/Pin.js';
import { pinSchema } from '../schemas/Pin.js';
import { PINS, PIN_SETS } from '../pins/catalog.js';

/** Every set id referenced by a criteria (recursing into compound). */
function setIdsIn(c: PinCriteria): string[] {
  if (c.kind === 'set') return [c.setId];
  if (c.kind === 'compound') return c.all.flatMap(setIdsIn);
  return [];
}

describe('Series 1 pin catalog', () => {
  it('holds the full 174-pin roster', () => {
    expect(PINS.length).toBe(174);
  });

  it('every pin validates against pinSchema', () => {
    for (const p of PINS) {
      const r = pinSchema.safeParse(p);
      expect(r.success, r.success ? p.id : `${p.id}: ${JSON.stringify(r.error.issues)}`).toBe(true);
    }
  });

  it('ids are unique', () => {
    const ids = PINS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every id is prefixed by its tier", () => {
    for (const p of PINS) {
      expect(p.id.startsWith(`${p.tier}_`), `${p.id} (tier ${p.tier})`).toBe(true);
    }
  });

  it('every referenced set is defined in PIN_SETS', () => {
    for (const p of PINS) {
      for (const s of setIdsIn(p.criteria)) {
        expect(PIN_SETS[s], `${p.id} references undefined set '${s}'`).toBeDefined();
      }
    }
  });

  it('every defined set is referenced by at least one pin', () => {
    const used = new Set(PINS.flatMap((p) => setIdsIn(p.criteria)));
    for (const key of Object.keys(PIN_SETS)) {
      expect(used.has(key), `set '${key}' is defined but never used`).toBe(true);
    }
  });

  it('curated id sets carry entity-typed upstream ids', () => {
    for (const [key, res] of Object.entries(PIN_SETS)) {
      if (res.kind === 'ids') {
        expect(res.ids.length, `set '${key}' is empty`).toBeGreaterThan(0);
        for (const id of res.ids) {
          expect(id.includes(';entityType='), `set '${key}' id '${id}' is not entity-typed`).toBe(true);
        }
      }
    }
  });

  it('covers all seven tiers', () => {
    const tiers = new Set(PINS.map((p) => p.tier));
    for (const t of PIN_TIERS) expect(tiers.has(t), `no pin at tier ${t}`).toBe(true);
  });

  it('has exactly one mythic capstone', () => {
    expect(PINS.filter((p) => p.tier === 'mythic')).toHaveLength(1);
  });
});
